import type { Candle, Signal, SignalAt, Strategy } from "../types/index.js";
import { rsi } from "./indicators.js";

/**
 * RSI mean-reversion strategy. Buys when RSI crosses back up through the oversold
 * threshold (momentum recovering from lows) and sells when it crosses back down
 * through the overbought threshold.
 */
export class RsiStrategy implements Strategy {
  readonly name: string;

  constructor(
    private readonly period = 14,
    private readonly oversold = 30,
    private readonly overbought = 70,
  ) {
    if (period <= 1) throw new Error("period must be greater than 1");
    if (oversold >= overbought) {
      throw new Error("oversold must be below overbought");
    }
    this.name = `RSI(${period}, ${oversold}/${overbought})`;
  }

  evaluate(candles: Candle[]): Signal {
    return this.prepare(candles)(candles.length - 1);
  }

  prepare(candles: Candle[]): SignalAt {
    const closes = candles.map((c) => c.close);
    const values = rsi(closes, this.period);

    return (i) => {
      const now = values[i];
      const prev = values[i - 1];

      if (now == null || prev == null) {
        return { side: "hold", strength: 0, reason: "Not enough data" };
      }

      // Cross up out of oversold → buy.
      if (prev <= this.oversold && now > this.oversold) {
        const strength = Math.min(1, (this.oversold - Math.min(prev, this.oversold)) / this.oversold + 0.5);
        return { side: "buy", strength, reason: `RSI crossed up through ${this.oversold}` };
      }
      // Cross down out of overbought → sell.
      if (prev >= this.overbought && now < this.overbought) {
        return { side: "sell", strength: 1, reason: `RSI crossed down through ${this.overbought}` };
      }
      return { side: "hold", strength: 0, reason: `RSI at ${now.toFixed(1)}` };
    };
  }
}
