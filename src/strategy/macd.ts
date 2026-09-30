import type { Candle, Signal, SignalAt, Strategy } from "../types/index.js";
import { macd } from "./indicators.js";

/**
 * MACD crossover strategy. Buys when the MACD line crosses above its signal line
 * (momentum turning up) and sells when it crosses below. The most widely used
 * trend/momentum indicator in technical trading.
 */
export class MacdStrategy implements Strategy {
  readonly name: string;

  constructor(
    private readonly fastPeriod = 12,
    private readonly slowPeriod = 26,
    private readonly signalPeriod = 9,
  ) {
    if (fastPeriod >= slowPeriod) {
      throw new Error("fastPeriod must be smaller than slowPeriod");
    }
    if (signalPeriod <= 0) throw new Error("signalPeriod must be positive");
    this.name = `MACD(${fastPeriod}/${slowPeriod}/${signalPeriod})`;
  }

  evaluate(candles: Candle[]): Signal {
    return this.prepare(candles)(candles.length - 1);
  }

  prepare(candles: Candle[]): SignalAt {
    const closes = candles.map((c) => c.close);
    const { macd: line, signal } = macd(closes, this.fastPeriod, this.slowPeriod, this.signalPeriod);

    return (i) => {
      const macdNow = line[i];
      const macdPrev = line[i - 1];
      const sigNow = signal[i];
      const sigPrev = signal[i - 1];

      if (macdNow == null || macdPrev == null || sigNow == null || sigPrev == null) {
        return { side: "hold", strength: 0, reason: "Not enough data" };
      }

      const crossedUp = macdPrev <= sigPrev && macdNow > sigNow;
      const crossedDown = macdPrev >= sigPrev && macdNow < sigNow;

      if (crossedUp) {
        return { side: "buy", strength: 1, reason: "MACD crossed above signal line" };
      }
      if (crossedDown) {
        return { side: "sell", strength: 1, reason: "MACD crossed below signal line" };
      }
      return { side: "hold", strength: 0, reason: "No crossover" };
    };
  }
}
