import type { Candle, Signal, SignalAt, Strategy } from "../types/index.js";
import { donchian, sma } from "./indicators.js";

/**
 * Trend-filtered breakout strategy. A Donchian channel breakout, but only taken
 * when it agrees with a longer-term SMA trend: buy a breakout above the
 * `channelPeriod` high only while price is above the `trendPeriod` SMA, and sell
 * a breakdown below the channel low only while price is below it. The trend filter
 * is meant to skip the counter-trend breakouts that whipsaw a plain breakout
 * system.
 */
export class TrendBreakStrategy implements Strategy {
  readonly name: string;

  constructor(
    private readonly channelPeriod = 20,
    private readonly trendPeriod = 100,
  ) {
    if (channelPeriod <= 1) throw new Error("channelPeriod must be greater than 1");
    if (trendPeriod <= channelPeriod) {
      throw new Error("trendPeriod must be longer than channelPeriod");
    }
    this.name = `TrendBreak(${channelPeriod}/${trendPeriod})`;
  }

  evaluate(candles: Candle[]): Signal {
    return this.prepare(candles)(candles.length - 1);
  }

  prepare(candles: Candle[]): SignalAt {
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);
    const { upper, lower } = donchian(highs, lows, this.channelPeriod);
    const trend = sma(closes, this.trendPeriod);

    return (i) => {
      const close = closes[i];
      const up = upper[i];
      const lo = lower[i];
      const t = trend[i];

      if (close == null || up == null || lo == null || t == null) {
        return { side: "hold", strength: 0, reason: "Not enough data" };
      }

      // Breakout up, but only in an uptrend.
      if (close > up && close > t) {
        return { side: "buy", strength: 1, reason: `Breakout above ${this.channelPeriod}-high in uptrend` };
      }
      // Breakdown, but only in a downtrend.
      if (close < lo && close < t) {
        return { side: "sell", strength: 1, reason: `Breakdown below ${this.channelPeriod}-low in downtrend` };
      }
      return { side: "hold", strength: 0, reason: "No trend-aligned breakout" };
    };
  }
}
