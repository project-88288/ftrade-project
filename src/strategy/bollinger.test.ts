import { describe, it, expect } from "vitest";
import { BollingerStrategy } from "./bollinger.js";
import type { Candle } from "../types/index.js";

function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    timestamp: i,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }));
}

describe("BollingerStrategy", () => {
  it("holds when there is not enough data", () => {
    const strategy = new BollingerStrategy(20, 2);
    expect(strategy.evaluate(candlesFromCloses([1, 2, 3])).side).toBe("hold");
  });

  it("signals buy when price reclaims the lower band", () => {
    const strategy = new BollingerStrategy(5, 2);
    // Stable, then a spike down below the lower band, then a snap back up.
    const closes = [100, 100, 100, 100, 100, 100, 85, 101];
    const signal = strategy.evaluate(candlesFromCloses(closes));
    expect(signal.side).toBe("buy");
  });

  it("signals sell when price falls back below the upper band", () => {
    const strategy = new BollingerStrategy(5, 2);
    const closes = [100, 100, 100, 100, 100, 100, 115, 99];
    const signal = strategy.evaluate(candlesFromCloses(closes));
    expect(signal.side).toBe("sell");
  });

  it("rejects invalid parameters", () => {
    expect(() => new BollingerStrategy(1, 2)).toThrow();
    expect(() => new BollingerStrategy(20, 0)).toThrow();
  });
});
