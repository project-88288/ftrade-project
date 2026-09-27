import { describe, it, expect } from "vitest";
import { sma, ema, rsi, macd, bollingerBands, stochastic, donchian } from "./indicators.js";

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

describe("macd", () => {
  it("is null during warmup and defined once the signal line seeds", () => {
    const values = Array.from({ length: 40 }, (_, i) => 100 + i);
    const { macd: line, signal, histogram } = macd(values, 3, 6, 4);
    // MACD line needs the slow EMA (index 5+); signal needs 4 more MACD values.
    expect(line[4]).toBeNull();
    expect(line[5]).not.toBeNull();
    expect(signal[7]).toBeNull();
    expect(signal[8]).not.toBeNull();
    // On a steady uptrend the fast EMA leads the slow one, so the MACD line is
    // positive; the histogram is always the MACD-minus-signal difference.
    const i = values.length - 1;
    expect(line[i]!).toBeGreaterThan(0);
    expect(histogram[i]!).toBeCloseTo(line[i]! - signal[i]!, 10);
  });
});

describe("bollingerBands", () => {
  it("collapses to the mean when prices are flat", () => {
    const { middle, upper, lower } = bollingerBands([5, 5, 5, 5], 3, 2);
    expect(middle[2]).toBeCloseTo(5, 10);
    expect(upper[2]).toBeCloseTo(5, 10); // zero variance → bands touch the mean
    expect(lower[2]).toBeCloseTo(5, 10);
  });

  it("places bands symmetrically around the mean", () => {
    const { middle, upper, lower } = bollingerBands([1, 2, 3, 4, 5], 5, 2);
    const i = 4;
    expect(middle[i]).toBeCloseTo(3, 10);
    expect(upper[i]! - middle[i]!).toBeCloseTo(middle[i]! - lower[i]!, 10);
  });
});

describe("stochastic", () => {
  it("is 100 at the top of the range and 0 at the bottom", () => {
    const highs = [10, 11, 12, 13];
    const lows = [5, 6, 7, 8];
    const atHigh = stochastic(highs, lows, [13, 13, 13, 13], 3, 1);
    expect(atHigh.k[3]).toBeCloseTo(100, 10); // close == highest high
    const atLow = stochastic(highs, lows, [6, 6, 6, 6], 3, 1);
    expect(atLow.k[3]).toBeCloseTo(0, 10); // close == lowest low
  });
});

describe("donchian", () => {
  it("reports the prior window's extremes, excluding the current candle", () => {
    const highs = [1, 3, 2, 5, 4];
    const lows = [1, 0, 2, 1, 3];
    const { upper, lower } = donchian(highs, lows, 2);
    expect(upper[0]).toBeNull(); // no prior window yet
    expect(upper[2]).toBeCloseTo(3, 10); // max(high[0], high[1]) = max(1,3)
    expect(lower[2]).toBeCloseTo(0, 10); // min(low[0], low[1]) = min(1,0)
    expect(upper[4]).toBeCloseTo(5, 10); // max(high[2], high[3]) = max(2,5)
  });
});
