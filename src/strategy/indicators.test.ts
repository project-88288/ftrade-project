import { describe, it, expect } from "vitest";
import { sma, ema, rsi } from "./indicators.js";

describe("sma", () => {
  it("returns null during warmup then the running average", () => {
    const out = sma([1, 2, 3, 4], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(2, 10); // (1+2+3)/3
    expect(out[3]).toBeCloseTo(3, 10); // (2+3+4)/3
  });
});

describe("ema", () => {
  it("seeds with an SMA then applies the multiplier", () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(2, 10); // seed = (1+2+3)/3
    // k = 2/(3+1) = 0.5; ema[3] = 4*0.5 + 2*0.5 = 3
    expect(out[3]).toBeCloseTo(3, 10);
    // ema[4] = 5*0.5 + 3*0.5 = 4
    expect(out[4]).toBeCloseTo(4, 10);
  });
});

describe("rsi", () => {
  it("returns 100 when there are only gains", () => {
    const out = rsi([1, 2, 3, 4, 5, 6], 3);
    expect(out[3]).toBe(100);
  });

  it("stays within 0..100", () => {
    const prices = [44, 44.25, 44.5, 43.75, 44.5, 45.1, 45.4, 45, 46, 47, 46.5, 46];
    const out = rsi(prices, 5);
    for (const v of out) {
      if (v != null) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });
});
