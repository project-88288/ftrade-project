import { describe, it, expect } from "vitest";
import { RsiStrategy } from "./rsi.js";
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

describe("RsiStrategy", () => {
  it("holds when there is not enough data", () => {
    const strategy = new RsiStrategy(14);
    expect(strategy.evaluate(candlesFromCloses([1, 2, 3])).side).toBe("hold");
  });

  it("signals buy when RSI crosses up out of oversold", () => {
    const strategy = new RsiStrategy(3, 30, 70);
    // A steep decline drives RSI deep into oversold, then a bounce crosses it back up.
    const closes = [100, 90, 80, 70, 60, 50, 40, 30, 20, 60];
    const signal = strategy.evaluate(candlesFromCloses(closes));
    expect(signal.side).toBe("buy");
  });

  it("signals sell when RSI crosses down out of overbought", () => {
    const strategy = new RsiStrategy(3, 30, 70);
    const closes = [20, 30, 40, 50, 60, 70, 80, 90, 100, 40];
    const signal = strategy.evaluate(candlesFromCloses(closes));
    expect(signal.side).toBe("sell");
  });

  it("rejects invalid thresholds", () => {
    expect(() => new RsiStrategy(14, 70, 30)).toThrow();
    expect(() => new RsiStrategy(1)).toThrow();
  });
});
