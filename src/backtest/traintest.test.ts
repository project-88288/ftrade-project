import { describe, it, expect } from "vitest";
import { splitCandles, trainTest } from "./traintest.js";
import { buildGrid } from "./optimize.js";
import type { Candle } from "../types/index.js";

function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    timestamp: i * 60_000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }));
}

describe("splitCandles", () => {
  it("splits chronologically by ratio", () => {
    const candles = candlesFromCloses(Array.from({ length: 10 }, (_, i) => i));
    const { train, test } = splitCandles(candles, 0.7);
    expect(train).toHaveLength(7);
    expect(test).toHaveLength(3);
    // Test slice comes strictly after the train slice.
    expect(test[0]!.timestamp).toBeGreaterThan(train[train.length - 1]!.timestamp);
  });

  it("rejects ratios outside (0, 1)", () => {
    const candles = candlesFromCloses([1, 2, 3]);
    expect(() => splitCandles(candles, 0)).toThrow();
    expect(() => splitCandles(candles, 1)).toThrow();
  });
});

describe("trainTest", () => {
  it("optimizes on train and reports on the held-out test slice", () => {
    // First half V-shape (drives crossovers in-sample), second half also a V.
    const seg = (base: number) => [
      ...Array.from({ length: 30 }, (_, i) => base + 30 - i),
      ...Array.from({ length: 30 }, (_, i) => base + i),
    ];
    const candles = candlesFromCloses([...seg(100), ...seg(120)]);
    const combos = buildGrid("sma", { fast: [2, 3], slow: [5, 8] });

    const result = trainTest(candles, "sma", combos, 0.5, {
      backtest: { initialCash: 10000, positionUsd: 100, feeRate: 0 },
      metric: "return",
      minTrades: 1,
    });

    expect(result.trainCandles).toBe(60);
    expect(result.testCandles).toBe(60);
    expect(result.bestParams.fast).toBeLessThan(result.bestParams.slow);
    // Best params are the top of the in-sample ranking.
    expect(result.train).toBe(result.ranking[0]!.result);
    expect(result.test).toBeDefined();
  });

  it("throws when no combo trades enough in-sample", () => {
    const candles = candlesFromCloses(Array.from({ length: 60 }, (_, i) => 100 + i));
    const combos = buildGrid("sma", { fast: [2], slow: [5] });
    expect(() =>
      trainTest(candles, "sma", combos, 0.5, {
        backtest: { initialCash: 10000, positionUsd: 100, feeRate: 0 },
        minTrades: 9999,
      }),
    ).toThrow();
  });
});
