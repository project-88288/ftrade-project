import { describe, it, expect } from "vitest";
import { MacdStrategy } from "./macd.js";
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

describe("MacdStrategy", () => {
  it("holds when there is not enough data", () => {
    const strategy = new MacdStrategy(12, 26, 9);
    expect(strategy.evaluate(candlesFromCloses([1, 2, 3])).side).toBe("hold");
  });

  // A flat lead-in lets the MACD and signal lines converge near zero before the
  // final move, so the reversal produces a clean crossover on the last candle.
  const flat = new Array(10).fill(100);

  it("signals buy when MACD crosses above the signal line", () => {
    const strategy = new MacdStrategy(3, 6, 4);
    const closes = [...flat, 98, 96, 94, 96, 100];
    const signal = strategy.evaluate(candlesFromCloses(closes));
    expect(signal.side).toBe("buy");
  });

  it("signals sell when MACD crosses below the signal line", () => {
    const strategy = new MacdStrategy(3, 6, 4);
    const closes = [...flat, 102, 104, 106, 104, 100];
    const signal = strategy.evaluate(candlesFromCloses(closes));
    expect(signal.side).toBe("sell");
  });

  it("rejects invalid periods", () => {
    expect(() => new MacdStrategy(26, 12, 9)).toThrow();
    expect(() => new MacdStrategy(12, 26, 0)).toThrow();
  });
});
