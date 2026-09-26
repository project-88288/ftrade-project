import { readFile } from "node:fs/promises";
import ccxt, { type Exchange } from "ccxt";
import type { Candle } from "../types/index.js";

/**
 * Fetch historical candles from an exchange, paginating backwards from now until
 * `limit` candles are collected. No API key needed — OHLCV is public.
 */
export async function fetchHistory(
  exchangeId: string,
  symbol: string,
  timeframe: string,
  limit: number,
): Promise<Candle[]> {
  const ExchangeCtor = (ccxt as unknown as Record<string, new (cfg: object) => Exchange>)[
    exchangeId
  ];
  if (!ExchangeCtor) throw new Error(`Unknown exchange id: ${exchangeId}`);
  const exchange = new ExchangeCtor({ enableRateLimit: true });

  const timeframeMs = exchange.parseTimeframe(timeframe) * 1000;
  const pageSize = 1000;
  const candles: Candle[] = [];
  let since = Date.now() - limit * timeframeMs;

  while (candles.length < limit) {
    const raw = await exchange.fetchOHLCV(symbol, timeframe, since, pageSize);
    if (raw.length === 0) break;
    for (const [timestamp, open, high, low, close, volume] of raw) {
      candles.push({
        timestamp: Number(timestamp),
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume),
      });
    }
    const last = raw[raw.length - 1]![0]!;
    since = Number(last) + timeframeMs;
    if (raw.length < pageSize) break;
  }

  return candles.slice(0, limit);
}

/**
 * Load candles from a CSV file. Expected columns:
 * timestamp,open,high,low,close,volume (a header row is auto-detected).
 */
export async function loadCsv(path: string): Promise<Candle[]> {
  const text = await readFile(path, "utf8");
  const lines = text.trim().split(/\r?\n/);
  const candles: Candle[] = [];

  for (const line of lines) {
    const parts = line.split(",");
    const nums = parts.map(Number);
    if (nums.some(Number.isNaN)) continue; // skip header / bad rows
    const [timestamp, open, high, low, close, volume] = nums;
    candles.push({
      timestamp: timestamp!,
      open: open!,
      high: high!,
      low: low!,
      close: close!,
      volume: volume ?? 0,
    });
  }

  return candles;
}
