import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PositionStore } from "./store.js";
import type { Position } from "../types/index.js";

const btc: Position = {
  symbol: "BTC/USDT",
  side: "buy",
  entryPrice: 50000,
  amount: 0.002,
  openedAt: 1_700_000_000_000,
  entryFee: 0.1,
};

const eth: Position = {
  symbol: "ETH/USDT",
  side: "sell",
  entryPrice: 3000,
  amount: 0.05,
  openedAt: 1_700_000_100_000,
  entryFee: 0.15,
};

describe("PositionStore", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ftrade-state-"));
    file = join(dir, "state.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns an empty map when the file does not exist", async () => {
    const store = new PositionStore(file);
    expect(await store.load()).toEqual(new Map());
  });

  it("round-trips multiple positions keyed by symbol", async () => {
    const store = new PositionStore(file);
    await store.save(new Map([[btc.symbol, btc], [eth.symbol, eth]]));
    const loaded = await store.load();
    expect(loaded.size).toBe(2);
    expect(loaded.get("BTC/USDT")).toEqual(btc);
    expect(loaded.get("ETH/USDT")).toEqual(eth);
  });

  it("persists removed positions", async () => {
    const store = new PositionStore(file);
    await store.save(new Map([[btc.symbol, btc], [eth.symbol, eth]]));
    await store.save(new Map([[eth.symbol, eth]]));
    const loaded = await store.load();
    expect(loaded.has("BTC/USDT")).toBe(false);
    expect(loaded.has("ETH/USDT")).toBe(true);
  });

  it("survives a fresh store instance (simulated restart)", async () => {
    await new PositionStore(file).save(new Map([[btc.symbol, btc]]));
    const reopened = new PositionStore(file);
    expect((await reopened.load()).get("BTC/USDT")).toEqual(btc);
  });

  it("migrates the legacy single-position format", async () => {
    await writeFile(
      file,
      JSON.stringify({ position: btc, updatedAt: Date.now() }),
      "utf8",
    );
    const loaded = await new PositionStore(file).load();
    expect(loaded.get("BTC/USDT")).toEqual(btc);
  });

  it("treats a corrupt file as no state", async () => {
    await writeFile(file, "{ not valid json", "utf8");
    const store = new PositionStore(file);
    expect(await store.load()).toEqual(new Map());
  });
});
