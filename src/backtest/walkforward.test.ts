import { describe, it, expect } from "vitest";
import { walkForward } from "./walkforward.js";
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

describe("walkForward", () => {
  // Repeating V-shapes drive plenty of crossovers in every window.
  const seg = (base: number) => [
    ...Array.from({ length: 30 }, (_, i) => base + 30 - i),
    ...Array.from({ length: 30 }, (_, i) => base + i),
  ];
  const candles = candlesFromCloses([
    ...seg(100),
    ...seg(120),
    ...seg(110),
    ...seg(130),
  ]);
  const combos = buildGrid("sma", { fast: [2, 3], slow: [5, 8] });

  it("produces one fold per step with out-of-sample results", () => {
    const result = walkForward(candles, "sma", combos, 0.5, 3, {
      backtest: { initialCash: 10000, positionUsd: 100, feeRate: 0 },
      metric: "return",
      minTrades: 1,
    });

    expect(result.folds).toHaveLength(3);
    for (const f of result.folds) {
      expect(f.bestParams.fast).toBeLessThan(f.bestParams.slow);
      expect(f.trainCandles).toBeGreaterThan(0);
      expect(f.testCandles).toBeGreaterThan(0);
    }
    expect(result.profitableFolds).toBeLessThanOrEqual(result.folds.length);
    expect(result.oosTrades).toBeGreaterThan(0);
  });

  it("rolls the training window forward each fold", () => {
    const result = walkForward(candles, "sma", combos, 0.5, 3, {
      backtest: { initialCash: 10000, positionUsd: 100, feeRate: 0 },
      minTrades: 1,
    });
    // A fixed-size rolling window: every fold trains on the same number of candles.
    const trainSizes = new Set(result.folds.map((f) => f.trainCandles));
    expect(trainSizes.size).toBe(1);
  });

  it("validates its inputs", () => {
    const opts = {
      backtest: { initialCash: 10000, positionUsd: 100, feeRate: 0 },
      minTrades: 1,
    };
    expect(() => walkForward(candles, "sma", combos, 0, 3, opts)).toThrow();
    expect(() => walkForward(candles, "sma", combos, 0.5, 0, opts)).toThrow();
  });
});
