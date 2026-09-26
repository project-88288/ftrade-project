import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TradeLog, closeTrade, summarize } from "./trade-log.js";
import type { Position } from "../types/index.js";

const longPosition: Position = {
  symbol: "BTC/USDT",
  side: "buy",
  entryPrice: 100,
  amount: 2,
  openedAt: 1_000,
  entryFee: 0,
};

describe("closeTrade", () => {
  it("computes gross PnL and percent for a winning long", () => {
    const t = closeTrade(longPosition, 120, "take-profit", 0, 2_000);
    expect(t.grossPnl).toBeCloseTo(40, 5); // (120-100)*2
    expect(t.pnl).toBeCloseTo(40, 5); // no fees
    expect(t.pnlPct).toBeCloseTo(20, 5); // 40 / (100*2)
    expect(t.entryTime).toBe(1_000);
    expect(t.exitTime).toBe(2_000);
    expect(t.reason).toBe("take-profit");
  });

  it("nets out entry and exit fees", () => {
    const withEntryFee: Position = { ...longPosition, entryFee: 0.5 };
    const t = closeTrade(withEntryFee, 120, "tp", 0.7, 2_000);
    expect(t.grossPnl).toBeCloseTo(40, 5);
    expect(t.fees).toBeCloseTo(1.2, 5); // 0.5 entry + 0.7 exit
    expect(t.pnl).toBeCloseTo(38.8, 5); // 40 - 1.2
    expect(t.pnlPct).toBeCloseTo(19.4, 5); // 38.8 / 200
  });

  it("computes PnL for a short position", () => {
    const short: Position = { ...longPosition, side: "sell" };
    const t = closeTrade(short, 90, "signal", 0, 2_000);
    expect(t.pnl).toBeCloseTo(20, 5); // (100-90)*2
  });
});

describe("summarize", () => {
  it("aggregates wins, losses, totals and fees", () => {
    const s = summarize([
      closeTrade({ ...longPosition, entryFee: 1 }, 120, "tp", 1), // gross +40, fees 2, net +38
      closeTrade(longPosition, 90, "sl"), // -20
      closeTrade(longPosition, 110, "tp"), // +20
    ]);
    expect(s.trades).toBe(3);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(1);
    expect(s.totalGrossPnl).toBeCloseTo(40, 5);
    expect(s.totalFees).toBeCloseTo(2, 5);
    expect(s.totalPnl).toBeCloseTo(38, 5);
    expect(s.bestPnl).toBeCloseTo(38, 5);
    expect(s.worstPnl).toBeCloseTo(-20, 5);
  });

  it("handles an empty log", () => {
    const s = summarize([]);
    expect(s.trades).toBe(0);
    expect(s.winRatePct).toBe(0);
    expect(s.totalPnl).toBe(0);
    expect(s.totalFees).toBe(0);
  });
});

describe("TradeLog", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ftrade-trades-"));
    file = join(dir, "trades.jsonl");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns an empty array when no file exists", async () => {
    expect(await new TradeLog(file).readAll()).toEqual([]);
  });

  it("appends and reads back trades in order", async () => {
    const log = new TradeLog(file);
    await log.append(closeTrade(longPosition, 120, "tp", 0, 2_000));
    await log.append(closeTrade(longPosition, 90, "sl", 0, 3_000));
    const trades = await log.readAll();
    expect(trades).toHaveLength(2);
    expect(trades[0]!.exitTime).toBe(2_000);
    expect(trades[1]!.pnl).toBeCloseTo(-20, 5);
  });

  it("skips corrupt lines", async () => {
    await writeFile(
      file,
      JSON.stringify(closeTrade(longPosition, 120, "tp", 0, 2_000)) + "\n{ bad json\n",
      "utf8",
    );
    const trades = await new TradeLog(file).readAll();
    expect(trades).toHaveLength(1);
  });
});
