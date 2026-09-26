import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PositionStore } from "./store.js";
import type { Position } from "../types/index.js";

const samplePosition: Position = {
  symbol: "BTC/USDT",
  side: "buy",
  entryPrice: 50000,
  amount: 0.002,
  openedAt: 1_700_000_000_000,
  entryFee: 0.1,
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

  it("returns null when the file does not exist", async () => {
    const store = new PositionStore(file);
    expect(await store.load()).toBeNull();
  });

  it("round-trips a saved position", async () => {
    const store = new PositionStore(file);
    await store.save(samplePosition);
    const loaded = await store.load();
    expect(loaded).toEqual(samplePosition);
  });

  it("persists a cleared position as null", async () => {
    const store = new PositionStore(file);
    await store.save(samplePosition);
    await store.save(null);
    expect(await store.load()).toBeNull();
  });

  it("survives a fresh store instance (simulated restart)", async () => {
    await new PositionStore(file).save(samplePosition);
    const reopened = new PositionStore(file);
    expect(await reopened.load()).toEqual(samplePosition);
  });

  it("treats a corrupt file as no state", async () => {
    await writeFile(file, "{ not valid json", "utf8");
    const store = new PositionStore(file);
    expect(await store.load()).toBeNull();
  });
});
