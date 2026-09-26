import type { Candle } from "../types/index.js";
import { backtest, type BacktestOptions, type BacktestResult } from "./engine.js";
import {
  createStrategy,
  type StrategyName,
  type StrategyParams,
} from "../strategy/index.js";

/** Metric used to rank sweep results. */
export type OptimizeMetric = "return" | "winRate" | "trades";

export interface SweepOptions {
  /** Backtest settings shared across every run (warmup is set per-combo). */
  backtest: Omit<BacktestOptions, "warmup">;
  /** Ranking metric. Defaults to total return. */
  metric?: OptimizeMetric;
  /** Discard combos with fewer than this many trades (avoids overfitting noise). */
  minTrades?: number;
}

export interface SweepEntry {
  params: StrategyParams;
  result: BacktestResult;
}

/**
 * Parse a range spec into a list of numbers. Accepts:
 *   "9"          → [9]
 *   "5,10,15"    → [5, 10, 15]
 *   "5:15:2"     → [5, 7, 9, 11, 13, 15]  (start:end:step, inclusive)
 *   "5:15"       → step defaults to 1
 */
export function parseRange(spec: string): number[] {
  const trimmed = spec.trim();
  if (trimmed.includes(":")) {
    const [start, end, step] = trimmed.split(":").map(Number);
    if (start == null || end == null || Number.isNaN(start) || Number.isNaN(end)) {
      throw new Error(`Invalid range: ${spec}`);
    }
    const s = step == null || Number.isNaN(step) ? 1 : step;
    if (s <= 0) throw new Error(`Range step must be positive: ${spec}`);
    const out: number[] = [];
    for (let v = start; v <= end + 1e-9; v += s) out.push(Number(v.toFixed(10)));
    return out;
  }
  return trimmed.split(",").map((p) => {
    const n = Number(p);
    if (Number.isNaN(n)) throw new Error(`Invalid number in range: ${p}`);
    return n;
  });
}

export interface GridRanges {
  fast?: number[];
  slow?: number[];
  rsiPeriod?: number[];
  oversold?: number[];
  overbought?: number[];
}

/**
 * Expand the relevant ranges for a strategy into concrete parameter combos,
 * dropping invalid ones (fast >= slow, oversold >= overbought).
 */
export function buildGrid(name: StrategyName, ranges: GridRanges): StrategyParams[] {
  const combos: StrategyParams[] = [];
  const base: StrategyParams = {
    fast: 9,
    slow: 21,
    rsiPeriod: 14,
    oversold: 30,
    overbought: 70,
  };

  if (name === "sma" || name === "ema") {
    const fasts = ranges.fast ?? [base.fast];
    const slows = ranges.slow ?? [base.slow];
    for (const fast of fasts) {
      for (const slow of slows) {
        if (fast >= slow) continue;
        combos.push({ ...base, fast, slow });
      }
    }
  } else {
    const periods = ranges.rsiPeriod ?? [base.rsiPeriod];
    const oversolds = ranges.oversold ?? [base.oversold];
    const overboughts = ranges.overbought ?? [base.overbought];
    for (const rsiPeriod of periods) {
      for (const oversold of oversolds) {
        for (const overbought of overboughts) {
          if (oversold >= overbought) continue;
          combos.push({ ...base, rsiPeriod, oversold, overbought });
        }
      }
    }
  }

  return combos;
}

function metricValue(result: BacktestResult, metric: OptimizeMetric): number {
  switch (metric) {
    case "return":
      return result.totalReturnPct;
    case "winRate":
      return result.winRatePct;
    case "trades":
      return result.trades.length;
  }
}

/**
 * Run a backtest for every parameter combo and return them ranked best-first by
 * the chosen metric. Combos below `minTrades` are excluded from the ranking.
 */
export function sweep(
  candles: Candle[],
  name: StrategyName,
  combos: StrategyParams[],
  opts: SweepOptions,
): SweepEntry[] {
  const metric = opts.metric ?? "return";
  const minTrades = opts.minTrades ?? 0;
  const entries: SweepEntry[] = [];

  for (const params of combos) {
    const { strategy, warmup } = createStrategy(name, params);
    const result = backtest(candles, strategy, { ...opts.backtest, warmup });
    if (result.trades.length < minTrades) continue;
    entries.push({ params, result });
  }

  entries.sort((a, b) => metricValue(b.result, metric) - metricValue(a.result, metric));
  return entries;
}
