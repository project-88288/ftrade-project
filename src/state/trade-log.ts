import { appendFile, readFile } from "node:fs/promises";
import type { Position } from "../types/index.js";

export interface ClosedTrade {
  symbol: string;
  side: Position["side"];
  entryPrice: number;
  exitPrice: number;
  amount: number;
  entryTime: number;
  exitTime: number;
  /** Realized profit in quote currency (gross — excludes exchange fees). */
  pnl: number;
  /** Return on the position's notional, as a percentage. */
  pnlPct: number;
  reason: string;
}

/** Compute the realized trade record for a position being closed at `exitPrice`. */
export function closeTrade(
  position: Position,
  exitPrice: number,
  reason: string,
  exitTime = Date.now(),
): ClosedTrade {
  const gross =
    position.side === "buy"
      ? (exitPrice - position.entryPrice) * position.amount
      : (position.entryPrice - exitPrice) * position.amount;
  const notional = position.entryPrice * position.amount;
  return {
    symbol: position.symbol,
    side: position.side,
    entryPrice: position.entryPrice,
    exitPrice,
    amount: position.amount,
    entryTime: position.openedAt,
    exitTime,
    pnl: gross,
    pnlPct: notional > 0 ? (gross / notional) * 100 : 0,
    reason,
  };
}

export interface TradeSummary {
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  totalPnl: number;
  avgPnl: number;
  bestPnl: number;
  worstPnl: number;
}

/**
 * Append-only trade log backed by a JSON Lines file — one JSON record per line,
 * so writes are a simple append and the file stays readable/greppable.
 */
export class TradeLog {
  constructor(private readonly filePath: string) {}

  async append(trade: ClosedTrade): Promise<void> {
    await appendFile(this.filePath, JSON.stringify(trade) + "\n", "utf8");
  }

  async readAll(): Promise<ClosedTrade[]> {
    let text: string;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const trades: ClosedTrade[] = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        trades.push(JSON.parse(trimmed) as ClosedTrade);
      } catch {
        // Skip a corrupt line rather than failing the whole report.
      }
    }
    return trades;
  }
}

export function summarize(trades: ClosedTrade[]): TradeSummary {
  const wins = trades.filter((t) => t.pnl > 0).length;
  const losses = trades.filter((t) => t.pnl <= 0).length;
  const pnls = trades.map((t) => t.pnl);
  const totalPnl = pnls.reduce((a, b) => a + b, 0);
  return {
    trades: trades.length,
    wins,
    losses,
    winRatePct: trades.length > 0 ? (wins / trades.length) * 100 : 0,
    totalPnl,
    avgPnl: trades.length > 0 ? totalPnl / trades.length : 0,
    bestPnl: pnls.length > 0 ? Math.max(...pnls) : 0,
    worstPnl: pnls.length > 0 ? Math.min(...pnls) : 0,
  };
}
