import { describe, it, expect } from "vitest";
import { renderMetrics } from "./prometheus.js";
import type { ClosedTrade } from "../state/trade-log.js";
import type { Position } from "../types/index.js";

const trade = (over: Partial<ClosedTrade> = {}): ClosedTrade => ({
  symbol: "BTC/USDT",
  side: "buy",
  entryPrice: 100,
  exitPrice: 120,
  amount: 1,
  entryTime: 1_000,
  exitTime: 2_000,
  grossPnl: 20,
  fees: 1,
  pnl: 19,
  pnlPct: 19,
  reason: "tp",
  ...over,
});

const position = (over: Partial<Position> = {}): Position => ({
  symbol: "ETH/USDT",
  side: "buy",
  entryPrice: 3000,
  amount: 0.05,
  openedAt: 1_000,
  entryFee: 0.1,
  ...over,
});

describe("renderMetrics", () => {
  it("emits HELP and TYPE lines with aggregate values", () => {
    const out = renderMetrics([trade(), trade({ pnl: -5 })], new Map());
    expect(out).toContain("# HELP ftrade_trades_total");
    expect(out).toContain("# TYPE ftrade_trades_total counter");
    expect(out).toContain("ftrade_trades_total 2");
    expect(out).toContain("ftrade_wins_total 1");
    expect(out).toContain("ftrade_losses_total 1");
    expect(out).toContain("ftrade_realized_pnl 14");
    expect(out).toContain("ftrade_fees_total 2");
    expect(out).toContain("ftrade_open_positions 0");
  });

  it("emits labelled per-position gauges when positions are open", () => {
    const positions = new Map<string, Position>([["ETH/USDT", position()]]);
    const out = renderMetrics([], positions);
    expect(out).toContain("ftrade_open_positions 1");
    expect(out).toContain('ftrade_position_entry_price{symbol="ETH/USDT",side="buy"} 3000');
    expect(out).toContain('ftrade_position_amount{symbol="ETH/USDT",side="buy"} 0.05');
  });

  it("omits per-position metrics when flat", () => {
    const out = renderMetrics([trade()], new Map());
    expect(out).not.toContain("ftrade_position_entry_price");
  });

  it("ends with a trailing newline", () => {
    expect(renderMetrics([], new Map()).endsWith("\n")).toBe(true);
  });
});
