import { describe, it, expect } from "vitest";
import { resolveSymbolStrategies, type StrategyParams } from "./index.js";

const defaultParams: StrategyParams = {
  fast: 9,
  slow: 21,
  rsiPeriod: 14,
  oversold: 30,
  overbought: 70,
};

describe("resolveSymbolStrategies", () => {
  it("uses the global default for symbols without an override", () => {
    const map = resolveSymbolStrategies(["BTC/USDT", "ETH/USDT"], "sma", defaultParams);
    expect(map.get("BTC/USDT")?.strategy.name).toBe("SMA(9/21)");
    expect(map.get("ETH/USDT")?.strategy.name).toBe("SMA(9/21)");
  });

  it("applies a per-symbol strategy override", () => {
    const map = resolveSymbolStrategies(["BTC/USDT", "ETH/USDT"], "sma", defaultParams, {
      "ETH/USDT": { strategy: "rsi", rsiPeriod: 7 },
    });
    expect(map.get("BTC/USDT")?.strategy.name).toBe("SMA(9/21)");
    expect(map.get("ETH/USDT")?.strategy.name).toBe("RSI(7, 30/70)");
    expect(map.get("ETH/USDT")?.warmup).toBe(8); // rsiPeriod + 1
  });

  it("merges override params over the defaults", () => {
    const map = resolveSymbolStrategies(["BTC/USDT"], "ema", defaultParams, {
      "BTC/USDT": { fast: 12, slow: 26 },
    });
    expect(map.get("BTC/USDT")?.strategy.name).toBe("EMA(12/26)");
  });

  it("throws on an unknown strategy name in an override", () => {
    expect(() =>
      resolveSymbolStrategies(["BTC/USDT"], "sma", defaultParams, {
        "BTC/USDT": { strategy: "bogus" },
      }),
    ).toThrow(/bogus/);
  });
});
