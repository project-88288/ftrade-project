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
}

/** A trading strategy evaluates recent candles and emits a signal. */
export interface Strategy {
  readonly name: string;
  evaluate(candles: Candle[]): Signal;
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
