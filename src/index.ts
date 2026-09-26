import { parseArgs } from "node:util";
import { config } from "./config/index.js";
import { logger } from "./utils/logger.js";
import { ExchangeClient } from "./exchange/client.js";
import { createStrategy, isStrategyName, STRATEGY_NAMES } from "./strategy/index.js";
import { RiskManager } from "./risk/manager.js";
import { PositionStore } from "./state/store.js";
import { TradeLog, closeTrade } from "./state/trade-log.js";
import type { Position } from "./types/index.js";

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

async function main() {
  const { strategy, warmup } = resolveStrategy();

  logger.info(
    {
      exchange: config.exchangeId,
      symbol: config.symbol,
      timeframe: config.timeframe,
      strategy: strategy.name,
      sandbox: config.sandbox,
      dryRun: config.dryRun,
    },
    "Starting ftrade bot",
  );

  const client = new ExchangeClient();
  const risk = new RiskManager();
  const store = new PositionStore(config.stateFile);
  const tradeLog = new TradeLog(config.tradeLogFile);

  // Fetch enough history for the strategy to warm up, with a small buffer so a
  // crossover on the most recent candle is still detectable.
  const candleLimit = Math.max(100, warmup + 5);

  // Resume any position left open by a previous run.
  let position: Position | null = await store.load();
  if (position) {
    logger.info({ position }, "Resumed open position from disk");
  }
  let running = true;

  const shutdown = () => {
    logger.info("Shutting down...");
    running = false;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (running) {
    try {
      const candles = await client.fetchCandles(candleLimit);
      const price = await client.fetchPrice();

      // Manage an open position first (stop-loss / take-profit).
      if (position && risk.shouldExit(position, price)) {
        const side = risk.exitSide(position);
        const fill = await client.createOrder(side, position.amount, price);
        const trade = closeTrade(position, fill.price, "stop-loss/take-profit", fill.feeQuote);
        await tradeLog.append(trade);
        logger.info(
          { price: fill.price, entry: position.entryPrice, pnl: trade.pnl, fees: trade.fees },
          "Closed position (SL/TP)",
        );
        position = null;
        await store.save(position);
      }

      const signal = strategy.evaluate(candles);
      logger.debug({ signal, price }, "Evaluated strategy");

      if (!position && signal.side !== "hold") {
        const amount = risk.positionSize(price);
        if (amount > 0) {
          const fill = await client.createOrder(signal.side, amount, price);
          position = {
            symbol: config.symbol,
            side: signal.side,
            entryPrice: fill.price,
            amount: fill.amount,
            openedAt: Date.now(),
            entryFee: fill.feeQuote,
          };
          await store.save(position);
          logger.info(
            { signal, price: fill.price, amount: fill.amount, entryFee: fill.feeQuote },
            "Opened position",
          );
        }
      }
    } catch (err) {
      logger.error({ err }, "Loop iteration failed");
    }

    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalSec * 1000));
  }

  process.exit(0);
}

main().catch((err) => {
  logger.fatal({ err }, "Fatal error");
  process.exit(1);
});
