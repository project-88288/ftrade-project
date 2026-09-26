import { describe, it, expect } from "vitest";
import { parseRange, buildGrid, sweep } from "./optimize.js";
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

describe("parseRange", () => {
  it("parses a single number", () => {
    expect(parseRange("9")).toEqual([9]);
  });

  it("parses a comma list", () => {
    expect(parseRange("5,10,15")).toEqual([5, 10, 15]);
  });

  it("parses start:end:step inclusive", () => {
    expect(parseRange("5:15:2")).toEqual([5, 7, 9, 11, 13, 15]);
  });

  it("defaults step to 1", () => {
    expect(parseRange("1:4")).toEqual([1, 2, 3, 4]);
  });

  it("rejects a non-positive step", () => {
    expect(() => parseRange("1:4:0")).toThrow();
  });
});

describe("buildGrid", () => {
  it("drops combos where fast >= slow", () => {
    const grid = buildGrid("sma", { fast: [5, 10, 20], slow: [10, 20] });
    // valid: (5,10),(5,20),(10,20) — (10,10),(20,10),(20,20),(10,20 ok) etc filtered
    for (const combo of grid) {
      expect(combo.fast).toBeLessThan(combo.slow);
    }
    expect(grid.length).toBe(3);
  });

  it("drops combos where oversold >= overbought for rsi", () => {
    const grid = buildGrid("rsi", {
      rsiPeriod: [14],
      oversold: [30, 70],
      overbought: [70],
    });
    for (const combo of grid) {
      expect(combo.oversold).toBeLessThan(combo.overbought);
    }
    expect(grid.length).toBe(1);
  });
});

describe("sweep", () => {
  it("ranks combos best-first by return and honours minTrades", () => {
    // V-shape: decline then rise, so the fast SMA crosses the slow at least once.
    const down = Array.from({ length: 30 }, (_, i) => 130 - i);
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    const candles = candlesFromCloses([...down, ...up]);
    const combos = buildGrid("sma", { fast: [2, 3], slow: [5, 8] });

    const ranked = sweep(candles, "sma", combos, {
      backtest: { initialCash: 10000, positionUsd: 100, feeRate: 0 },
      metric: "return",
      minTrades: 1,
    });

    expect(ranked.length).toBeGreaterThan(0);
    // Sorted descending by return.
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1]!.result.totalReturnPct).toBeGreaterThanOrEqual(
        ranked[i]!.result.totalReturnPct,
      );
    }
  });

  it("excludes combos below minTrades", () => {
    const candles = candlesFromCloses(Array.from({ length: 60 }, (_, i) => 100 + i));
    const combos = buildGrid("sma", { fast: [2], slow: [5] });
    const ranked = sweep(candles, "sma", combos, {
      backtest: { initialCash: 10000, positionUsd: 100, feeRate: 0 },
      minTrades: 9999,
    });
    expect(ranked).toHaveLength(0);
  });
});
