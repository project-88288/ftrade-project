import { describe, it, expect } from "vitest";
import { DonchianStrategy } from "./donchian.js";
import type { Candle } from "../types/index.js";

function candle(high: number, low: number, close: number, i: number): Candle {
  return { timestamp: i, open: close, high, low, close, volume: 1 };
}

describe("DonchianStrategy", () => {
  it("holds when there is not enough data", () => {
    const strategy = new DonchianStrategy(20);
    const candles = [candle(1, 1, 1, 0), candle(2, 2, 2, 1)];
    expect(strategy.evaluate(candles).side).toBe("hold");
  });

  it("signals buy on a breakout above the prior channel high", () => {
    const strategy = new DonchianStrategy(3);
    // Prior 3 highs top out at 12; the final close of 20 breaks above it.
    const candles = [
      candle(10, 8, 9, 0),
      candle(11, 9, 10, 1),
      candle(12, 10, 11, 2),
      candle(20, 10, 20, 3),
    ];
    expect(strategy.evaluate(candles).side).toBe("buy");
  });

  it("signals sell on a breakdown below the prior channel low", () => {
    const strategy = new DonchianStrategy(3);
    // Prior 3 lows bottom at 8; the final close of 5 breaks below it.
    const candles = [
      candle(12, 10, 11, 0),
      candle(11, 9, 10, 1),
      candle(10, 8, 9, 2),
      candle(9, 5, 5, 3),
    ];
    expect(strategy.evaluate(candles).side).toBe("sell");
  });

  it("rejects an invalid period", () => {
    expect(() => new DonchianStrategy(1)).toThrow();
  });
});
