import { parseArgs } from "node:util";
import { config } from "./config/index.js";
import { logger } from "./utils/logger.js";
import { ExchangeClient } from "./exchange/client.js";
import { reconcilePosition } from "./exchange/reconcile.js";
import { createStrategy, isStrategyName, STRATEGY_NAMES } from "./strategy/index.js";
import { RiskManager } from "./risk/manager.js";
import { PositionStore } from "./state/store.js";
import { TradeLog, closeTrade } from "./state/trade-log.js";
import { createNotifier, type Notifier } from "./notify/telegram.js";
import type { ExchangeClient as Client } from "./exchange/client.js";
import type { Strategy, Position } from "./types/index.js";

interface TradeDeps {
  client: Client;
  strategy: Strategy;
  risk: RiskManager;
  store: PositionStore;
  tradeLog: TradeLog;
  notifier: Notifier;
  candleLimit: number;
}

/** Resolve the strategy from env config, allowing CLI flags to override. */
function resolveStrategy() {
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

  return createStrategy(name, {
    fast: num(values.fast, config.strategyParams.fast),
    slow: num(values.slow, config.strategyParams.slow),
    rsiPeriod: num(values["rsi-period"], config.strategyParams.rsiPeriod),
    oversold: num(values.oversold, config.strategyParams.oversold),
    overbought: num(values.overbought, config.strategyParams.overbought),
  });
}

/** Run one poll iteration for a single symbol, mutating & persisting `positions`. */
async function tradeSymbol(
  symbol: string,
  deps: TradeDeps,
  positions: Map<string, Position>,
): Promise<void> {
  const { client, strategy, risk, store, tradeLog, notifier } = deps;
  const candles = await client.fetchCandles(symbol, deps.candleLimit);
  const price = await client.fetchPrice(symbol);

  // Manage an open position first (stop-loss / take-profit).
  const open = positions.get(symbol);
  if (open && risk.shouldExit(open, price)) {
    const side = risk.exitSide(open);
    const fill = await client.createOrder(symbol, side, open.amount, price);
    const trade = closeTrade(open, fill.price, "stop-loss/take-profit", fill.feeQuote);
    await tradeLog.append(trade);
    positions.delete(symbol);
    await store.save(positions);
    logger.info(
      { symbol, price: fill.price, entry: open.entryPrice, pnl: trade.pnl, fees: trade.fees },
      "Closed position (SL/TP)",
    );
    await notifier.send(
      `🔴 Closed ${open.side.toUpperCase()} ${symbol} @ ${fill.price}\n` +
        `PnL: ${trade.pnl.toFixed(2)} (${trade.pnlPct.toFixed(2)}%), fees ${trade.fees.toFixed(2)} — ${config.dryRun ? "DRY_RUN" : "LIVE"}`,
    );
  }

  const signal = strategy.evaluate(candles);
  logger.debug({ symbol, signal, price }, "Evaluated strategy");

  if (!positions.has(symbol) && signal.side !== "hold") {
    const amount = risk.positionSize(price);
    if (amount > 0) {
      const fill = await client.createOrder(symbol, signal.side, amount, price);
      const position: Position = {
        symbol,
        side: signal.side,
        entryPrice: fill.price,
        amount: fill.amount,
        openedAt: Date.now(),
        entryFee: fill.feeQuote,
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
  const { strategy, warmup } = resolveStrategy();

  logger.info(
    {
      exchange: config.exchangeId,
      symbols: config.symbols,
      timeframe: config.timeframe,
      strategy: strategy.name,
      sandbox: config.sandbox,
      dryRun: config.dryRun,
    },
    "Starting ftrade bot",
  );

  const deps: TradeDeps = {
    client: new ExchangeClient(),
    strategy,
    risk: new RiskManager(),
    store: new PositionStore(config.stateFile),
    tradeLog: new TradeLog(config.tradeLogFile),
    notifier: createNotifier(),
    // Fetch enough history for the strategy to warm up, with a small buffer so a
    // crossover on the most recent candle is still detectable.
    candleLimit: Math.max(100, warmup + 5),
  };

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
