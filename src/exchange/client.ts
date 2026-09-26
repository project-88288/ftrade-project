import ccxt, { type Exchange } from "ccxt";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import type { Candle } from "../types/index.js";

/**
 * Thin wrapper around a ccxt exchange instance. Centralises credential wiring,
 * sandbox mode and the small amount of normalisation the rest of the bot needs.
 */
export class ExchangeClient {
  private readonly exchange: Exchange;

  constructor() {
    const ExchangeCtor = (ccxt as unknown as Record<string, new (cfg: object) => Exchange>)[
      config.exchangeId
    ];
    if (!ExchangeCtor) {
      throw new Error(`Unknown exchange id: ${config.exchangeId}`);
    }

    this.exchange = new ExchangeCtor({
      apiKey: config.apiKey,
      secret: config.secret,
      enableRateLimit: true,
    });

    if (config.sandbox && typeof this.exchange.setSandboxMode === "function") {
      this.exchange.setSandboxMode(true);
      logger.info("Exchange sandbox mode enabled");
    }
  }

  async fetchCandles(limit = 100): Promise<Candle[]> {
    const raw = await this.exchange.fetchOHLCV(
      config.symbol,
      config.timeframe,
      undefined,
      limit,
    );
    return raw.map(([timestamp, open, high, low, close, volume]) => ({
      timestamp: Number(timestamp),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
    }));
  }

  async fetchPrice(): Promise<number> {
    const ticker = await this.exchange.fetchTicker(config.symbol);
    if (ticker.last == null) {
      throw new Error(`No last price available for ${config.symbol}`);
    }
    return ticker.last;
  }

  async createOrder(side: "buy" | "sell", amount: number): Promise<void> {
    if (config.dryRun) {
      logger.warn({ side, amount, symbol: config.symbol }, "DRY_RUN: skipping real order");
      return;
    }
    const order = await this.exchange.createOrder(config.symbol, "market", side, amount);
    logger.info({ id: order.id, side, amount }, "Order submitted");
  }
}
