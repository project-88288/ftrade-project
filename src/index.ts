import { parseArgs } from "node:util";
import { config } from "./config/index.js";
import { logger } from "./utils/logger.js";
import { ExchangeClient } from "./exchange/client.js";
import { createStrategy, isStrategyName, STRATEGY_NAMES } from "./strategy/index.js";
import { RiskManager } from "./risk/manager.js";
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

  // Fetch enough history for the strategy to warm up, with a small buffer so a
  // crossover on the most recent candle is still detectable.
  const candleLimit = Math.max(100, warmup + 5);

  let position: Position | null = null;
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
        await client.createOrder(side, position.amount);
        logger.info({ price, entry: position.entryPrice }, "Closed position (SL/TP)");
        position = null;
      }

      const signal = strategy.evaluate(candles);
      logger.debug({ signal, price }, "Evaluated strategy");

      if (!position && signal.side !== "hold") {
        const amount = risk.positionSize(price);
        if (amount > 0) {
          await client.createOrder(signal.side, amount);
          position = {
            symbol: config.symbol,
            side: signal.side,
            entryPrice: price,
            amount,
            openedAt: Date.now(),
          };
          logger.info({ signal, price, amount }, "Opened position");
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
