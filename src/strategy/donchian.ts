import type { Candle, Signal, SignalAt, Strategy } from "../types/index.js";
import { donchian } from "./indicators.js";

/**
 * Donchian channel breakout strategy. Buys when price closes above the highest
 * high of the prior `period` candles (an upside breakout) and sells when it
 * closes below the prior `period` low — the classic trend-following breakout.
 */
export class DonchianStrategy implements Strategy {
  readonly name: string;

  constructor(private readonly period = 20) {
    if (period <= 1) throw new Error("period must be greater than 1");
    this.name = `Donchian(${period})`;
  }

  evaluate(candles: Candle[]): Signal {
    return this.prepare(candles)(candles.length - 1);
  }

  prepare(candles: Candle[]): SignalAt {
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);
    const { upper, lower } = donchian(highs, lows, this.period);

    return (i) => {
      const close = closes[i];
      const up = upper[i];
      const lo = lower[i];

      if (close == null || up == null || lo == null) {
        return { side: "hold", strength: 0, reason: "Not enough data" };
      }

      if (close > up) {
        return { side: "buy", strength: 1, reason: `Broke above ${this.period}-period high` };
      }
      if (close < lo) {
        return { side: "sell", strength: 1, reason: `Broke below ${this.period}-period low` };
      }
      return { side: "hold", strength: 0, reason: "Inside the channel" };
    };
  }
}
