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
      options: { defaultType: config.marketType === "future" ? "future" : "spot" },
    });

    if (config.sandbox && typeof this.exchange.setSandboxMode === "function") {
      this.exchange.setSandboxMode(true);
      logger.info("Exchange sandbox mode enabled");
    }
  }

  /**
   * Map a unified spot symbol (BASE/QUOTE) to the venue symbol for the configured
   * market type. Binance USDT-margined perpetuals use BASE/QUOTE:QUOTE notation.
   */
  private marketSymbol(symbol: string): string {
    if (config.marketType !== "future" || symbol.includes(":")) return symbol;
    const quote = symbol.split("/")[1];
    return quote ? `${symbol}:${quote}` : symbol;
  }

  /**
   * Set margin mode and leverage for each futures market. Best-effort: exchanges
   * reject setMarginMode when it is already the current mode, which is not an error.
   */
  async configureMarkets(symbols: string[]): Promise<void> {
    if (config.marketType !== "future") return;
    for (const symbol of symbols) {
      const market = this.marketSymbol(symbol);
      try {
        if (typeof this.exchange.setMarginMode === "function") {
          await this.exchange.setMarginMode(config.marginMode, market);
        }
      } catch (err) {
        logger.warn(
          { symbol: market, err: (err as Error).message },
          "Could not set margin mode (may already be set)",
        );
      }
      try {
        if (typeof this.exchange.setLeverage === "function") {
          await this.exchange.setLeverage(config.leverage, market);
        }
        logger.info(
          { symbol: market, leverage: config.leverage, marginMode: config.marginMode },
          "Configured futures market",
        );
      } catch (err) {
        logger.warn({ symbol: market, err: (err as Error).message }, "Could not set leverage");
      }
    }
  }

  async fetchCandles(symbol: string, limit = 100): Promise<Candle[]> {
    const raw = await this.exchange.fetchOHLCV(
      this.marketSymbol(symbol),
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

  /** Total balances keyed by asset (e.g. `{ BTC: 0.5, USDT: 1000 }`). */
  async fetchBalances(): Promise<Record<string, number>> {
    const balance = await this.exchange.fetchBalance();
    const totals = (balance.total ?? {}) as Record<string, number | undefined>;
    const out: Record<string, number> = {};
    for (const [asset, amount] of Object.entries(totals)) {
      out[asset] = Number(amount ?? 0) || 0;
    }
    return out;
  }

  async fetchPrice(symbol: string): Promise<number> {
    const ticker = await this.exchange.fetchTicker(this.marketSymbol(symbol));
    if (ticker.last == null) {
      throw new Error(`No last price available for ${symbol}`);
    }
    return ticker.last;
  }

  /** Free balance of a single quote asset (e.g. USDT), used for % position sizing. */
  async fetchQuoteBalance(quote: string): Promise<number> {
    const balance = await this.exchange.fetchBalance();
    const free = (balance.free ?? {}) as Record<string, number | undefined>;
    return Number(free[quote] ?? 0) || 0;
  }

  /**
   * Place a market order and report the actual fill. `refPrice` is used as a
   * fallback fill price and to estimate the fee for DRY_RUN orders.
   */
  async createOrder(
    symbol: string,
    side: "buy" | "sell",
    amount: number,
    refPrice: number,
  ): Promise<OrderResult> {
    if (config.dryRun) {
      const feeQuote = refPrice * amount * config.feeRate;
      logger.warn(
        { side, amount, symbol, estFee: feeQuote },
        "DRY_RUN: skipping real order (fee estimated)",
      );
      return { price: refPrice, amount, feeQuote };
    }

    const order = await this.exchange.createOrder(this.marketSymbol(symbol), "market", side, amount);
    const price = order.average ?? order.price ?? refPrice;
    const filled = order.filled ?? amount;
    const feeQuote = this.feeToQuote(order, price, symbol);
    logger.info({ id: order.id, symbol, side, amount: filled, price, feeQuote }, "Order filled");
    return { price, amount: filled, feeQuote };
  }

  /**
   * Normalise a ccxt order's fee(s) into quote currency. Exchanges report fees in
   * either the quote asset (e.g. USDT) or the base asset (e.g. BTC); base-asset
   * fees are converted at the fill price.
   */
  private feeToQuote(order: Order, fillPrice: number, symbol: string): number {
    const base = symbol.split("/")[0];
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
