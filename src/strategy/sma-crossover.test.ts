import { describe, it, expect } from "vitest";
import { SmaCrossoverStrategy } from "./sma-crossover.js";
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

describe("SmaCrossoverStrategy", () => {
  it("holds when there is not enough data", () => {
    const strategy = new SmaCrossoverStrategy(3, 5);
    const signal = strategy.evaluate(candlesFromCloses([1, 2, 3]));
    expect(signal.side).toBe("hold");
  });

  it("signals buy on an upward crossover", () => {
    const strategy = new SmaCrossoverStrategy(2, 3);
    // Downtrend then a sharp reversal so the fast SMA crosses above the slow.
    const signal = strategy.evaluate(candlesFromCloses([10, 8, 6, 4, 20]));
    expect(signal.side).toBe("buy");
  });

  it("signals sell on a downward crossover", () => {
    const strategy = new SmaCrossoverStrategy(2, 3);
    const signal = strategy.evaluate(candlesFromCloses([4, 6, 8, 10, 1]));
    expect(signal.side).toBe("sell");
  });

  it("rejects invalid periods", () => {
    expect(() => new SmaCrossoverStrategy(5, 5)).toThrow();
  });
});
