import { describe, it, expect } from "vitest";
import { TrendBreakStrategy } from "./trendbreak.js";
import type { Candle } from "../types/index.js";

function candle(high: number, low: number, close: number, i: number): Candle {
  return { timestamp: i, open: close, high, low, close, volume: 1 };
}

// A rising base so the trend SMA sits below price, then a breakout candle.
function risingThen(breakoutHigh: number, breakoutClose: number): Candle[] {
  const base = Array.from({ length: 10 }, (_, i) => candle(100 + i, 98 + i, 99 + i, i));
  base.push(candle(breakoutHigh, 108, breakoutClose, 10));
  return base;
}

// A falling base so the trend SMA sits above price, then a breakdown candle.
function fallingThen(breakoutLow: number, breakoutClose: number): Candle[] {
  const base = Array.from({ length: 10 }, (_, i) => candle(102 - i, 100 - i, 101 - i, i));
  base.push(candle(92, breakoutLow, breakoutClose, 10));
  return base;
}

describe("TrendBreakStrategy", () => {
  it("holds when there is not enough data", () => {
    const strategy = new TrendBreakStrategy(3, 5);
    expect(strategy.evaluate(risingThen(200, 200).slice(0, 3)).side).toBe("hold");
  });

  it("buys a breakout that agrees with the uptrend", () => {
    const strategy = new TrendBreakStrategy(3, 5);
    // Close (130) breaks above the prior 3-high and sits above the trend SMA.
    expect(strategy.evaluate(risingThen(131, 130)).side).toBe("buy");
  });

  it("sells a breakdown that agrees with the downtrend", () => {
    const strategy = new TrendBreakStrategy(3, 5);
    // Close (70) breaks below the prior 3-low and sits below the trend SMA.
    expect(strategy.evaluate(fallingThen(69, 70)).side).toBe("sell");
  });

  it("filters out a breakout that fights the trend", () => {
    const strategy = new TrendBreakStrategy(3, 5);
    // Price is in a downtrend, but a single candle pokes above the channel high.
    // Because it is still below the trend SMA, no long is taken.
    const candles = fallingThen(60, 62);
    candles[10] = candle(200, 60, 95, 10); // spike high, but close 95 < trend
    expect(strategy.evaluate(candles).side).toBe("hold");
  });

  it("rejects invalid periods", () => {
    expect(() => new TrendBreakStrategy(1, 50)).toThrow();
    expect(() => new TrendBreakStrategy(50, 20)).toThrow();
  });
});
