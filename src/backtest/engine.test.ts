import { describe, it, expect } from "vitest";
import { backtest } from "./engine.js";
import type { Candle, Signal, Strategy } from "../types/index.js";

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

/** A scripted strategy that emits a preset signal at each index. */
class ScriptedStrategy implements Strategy {
  readonly name = "scripted";
  private i = 0;
  constructor(private readonly script: Signal["side"][]) {}
  evaluate(): Signal {
    const side = this.script[this.i] ?? "hold";
    this.i++;
    return { side, strength: 1, reason: "scripted" };
  }
}

describe("backtest", () => {
  it("realises profit on a winning long trade", () => {
    // warmup=0: index 0 buys at 100, index 1 holds, index 2 reverses (sell) at 120.
    // The sell both closes the long AND flips into a short (always-in-market),
    // which is then force-closed at end-of-data at the same price (0 PnL).
    const candles = candlesFromCloses([100, 110, 120]);
    const strategy = new ScriptedStrategy(["buy", "hold", "sell"]);

    const result = backtest(candles, strategy, {
      initialCash: 1000,
      positionUsd: 100,
      feeRate: 0,
      warmup: 0,
    });

    expect(result.trades).toHaveLength(2);
    const trade = result.trades[0]!;
    expect(trade.side).toBe("buy");
    expect(trade.entryPrice).toBe(100);
    expect(trade.exitPrice).toBe(120);
    // amount = 100/100 = 1, move = 20 → pnl = 20
    expect(trade.pnl).toBeCloseTo(20, 5);
    expect(result.finalEquity).toBeCloseTo(1020, 5);
    expect(result.wins).toBe(1);
  });

  it("subtracts fees from PnL", () => {
    const candles = candlesFromCloses([100, 110]);
    const strategy = new ScriptedStrategy(["buy", "sell"]);

    const result = backtest(candles, strategy, {
      initialCash: 1000,
      positionUsd: 100,
      feeRate: 0.01, // 1%
      warmup: 0,
    });

    // gross = 10, fees = 100*0.01 + 110*0.01 = 2.1 → pnl = 7.9
    expect(result.trades[0]!.pnl).toBeCloseTo(7.9, 5);
  });

  it("respects stop-loss", () => {
    const candles = candlesFromCloses([100, 90]);
    const strategy = new ScriptedStrategy(["buy", "hold"]);

    const result = backtest(candles, strategy, {
      initialCash: 1000,
      positionUsd: 100,
      feeRate: 0,
      warmup: 0,
      stopLossPct: 5,
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.reason).toBe("stop-loss");
    expect(result.trades[0]!.pnl).toBeCloseTo(-10, 5);
  });

  it("force-closes an open position at end of data", () => {
    const candles = candlesFromCloses([100, 105]);
    const strategy = new ScriptedStrategy(["buy", "hold"]);

    const result = backtest(candles, strategy, {
      initialCash: 1000,
      positionUsd: 100,
      feeRate: 0,
      warmup: 0,
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.reason).toBe("end-of-data");
  });
});
