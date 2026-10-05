export type Side = "buy" | "sell";

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Signal {
  side: Side | "hold";
  /** Confidence in the signal, 0..1. */
  strength: number;
  reason: string;
}

export interface Position {
  symbol: string;
  side: Side;
  entryPrice: number;
  amount: number;
  openedAt: number;
  /** Fee paid to open the position, in quote currency. */
  entryFee: number;
  /**
   * Best price seen in the position's favour since entry (highest for a long,
   * lowest for a short). Drives the trailing stop; defaults to `entryPrice`.
   */
  peakPrice?: number;
}

/**
 * Yields the signal at candle index `i`, using only data up to and including `i`
 * (no look-ahead). Returned by `Strategy.prepare` for fast backtesting.
 */
export type SignalAt = (i: number) => Signal;

/** A trading strategy evaluates recent candles and emits a signal. */
export interface Strategy {
  readonly name: string;
  evaluate(candles: Candle[]): Signal;
  /**
   * Optional fast path for backtesting. Precompute indicators once over the full
   * candle series and return a function giving the signal at each index using only
   * data up to that index. Results are identical to calling `evaluate` on every
   * growing prefix, but the whole backtest is O(N) instead of O(N²) — the engine
   * uses it when present and falls back to per-candle `evaluate` otherwise.
   */
  prepare?(candles: Candle[]): SignalAt;
}

/** Per-symbol strategy override; unset fields fall back to the global config. */
export interface SymbolStrategyOverride {
  strategy?: string;
  fast?: number;
  slow?: number;
  rsiPeriod?: number;
  oversold?: number;
  overbought?: number;
}
