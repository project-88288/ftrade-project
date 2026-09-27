import type { Candle } from "../types/index.js";
import { backtest, type BacktestResult } from "./engine.js";
import { createStrategy, type StrategyName, type StrategyParams } from "../strategy/index.js";
import { sweep, type SweepOptions } from "./optimize.js";

export interface WalkForwardFold {
  trainCandles: number;
  testCandles: number;
  bestParams: StrategyParams;
  /** Best result found in-sample on this fold's training window. */
  train: BacktestResult;
  /** Out-of-sample result: this fold's best params applied to the next window. */
  test: BacktestResult;
}

export interface WalkForwardResult {
  folds: WalkForwardFold[];
  /** Out-of-sample return compounded across every fold's test window. */
  oosReturnPct: number;
  /** Aggregate win rate over all out-of-sample trades. */
  oosWinRatePct: number;
  oosTrades: number;
  /** How many folds were profitable out-of-sample. */
  profitableFolds: number;
}

/**
 * Rolling-window walk-forward validation. A fixed-size training window slides
 * forward in `folds` steps; at each step the best params are re-optimized on the
 * training window and then applied to the *next* (unseen) window. Re-fitting each
 * fold and chaining the out-of-sample results is a far stronger overfitting check
 * than a single train/test split — it shows whether an edge survives across
 * multiple regimes, not just one lucky slice.
 */
export function walkForward(
  candles: Candle[],
  name: StrategyName,
  combos: StrategyParams[],
  trainRatio: number,
  folds: number,
  opts: SweepOptions,
): WalkForwardResult {
  if (trainRatio <= 0 || trainRatio >= 1) {
    throw new Error("trainRatio must be between 0 and 1 (exclusive)");
  }
  if (folds < 1) throw new Error("folds must be at least 1");

  const total = candles.length;
  const trainLen = Math.floor(total * trainRatio);
  const testLen = Math.floor((total - trainLen) / folds);
  if (testLen <= 0) {
    throw new Error("Not enough candles for the requested train ratio and fold count");
  }

  const results: WalkForwardFold[] = [];
  for (let k = 0; k < folds; k++) {
    const trainStart = k * testLen;
    const trainSlice = candles.slice(trainStart, trainStart + trainLen);
    const testSlice = candles.slice(trainStart + trainLen, trainStart + trainLen + testLen);

    const ranking = sweep(trainSlice, name, combos, opts);
    if (ranking.length === 0) continue; // no combo traded enough on this window

    const bestParams = ranking[0]!.params;
    const { strategy, warmup } = createStrategy(name, bestParams);
    const test = backtest(testSlice, strategy, { ...opts.backtest, warmup });

    results.push({
      trainCandles: trainSlice.length,
      testCandles: testSlice.length,
      bestParams,
      train: ranking[0]!.result,
      test,
    });
  }

  let compounded = 1;
  let wins = 0;
  let trades = 0;
  let profitableFolds = 0;
  for (const f of results) {
    compounded *= 1 + f.test.totalReturnPct / 100;
    wins += f.test.wins;
    trades += f.test.trades.length;
    if (f.test.totalReturnPct > 0) profitableFolds++;
  }

  return {
    folds: results,
    oosReturnPct: (compounded - 1) * 100,
    oosWinRatePct: trades > 0 ? (wins / trades) * 100 : 0,
    oosTrades: trades,
    profitableFolds,
  };
}
