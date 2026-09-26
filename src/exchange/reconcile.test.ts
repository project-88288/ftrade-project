import { describe, it, expect } from "vitest";
import { reconcilePosition } from "./reconcile.js";
import type { Position } from "../types/index.js";

const longPosition: Position = {
  symbol: "BTC/USDT",
  side: "buy",
  entryPrice: 50000,
  amount: 1,
  openedAt: 1_000,
  entryFee: 0.5,
};

describe("reconcilePosition", () => {
  it("confirms flat when there is no position and no balance", () => {
    const r = reconcilePosition(null, 0);
    expect(r.status).toBe("flat-confirmed");
    expect(r.position).toBeNull();
    expect(r.changed).toBe(false);
  });

  it("warns but stays flat on an unexpected balance", () => {
    const r = reconcilePosition(null, 0.5);
    expect(r.status).toBe("unexpected-balance");
    expect(r.position).toBeNull();
    expect(r.changed).toBe(false);
  });

  it("keeps a long that matches the balance within tolerance", () => {
    const r = reconcilePosition(longPosition, 1.01, { tolerance: 0.02 });
    expect(r.status).toBe("match");
    expect(r.position).toBe(longPosition);
    expect(r.changed).toBe(false);
  });

  it("clears a long that was closed while the bot was down", () => {
    const r = reconcilePosition(longPosition, 0);
    expect(r.status).toBe("closed-externally");
    expect(r.position).toBeNull();
    expect(r.changed).toBe(true);
  });

  it("adjusts the amount when the balance drifted beyond tolerance", () => {
    const r = reconcilePosition(longPosition, 0.5, { tolerance: 0.02 });
    expect(r.status).toBe("quantity-adjusted");
    expect(r.position?.amount).toBe(0.5);
    // Preserves the original entry price/fee.
    expect(r.position?.entryPrice).toBe(50000);
    expect(r.position?.entryFee).toBe(0.5);
    expect(r.changed).toBe(true);
  });

  it("respects the dust threshold when clearing a long", () => {
    const r = reconcilePosition(longPosition, 0.0000001, { dust: 0.001 });
    expect(r.status).toBe("closed-externally");
    expect(r.position).toBeNull();
  });

  it("cannot verify a short from a spot balance", () => {
    const short: Position = { ...longPosition, side: "sell" };
    const r = reconcilePosition(short, 0);
    expect(r.status).toBe("unverifiable-short");
    expect(r.position).toBe(short);
    expect(r.changed).toBe(false);
  });
});
