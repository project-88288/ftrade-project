import { describe, it, expect } from "vitest";
import { StochasticStrategy } from "./stochastic.js";
import type { Candle } from "../types/index.js";

// high == low == close keeps %K driven purely by where the close sits in the
// range of recent closes, which makes the crossover behaviour easy to reason about.
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

describe("StochasticStrategy", () => {
  it("holds when there is not enough data", () => {
    const strategy = new StochasticStrategy(14, 3, 20, 80);
    expect(strategy.evaluate(candlesFromCloses([1, 2, 3])).side).toBe("hold");
  });

  it("signals buy when %K crosses above %D in oversold", () => {
    const strategy = new StochasticStrategy(3, 2, 20, 80);
    // Sustained decline pins the oscillator at oversold, then a bounce crosses %K up.
    const closes = [20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 14];
    expect(strategy.evaluate(candlesFromCloses(closes)).side).toBe("buy");
  });

  it("signals sell when %K crosses below %D in overbought", () => {
    const strategy = new StochasticStrategy(3, 2, 20, 80);
    const closes = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 16];
    expect(strategy.evaluate(candlesFromCloses(closes)).side).toBe("sell");
  });

  it("rejects invalid parameters", () => {
    expect(() => new StochasticStrategy(1, 3, 20, 80)).toThrow();
    expect(() => new StochasticStrategy(14, 3, 80, 20)).toThrow();
  });
});
