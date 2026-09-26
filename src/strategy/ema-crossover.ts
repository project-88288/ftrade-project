import type { Candle, Signal, Strategy } from "../types/index.js";
import { ema } from "./indicators.js";

/**
 * EMA crossover strategy. Buys when the fast EMA crosses above the slow EMA and
 * sells when it crosses below. EMAs react faster to recent price than SMAs.
 */
export class EmaCrossoverStrategy implements Strategy {
  readonly name: string;

  constructor(
    private readonly fastPeriod = 12,
    private readonly slowPeriod = 26,
  ) {
    if (fastPeriod >= slowPeriod) {
      throw new Error("fastPeriod must be smaller than slowPeriod");
    }
    this.name = `EMA(${fastPeriod}/${slowPeriod})`;
  }

  evaluate(candles: Candle[]): Signal {
    const closes = candles.map((c) => c.close);
    const fast = ema(closes, this.fastPeriod);
    const slow = ema(closes, this.slowPeriod);

    const i = closes.length - 1;
    const fastNow = fast[i];
    const slowNow = slow[i];
    const fastPrev = fast[i - 1];
    const slowPrev = slow[i - 1];

    if (fastNow == null || slowNow == null || fastPrev == null || slowPrev == null) {
      return { side: "hold", strength: 0, reason: "Not enough data" };
    }

    const crossedUp = fastPrev <= slowPrev && fastNow > slowNow;
    const crossedDown = fastPrev >= slowPrev && fastNow < slowNow;

    if (crossedUp) {
      return { side: "buy", strength: 1, reason: "Fast EMA crossed above slow EMA" };
    }
    if (crossedDown) {
      return { side: "sell", strength: 1, reason: "Fast EMA crossed below slow EMA" };
    }
    return { side: "hold", strength: 0, reason: "No crossover" };
  }
}
