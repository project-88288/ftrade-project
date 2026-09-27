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

/**
 * Build the grid ranges relevant to a strategy from parsed CLI args, using the
 * shared option names (e.g. --fast, --bb-period). Shared by the optimize and
 * traintest CLIs so both accept the same flags.
 */
export function rangesFromArgs(
  name: StrategyName,
  values: Record<string, string | undefined>,
): GridRanges {
  const r = (key: string) => parseRange(values[key]!);
  switch (name) {
    case "rsi":
      return { rsiPeriod: r("rsi-period"), oversold: r("oversold"), overbought: r("overbought") };
    case "macd":
      return { fast: r("fast"), slow: r("slow"), signal: r("signal") };
    case "bollinger":
      return { bbPeriod: r("bb-period"), bbStdDev: r("bb-stddev") };
    case "stochastic":
      return {
        stochK: r("stoch-k"),
        stochD: r("stoch-d"),
        oversold: r("oversold"),
        overbought: r("overbought"),
      };
    case "donchian":
      return { donchianPeriod: r("donchian-period") };
    case "trendbreak":
      return { donchianPeriod: r("donchian-period"), trendPeriod: r("trend-period") };
    default: // sma, ema
      return { fast: r("fast"), slow: r("slow") };
  }
}

export interface GridRanges {
  fast?: number[];
  slow?: number[];
  signal?: number[];
  rsiPeriod?: number[];
  oversold?: number[];
  overbought?: number[];
  bbPeriod?: number[];
  bbStdDev?: number[];
  stochK?: number[];
  stochD?: number[];
  donchianPeriod?: number[];
  trendPeriod?: number[];
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
    signal: 9,
    rsiPeriod: 14,
    oversold: 30,
    overbought: 70,
    bbPeriod: 20,
    bbStdDev: 2,
    stochK: 14,
    stochD: 3,
    donchianPeriod: 20,
    trendPeriod: 100,
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
  } else if (name === "macd") {
    const fasts = ranges.fast ?? [base.fast];
    const slows = ranges.slow ?? [base.slow];
    const signals = ranges.signal ?? [base.signal];
    for (const fast of fasts) {
      for (const slow of slows) {
        if (fast >= slow) continue;
        for (const signal of signals) {
          combos.push({ ...base, fast, slow, signal });
        }
      }
    }
  } else if (name === "bollinger") {
    const periods = ranges.bbPeriod ?? [base.bbPeriod];
    const devs = ranges.bbStdDev ?? [base.bbStdDev];
    for (const bbPeriod of periods) {
      for (const bbStdDev of devs) {
        combos.push({ ...base, bbPeriod, bbStdDev });
      }
    }
  } else if (name === "stochastic") {
    const ks = ranges.stochK ?? [base.stochK];
    const ds = ranges.stochD ?? [base.stochD];
    const oversolds = ranges.oversold ?? [base.oversold];
    const overboughts = ranges.overbought ?? [base.overbought];
    for (const stochK of ks) {
      for (const stochD of ds) {
        for (const oversold of oversolds) {
          for (const overbought of overboughts) {
            if (oversold >= overbought) continue;
            combos.push({ ...base, stochK, stochD, oversold, overbought });
          }
        }
      }
    }
  } else if (name === "donchian") {
    const periods = ranges.donchianPeriod ?? [base.donchianPeriod];
    for (const donchianPeriod of periods) {
      combos.push({ ...base, donchianPeriod });
    }
  } else if (name === "trendbreak") {
    const channels = ranges.donchianPeriod ?? [base.donchianPeriod];
    const trends = ranges.trendPeriod ?? [base.trendPeriod];
    for (const donchianPeriod of channels) {
      for (const trendPeriod of trends) {
        if (trendPeriod <= donchianPeriod) continue;
        combos.push({ ...base, donchianPeriod, trendPeriod });
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
