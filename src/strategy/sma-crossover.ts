import type { Candle, Signal, SignalAt, Strategy } from "../types/index.js";
import { sma } from "./indicators.js";

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

  evaluate(candles: Candle[]): Signal {
    return this.prepare(candles)(candles.length - 1);
  }

  prepare(candles: Candle[]): SignalAt {
    const closes = candles.map((c) => c.close);
    const fast = sma(closes, this.fastPeriod);
    const slow = sma(closes, this.slowPeriod);

    return (i) => {
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
        return { side: "buy", strength: 1, reason: "Fast SMA crossed above slow SMA" };
      }
      if (crossedDown) {
        return { side: "sell", strength: 1, reason: "Fast SMA crossed below slow SMA" };
      }
      return { side: "hold", strength: 0, reason: "No crossover" };
    };
  }
}
