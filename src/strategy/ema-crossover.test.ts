import { describe, it, expect } from "vitest";
import { EmaCrossoverStrategy } from "./ema-crossover.js";
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

describe("EmaCrossoverStrategy", () => {
  it("holds when there is not enough data", () => {
    const strategy = new EmaCrossoverStrategy(3, 5);
    expect(strategy.evaluate(candlesFromCloses([1, 2, 3])).side).toBe("hold");
  });

  it("signals buy on an upward crossover", () => {
    const strategy = new EmaCrossoverStrategy(2, 4);
    const signal = strategy.evaluate(candlesFromCloses([10, 9, 8, 7, 6, 30]));
    expect(signal.side).toBe("buy");
  });

  it("signals sell on a downward crossover", () => {
    const strategy = new EmaCrossoverStrategy(2, 4);
    const signal = strategy.evaluate(candlesFromCloses([6, 7, 8, 9, 10, 1]));
    expect(signal.side).toBe("sell");
  });

  it("rejects invalid periods", () => {
    expect(() => new EmaCrossoverStrategy(5, 5)).toThrow();
  });
});
