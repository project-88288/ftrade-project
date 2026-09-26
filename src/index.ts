import { config } from "./config/index.js";
import { logger } from "./utils/logger.js";
import { ExchangeClient } from "./exchange/client.js";
import { SmaCrossoverStrategy } from "./strategy/sma-crossover.js";
import { RiskManager } from "./risk/manager.js";
import type { Position } from "./types/index.js";

const POLL_INTERVAL_MS = 15_000;

async function main() {
  logger.info(
    {
      exchange: config.exchangeId,
      symbol: config.symbol,
      timeframe: config.timeframe,
      sandbox: config.sandbox,
      dryRun: config.dryRun,
    },
    "Starting ftrade bot",
  );

  const client = new ExchangeClient();
  const strategy = new SmaCrossoverStrategy();
  const risk = new RiskManager();

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
      const candles = await client.fetchCandles();
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

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  process.exit(0);
}

main().catch((err) => {
  logger.fatal({ err }, "Fatal error");
  process.exit(1);
});
