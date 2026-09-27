import type { Candle, Signal, Strategy } from "../types/index.js";
import { stochastic } from "./indicators.js";

/**
 * Stochastic oscillator strategy. Buys when %K crosses above %D while the
 * oscillator is in oversold territory, and sells when %K crosses below %D while
 * overbought — a momentum-reversal signal filtered by the extreme zones.
 */
export class StochasticStrategy implements Strategy {
  readonly name: string;

  constructor(
    private readonly kPeriod = 14,
    private readonly dPeriod = 3,
    private readonly oversold = 20,
    private readonly overbought = 80,
  ) {
    if (kPeriod <= 1) throw new Error("kPeriod must be greater than 1");
    if (dPeriod <= 0) throw new Error("dPeriod must be positive");
    if (oversold >= overbought) throw new Error("oversold must be below overbought");
    this.name = `Stoch(${kPeriod}/${dPeriod}, ${oversold}/${overbought})`;
  }

  evaluate(candles: Candle[]): Signal {
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);
    const { k, d } = stochastic(highs, lows, closes, this.kPeriod, this.dPeriod);

    const i = closes.length - 1;
    const kNow = k[i];
    const kPrev = k[i - 1];
    const dNow = d[i];
    const dPrev = d[i - 1];

    if (kNow == null || kPrev == null || dNow == null || dPrev == null) {
      return { side: "hold", strength: 0, reason: "Not enough data" };
    }

    const crossedUp = kPrev <= dPrev && kNow > dNow;
    const crossedDown = kPrev >= dPrev && kNow < dNow;

    if (crossedUp && dPrev <= this.oversold) {
      return { side: "buy", strength: 1, reason: `%K crossed above %D in oversold (${this.oversold})` };
    }
    if (crossedDown && dPrev >= this.overbought) {
      return { side: "sell", strength: 1, reason: `%K crossed below %D in overbought (${this.overbought})` };
    }
    return { side: "hold", strength: 0, reason: `Stoch %K ${kNow.toFixed(1)}` };
  }
}
