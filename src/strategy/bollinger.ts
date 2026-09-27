import type { Candle, Signal, Strategy } from "../types/index.js";
import { bollingerBands } from "./indicators.js";

/**
 * Bollinger Band mean-reversion strategy. Buys when price closes back up through
 * the lower band (a stretched-down move snapping back) and sells when it closes
 * back down through the upper band.
 */
export class BollingerStrategy implements Strategy {
  readonly name: string;

  constructor(
    private readonly period = 20,
    private readonly stdDev = 2,
  ) {
    if (period <= 1) throw new Error("period must be greater than 1");
    if (stdDev <= 0) throw new Error("stdDev must be positive");
    this.name = `BB(${period}, ${stdDev}σ)`;
  }

  evaluate(candles: Candle[]): Signal {
    const closes = candles.map((c) => c.close);
    const { upper, lower } = bollingerBands(closes, this.period, this.stdDev);

    const i = closes.length - 1;
    const now = closes[i];
    const prev = closes[i - 1];
    const upNow = upper[i];
    const upPrev = upper[i - 1];
    const loNow = lower[i];
    const loPrev = lower[i - 1];

    if (
      now == null ||
      prev == null ||
      upNow == null ||
      upPrev == null ||
      loNow == null ||
      loPrev == null
    ) {
      return { side: "hold", strength: 0, reason: "Not enough data" };
    }

    // Price re-enters from below the lower band → bounce → buy.
    if (prev <= loPrev && now > loNow) {
      return { side: "buy", strength: 1, reason: "Price reclaimed the lower band" };
    }
    // Price re-enters from above the upper band → fade → sell.
    if (prev >= upPrev && now < upNow) {
      return { side: "sell", strength: 1, reason: "Price fell back below the upper band" };
    }
    return { side: "hold", strength: 0, reason: "Inside the bands" };
  }
}
