import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createDashboardServer } from "./server.js";

const getJson = async (url: string) => (await fetch(url)).json() as Promise<any>;

const trade = (over: Record<string, unknown> = {}) => ({
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

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe("dashboard server", () => {
  let dir: string;
  let file: string;
  let server: Server;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ftrade-dash-"));
    file = join(dir, "trades.jsonl");
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });

  it("serves the HTML page at /", async () => {
    server = createDashboardServer(file);
    const base = await listen(server);
    const res = await fetch(base + "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("<title>ftrade");
  });

  it("returns a summary at /api/summary", async () => {
    await writeFile(file, JSON.stringify(trade()) + "\n" + JSON.stringify(trade({ pnl: -5, grossPnl: -4, fees: 1 })) + "\n");
    server = createDashboardServer(file);
    const base = await listen(server);
    const summary = await getJson(base + "/api/summary");
    expect(summary.trades).toBe(2);
    expect(summary.wins).toBe(1);
    expect(summary.totalPnl).toBeCloseTo(14, 5);
    expect(summary.totalFees).toBeCloseTo(2, 5);
  });

  it("returns trades newest-first at /api/trades", async () => {
    await writeFile(
      file,
      JSON.stringify(trade({ exitTime: 1000 })) + "\n" + JSON.stringify(trade({ exitTime: 5000 })) + "\n",
    );
    server = createDashboardServer(file);
    const base = await listen(server);
    const trades = await getJson(base + "/api/trades");
    expect(trades).toHaveLength(2);
    expect(trades[0].exitTime).toBe(5000); // most recent first
  });

  it("returns an empty summary when the log is missing", async () => {
    server = createDashboardServer(file);
    const base = await listen(server);
    const summary = await getJson(base + "/api/summary");
    expect(summary.trades).toBe(0);
  });

  it("404s an unknown path", async () => {
    server = createDashboardServer(file);
    const base = await listen(server);
    const res = await fetch(base + "/nope");
    expect(res.status).toBe(404);
  });

  it("serves Prometheus metrics at /metrics", async () => {
    await writeFile(file, JSON.stringify(trade()) + "\n");
    server = createDashboardServer(file);
    const base = await listen(server);
    const res = await fetch(base + "/metrics");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    expect(body).toContain("ftrade_trades_total 1");
    expect(body).toContain("ftrade_realized_pnl 19");
  });
});
