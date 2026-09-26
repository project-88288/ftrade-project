import ccxt, { type Exchange, type Order } from "ccxt";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import type { Candle } from "../types/index.js";

export interface OrderResult {
  /** Average fill price (falls back to the reference price). */
  price: number;
  /** Filled amount in base currency. */
  amount: number;
  /** Fee paid, expressed in quote currency. */
  feeQuote: number;
}

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

  /** Total balance of the market's base asset (e.g. BTC for BTC/USDT). */
  async fetchBaseBalance(): Promise<number> {
    const base = config.symbol.split("/")[0]!;
    const balance = await this.exchange.fetchBalance();
    const totals = (balance.total ?? {}) as Record<string, number | undefined>;
    return Number(totals[base] ?? 0) || 0;
  }

  async fetchPrice(): Promise<number> {
    const ticker = await this.exchange.fetchTicker(config.symbol);
    if (ticker.last == null) {
      throw new Error(`No last price available for ${config.symbol}`);
    }
    return ticker.last;
  }

  /**
   * Place a market order and report the actual fill. `refPrice` is used as a
   * fallback fill price and to estimate the fee for DRY_RUN orders.
   */
  async createOrder(
    side: "buy" | "sell",
    amount: number,
    refPrice: number,
  ): Promise<OrderResult> {
    if (config.dryRun) {
      const feeQuote = refPrice * amount * config.feeRate;
      logger.warn(
        { side, amount, symbol: config.symbol, estFee: feeQuote },
        "DRY_RUN: skipping real order (fee estimated)",
      );
      return { price: refPrice, amount, feeQuote };
    }

    const order = await this.exchange.createOrder(config.symbol, "market", side, amount);
    const price = order.average ?? order.price ?? refPrice;
    const filled = order.filled ?? amount;
    const feeQuote = this.feeToQuote(order, price);
    logger.info({ id: order.id, side, amount: filled, price, feeQuote }, "Order filled");
    return { price, amount: filled, feeQuote };
  }

  /**
   * Normalise a ccxt order's fee(s) into quote currency. Exchanges report fees in
   * either the quote asset (e.g. USDT) or the base asset (e.g. BTC); base-asset
   * fees are converted at the fill price.
   */
  private feeToQuote(order: Order, fillPrice: number): number {
    const base = config.symbol.split("/")[0];
    // ccxt's types only declare `fee` (singular), but most exchanges also populate
    // a `fees` array at runtime — prefer it when present.
    type FeeEntry = { cost?: number; currency?: string } | undefined;
    const many = (order as { fees?: FeeEntry[] }).fees;
    const entries: FeeEntry[] = many?.length ? many : order.fee ? [order.fee] : [];

    let total = 0;
    for (const fee of entries) {
      const cost = Number(fee?.cost ?? 0);
      if (!Number.isFinite(cost) || cost === 0) continue;
      // Base-asset fees (e.g. BTC on a buy) are converted at the fill price;
      // quote-asset or unspecified fees are already in quote terms.
      total += fee?.currency === base ? cost * fillPrice : cost;
    }
    return total;
  }
}
