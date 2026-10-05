import { parseArgs } from "node:util";
import { config } from "./config/index.js";
import { logger } from "./utils/logger.js";
import { ExchangeClient } from "./exchange/client.js";
import { reconcilePosition } from "./exchange/reconcile.js";
import {
  isStrategyName,
  resolveSymbolStrategies,
  STRATEGY_NAMES,
  type StrategyName,
  type StrategyParams,
  type ResolvedStrategy,
} from "./strategy/index.js";
import { RiskManager } from "./risk/manager.js";
import { PositionStore } from "./state/store.js";
import { TradeLog, closeTrade } from "./state/trade-log.js";
import { createNotifier, type Notifier } from "./notify/telegram.js";
import type { ExchangeClient as Client } from "./exchange/client.js";
import type { Position } from "./types/index.js";

interface TradeDeps {
  client: Client;
  strategies: Map<string, ResolvedStrategy>;
  risk: RiskManager;
  store: PositionStore;
  tradeLog: TradeLog;
  notifier: Notifier;
}

/** Resolve the global default strategy from env config, with CLI flag overrides. */
function resolveDefaultSpec(): { name: StrategyName; params: StrategyParams } {
  const { values } = parseArgs({
    options: {
      strategy: { type: "string" },
      fast: { type: "string" },
      slow: { type: "string" },
      "rsi-period": { type: "string" },
      oversold: { type: "string" },
      overbought: { type: "string" },
    },
    strict: false,
  });

  const str = (v: string | boolean | undefined) =>
    typeof v === "string" ? v : undefined;
  const num = (v: string | boolean | undefined, fallback: number) =>
    typeof v === "string" ? Number(v) : fallback;

  const name = str(values.strategy) ?? config.strategy;
  if (!isStrategyName(name)) {
    logger.fatal({ strategy: name, available: STRATEGY_NAMES }, "Unknown strategy");
    process.exit(1);
  }

  return {
    name,
    params: {
      ...config.strategyParams,
      fast: num(values.fast, config.strategyParams.fast),
      slow: num(values.slow, config.strategyParams.slow),
      rsiPeriod: num(values["rsi-period"], config.strategyParams.rsiPeriod),
      oversold: num(values.oversold, config.strategyParams.oversold),
      overbought: num(values.overbought, config.strategyParams.overbought),
    },
  };
}

/** Run one poll iteration for a single symbol, mutating & persisting `positions`. */
async function tradeSymbol(
  symbol: string,
  deps: TradeDeps,
  positions: Map<string, Position>,
): Promise<void> {
  const { client, risk, store, tradeLog, notifier } = deps;
  const spec = deps.strategies.get(symbol);
  if (!spec) return;
  // Enough history for warmup, plus a buffer so a fresh crossover is detectable.
  const candleLimit = Math.max(100, spec.warmup + 5);
  const candles = await client.fetchCandles(symbol, candleLimit);
  const price = await client.fetchPrice(symbol);

  // Manage an open position first (stop-loss / take-profit / trailing stop).
  const open = positions.get(symbol);
  if (open) {
    // Ratchet the trailing stop toward the latest price before deciding on an exit.
    const peakMoved = risk.trackPeak(open, price);
    const reason = risk.exitReason(open, price);
    if (reason) {
      const side = risk.exitSide(open);
      const fill = await client.createOrder(symbol, side, open.amount, price);
      const trade = closeTrade(open, fill.price, reason, fill.feeQuote);
      await tradeLog.append(trade);
      positions.delete(symbol);
      await store.save(positions);
      logger.info(
        { symbol, reason, price: fill.price, entry: open.entryPrice, pnl: trade.pnl, fees: trade.fees },
        "Closed position",
      );
      await notifier.send(
        `🔴 Closed ${open.side.toUpperCase()} ${symbol} @ ${fill.price} (${reason})\n` +
          `PnL: ${trade.pnl.toFixed(2)} (${trade.pnlPct.toFixed(2)}%), fees ${trade.fees.toFixed(2)} — ${config.dryRun ? "DRY_RUN" : "LIVE"}`,
      );
    } else if (peakMoved) {
      // No exit, but the trailing stop tightened — persist it so a restart keeps it.
      await store.save(positions);
    }
  }

  const signal = spec.strategy.evaluate(candles);
  logger.debug({ symbol, strategy: spec.strategy.name, signal, price }, "Evaluated strategy");

  if (!positions.has(symbol) && signal.side !== "hold") {
    let balance: number | undefined;
    if (config.positionPct > 0) {
      try {
        balance = await client.fetchQuoteBalance(symbol.split("/")[1]!);
      } catch (err) {
        logger.warn(
          { symbol, err: (err as Error).message },
          "Could not fetch balance for % sizing; falling back to MAX_POSITION_USD",
        );
      }
    }
    const amount = risk.positionSize(price, balance);
    if (amount > 0) {
      const fill = await client.createOrder(symbol, signal.side, amount, price);
      const position: Position = {
        symbol,
        side: signal.side,
        entryPrice: fill.price,
        amount: fill.amount,
        openedAt: Date.now(),
        entryFee: fill.feeQuote,
        peakPrice: fill.price,
      };
      positions.set(symbol, position);
      await store.save(positions);
      logger.info(
        { symbol, signal, price: fill.price, amount: fill.amount, entryFee: fill.feeQuote },
        "Opened position",
      );
      await notifier.send(
        `🟢 Opened ${signal.side.toUpperCase()} ${symbol} @ ${fill.price}\n` +
          `Amount: ${fill.amount}, fee ${fill.feeQuote.toFixed(2)} — ${config.dryRun ? "DRY_RUN" : "LIVE"}\n` +
          `Reason: ${signal.reason}`,
      );
    }
  }
}

/**
 * Reconcile every persisted position against the exchange balances. Only tracked
 * symbols are checked, so assets held outside the bot don't raise false alarms.
 */
async function reconcileAll(
  client: Client,
  store: PositionStore,
  positions: Map<string, Position>,
): Promise<void> {
  const balances = await client.fetchBalances();
  let changed = false;
  for (const symbol of [...positions.keys()]) {
    const base = symbol.split("/")[0]!;
    const actualBase = balances[base] ?? 0;
    const result = reconcilePosition(positions.get(symbol) ?? null, actualBase, {
      tolerance: config.reconcileTolerance,
      dust: config.reconcileDust,
    });
    const log = result.changed ? logger.warn.bind(logger) : logger.info.bind(logger);
    log({ symbol, status: result.status, actualBase }, `Reconciliation: ${result.message}`);
    if (result.changed) {
      if (result.position) positions.set(symbol, result.position);
      else positions.delete(symbol);
      changed = true;
    }
  }
  if (changed) await store.save(positions);
}

async function main() {
  const { name, params } = resolveDefaultSpec();

  let strategies: Map<string, ResolvedStrategy>;
  try {
    strategies = resolveSymbolStrategies(config.symbols, name, params, config.symbolStrategies);
  } catch (err) {
    logger.fatal({ err }, "Invalid strategy configuration");
    process.exit(1);
  }

  logger.info(
    {
      exchange: config.exchangeId,
      timeframe: config.timeframe,
      strategies: Object.fromEntries(
        [...strategies].map(([symbol, s]) => [symbol, s.strategy.name]),
      ),
      sandbox: config.sandbox,
      dryRun: config.dryRun,
      marketType: config.marketType,
      leverage: config.marketType === "future" ? config.leverage : undefined,
      marginMode: config.marketType === "future" ? config.marginMode : undefined,
      positionPct: config.positionPct > 0 ? config.positionPct : undefined,
    },
    "Starting ftrade bot",
  );

  const deps: TradeDeps = {
    client: new ExchangeClient(),
    strategies,
    risk: new RiskManager(),
    store: new PositionStore(config.stateFile),
    tradeLog: new TradeLog(config.tradeLogFile),
    notifier: createNotifier(),
  };

  // Configure futures leverage / margin mode per market. Needs live credentials;
  // in dry-run no orders are placed so the exchange-side setting is irrelevant.
  if (config.marketType === "future" && !config.dryRun && config.apiKey) {
    try {
      await deps.client.configureMarkets([...strategies.keys()]);
    } catch (err) {
      logger.error({ err }, "Failed to configure futures markets");
    }
  }

  // Resume positions left open by a previous run.
  const positions = await deps.store.load();
  if (positions.size > 0) {
    logger.info({ symbols: [...positions.keys()] }, "Resumed open positions from disk");
  }

  // Reconcile persisted state against the exchange in case fills or manual trades
  // happened while the bot was down. Requires live credentials.
  if (config.reconcile && !config.dryRun && config.apiKey) {
    try {
      await reconcileAll(deps.client, deps.store, positions);
    } catch (err) {
      logger.error({ err }, "Reconciliation failed; continuing with persisted state");
    }
  } else if (config.reconcile) {
    logger.info("Skipping reconciliation (dry-run or no API credentials)");
  }

  let running = true;

  const shutdown = () => {
    logger.info("Shutting down...");
    running = false;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (running) {
    for (const symbol of config.symbols) {
      if (!running) break;
      try {
        await tradeSymbol(symbol, deps, positions);
      } catch (err) {
        logger.error({ err, symbol }, "Symbol iteration failed");
      }
    }

    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalSec * 1000));
  }

  process.exit(0);
}

main().catch((err) => {
  logger.fatal({ err }, "Fatal error");
  process.exit(1);
});
