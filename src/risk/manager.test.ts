import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Position } from "../types/index.js";

// RiskManager reads thresholds from the global config; mock it so each test can set
// the stop-loss / take-profit / trailing values it needs.
const { cfg } = vi.hoisted(() => ({
  cfg: {
    positionPct: 0,
    leverage: 1,
    maxPositionUsd: 100,
    stopLossPct: 2,
    takeProfitPct: 0,
    trailingStopPct: 2,
  },
}));

vi.mock("../config/index.js", () => ({ config: cfg }));

const { RiskManager } = await import("./manager.js");

function longAt(entryPrice: number, peakPrice = entryPrice): Position {
  return { symbol: "BTC/USDT", side: "buy", entryPrice, amount: 1, openedAt: 0, entryFee: 0, peakPrice };
}

describe("RiskManager trailing stop", () => {
  beforeEach(() => {
    cfg.stopLossPct = 2;
    cfg.takeProfitPct = 0;
    cfg.trailingStopPct = 2;
  });

  it("ratchets the peak only in the position's favour", () => {
    const risk = new RiskManager();
    const long = longAt(100);

    expect(risk.trackPeak(long, 110)).toBe(true);
    expect(long.peakPrice).toBe(110);
    // A lower price does not move the peak.
    expect(risk.trackPeak(long, 105)).toBe(false);
    expect(long.peakPrice).toBe(110);

    const short: Position = { ...longAt(100), side: "sell", peakPrice: 100 };
    expect(risk.trackPeak(short, 90)).toBe(true);
    expect(short.peakPrice).toBe(90);
  });

  it("exits on the trailing stop after a retrace from the peak", () => {
    const risk = new RiskManager();
    const long = longAt(100, 110); // peak 110, trail 2% → stop at 107.8
    expect(risk.exitReason(long, 109)).toBeNull();
    expect(risk.exitReason(long, 107.8)).toBe("trailing-stop");
  });

  it("holds while price keeps making new highs", () => {
    const risk = new RiskManager();
    const long = longAt(100, 100);
    risk.trackPeak(long, 130);
    expect(risk.exitReason(long, 130)).toBeNull();
  });

  it("still honours the fixed stop-loss on a trade that never goes green", () => {
    const risk = new RiskManager();
    const long = longAt(100, 100);
    expect(risk.exitReason(long, 98)).toBe("stop-loss");
  });

  it("treats a non-positive take-profit as disabled", () => {
    const risk = new RiskManager();
    cfg.trailingStopPct = 0;
    const long = longAt(100, 100);
    // +50% with TP disabled and no trailing → no exit.
    expect(risk.exitReason(long, 150)).toBeNull();
    cfg.takeProfitPct = 4;
    expect(risk.exitReason(long, 150)).toBe("take-profit");
  });
});
