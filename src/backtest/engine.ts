import type { Candle, Side, SignalAt, Strategy } from "../types/index.js";

export interface BacktestOptions {
  /** Starting cash in quote currency (e.g. USDT). */
  initialCash: number;
  /** Notional size per trade in quote currency. */
  positionUsd: number;
  /** Taker fee as a fraction, e.g. 0.001 = 0.1%. */
  feeRate: number;
  /** Minimum candles the strategy needs before it can be evaluated. */
  warmup: number;
  /** Optional stop-loss / take-profit as percentages (<= 0 disables). */
  stopLossPct?: number;
  takeProfitPct?: number;
  /**
   * Optional trailing stop as a % retracement from the best price seen since entry
   * (<= 0 disables). Ratchets toward profit and never loosens.
   */
  trailingStopPct?: number;
}

export interface Trade {
  side: Side;
  entryPrice: number;
  exitPrice: number;
  amount: number;
  entryTime: number;
  exitTime: number;
  /** Realised profit in quote currency, net of fees. */
  pnl: number;
  reason: string;
}

export interface BacktestResult {
  strategy: string;
  initialCash: number;
  finalEquity: number;
  totalReturnPct: number;
  trades: Trade[];
  wins: number;
  losses: number;
  winRatePct: number;
  maxDrawdownPct: number;
}

interface OpenPosition {
  side: Side;
  entryPrice: number;
  amount: number;
  entryTime: number;
  /** Best close seen in the position's favour since entry; drives the trailing stop. */
  peak: number;
}

/**
 * Event-driven backtester. Walks candles one at a time, feeding the strategy only
 * the data available up to that point (no look-ahead), and simulates fills at the
 * candle close with a flat fee. Long/short with optional SL/TP.
 */
export function backtest(
  candles: Candle[],
  strategy: Strategy,
  opts: BacktestOptions,
): BacktestResult {
  let cash = opts.initialCash;
  let position: OpenPosition | null = null;
  const trades: Trade[] = [];

  let peakEquity = opts.initialCash;
  let maxDrawdownPct = 0;

  // Prefer the strategy's precomputed path (indicators computed once over the whole
  // series, O(N)); otherwise fall back to re-evaluating each growing prefix (O(N²)).
  const evalAt: SignalAt = strategy.prepare
    ? strategy.prepare(candles)
    : (i) => strategy.evaluate(candles.slice(0, i + 1));

  // Cash tracks realised equity (initialCash + sum of closed PnL). While a
  // position is open, equity is cash plus the unrealised move.
  const equityAt = (price: number): number => {
    if (!position) return cash;
    const move =
      position.side === "buy"
        ? price - position.entryPrice
        : position.entryPrice - price;
    return cash + move * position.amount;
  };

  const close = (exitPrice: number, exitTime: number, reason: string) => {
    if (!position) return;
    const gross =
      position.side === "buy"
        ? (exitPrice - position.entryPrice) * position.amount
        : (position.entryPrice - exitPrice) * position.amount;
    const entryFee = position.entryPrice * position.amount * opts.feeRate;
    const exitFee = exitPrice * position.amount * opts.feeRate;
    const pnl = gross - entryFee - exitFee;
    cash += pnl;
    trades.push({
      side: position.side,
      entryPrice: position.entryPrice,
      exitPrice,
      amount: position.amount,
      entryTime: position.entryTime,
      exitTime,
      pnl,
      reason,
    });
    position = null;
  };

  for (let i = opts.warmup; i < candles.length; i++) {
    const candle = candles[i]!;
    const price = candle.close;

    // Check stops on any open position first (evaluated on the close, matching the
    // live bot's per-poll price). SL/TP/trailing with a value <= 0 are disabled.
    if (position) {
      position.peak =
        position.side === "buy"
          ? Math.max(position.peak, price)
          : Math.min(position.peak, price);

      const change = (price - position.entryPrice) / position.entryPrice;
      const move = (position.side === "buy" ? change : -change) * 100;
      const retrace =
        position.side === "buy"
          ? (position.peak - price) / position.peak
          : (price - position.peak) / position.peak;

      if (opts.stopLossPct != null && opts.stopLossPct > 0 && move <= -opts.stopLossPct) {
        close(price, candle.timestamp, "stop-loss");
      } else if (opts.takeProfitPct != null && opts.takeProfitPct > 0 && move >= opts.takeProfitPct) {
        close(price, candle.timestamp, "take-profit");
      } else if (
        opts.trailingStopPct != null &&
        opts.trailingStopPct > 0 &&
        retrace * 100 >= opts.trailingStopPct
      ) {
        close(price, candle.timestamp, "trailing-stop");
      }
    }

    const signal = evalAt(i);

    if (position) {
      // Exit when the strategy flips against the position.
      const opposite: Side = position.side === "buy" ? "sell" : "buy";
      if (signal.side === opposite) {
        close(price, candle.timestamp, "signal-reverse");
      }
    }

    if (!position && (signal.side === "buy" || signal.side === "sell")) {
      const amount = opts.positionUsd / price;
      position = {
        side: signal.side,
        entryPrice: price,
        amount,
        entryTime: candle.timestamp,
        peak: price,
      };
    }

    // Track drawdown on marked-to-market equity.
    const equity = equityAt(price);
    peakEquity = Math.max(peakEquity, equity);
    if (peakEquity > 0) {
      const dd = ((peakEquity - equity) / peakEquity) * 100;
      maxDrawdownPct = Math.max(maxDrawdownPct, dd);
    }
  }

  // Force-close any position at the last candle.
  if (position && candles.length > 0) {
    const last = candles[candles.length - 1]!;
    close(last.close, last.timestamp, "end-of-data");
  }

  const wins = trades.filter((t) => t.pnl > 0).length;
  const losses = trades.filter((t) => t.pnl <= 0).length;

  return {
    strategy: strategy.name,
    initialCash: opts.initialCash,
    finalEquity: cash,
    totalReturnPct: ((cash - opts.initialCash) / opts.initialCash) * 100,
    trades,
    wins,
    losses,
    winRatePct: trades.length > 0 ? (wins / trades.length) * 100 : 0,
    maxDrawdownPct,
  };
}
