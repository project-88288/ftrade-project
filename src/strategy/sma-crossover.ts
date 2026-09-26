import type { Candle, Signal, Strategy } from "../types/index.js";

/**
 * Simple moving-average crossover strategy. When the fast SMA crosses above the
 * slow SMA it signals a buy; crossing below signals a sell. This is a reference
 * implementation — swap in your own logic here.
 */
export class SmaCrossoverStrategy implements Strategy {
  readonly name: string;

  constructor(
    private readonly fastPeriod = 9,
    private readonly slowPeriod = 21,
  ) {
    if (fastPeriod >= slowPeriod) {
      throw new Error("fastPeriod must be smaller than slowPeriod");
    }
    this.name = `SMA(${fastPeriod}/${slowPeriod})`;
  }

  private sma(values: number[], period: number, offset = 0): number | null {
    const end = values.length - offset;
    const start = end - period;
    if (start < 0) return null;
    let sum = 0;
    for (let i = start; i < end; i++) sum += values[i]!;
    return sum / period;
  }

  evaluate(candles: Candle[]): Signal {
    const closes = candles.map((c) => c.close);

    const fastNow = this.sma(closes, this.fastPeriod);
    const slowNow = this.sma(closes, this.slowPeriod);
    const fastPrev = this.sma(closes, this.fastPeriod, 1);
    const slowPrev = this.sma(closes, this.slowPeriod, 1);

    if (fastNow == null || slowNow == null || fastPrev == null || slowPrev == null) {
      return { side: "hold", strength: 0, reason: "Not enough data" };
    }

    const crossedUp = fastPrev <= slowPrev && fastNow > slowNow;
    const crossedDown = fastPrev >= slowPrev && fastNow < slowNow;

    if (crossedUp) {
      return { side: "buy", strength: 1, reason: "Fast SMA crossed above slow SMA" };
    }
    if (crossedDown) {
      return { side: "sell", strength: 1, reason: "Fast SMA crossed below slow SMA" };
    }
    return { side: "hold", strength: 0, reason: "No crossover" };
  }
}
