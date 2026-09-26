import type { Candle } from "../types/index.js";
import { backtest, type BacktestResult } from "./engine.js";
import { createStrategy, type StrategyName, type StrategyParams } from "../strategy/index.js";
import { sweep, type SweepEntry, type SweepOptions } from "./optimize.js";

export interface TrainTestSplit {
  train: Candle[];
  test: Candle[];
}

/**
 * Split candles chronologically into a training slice and a held-out test slice.
 * `trainRatio` is the fraction of candles used for training (0..1).
 */
export function splitCandles(candles: Candle[], trainRatio: number): TrainTestSplit {
  if (trainRatio <= 0 || trainRatio >= 1) {
    throw new Error("trainRatio must be between 0 and 1 (exclusive)");
  }
  const cut = Math.floor(candles.length * trainRatio);
  return { train: candles.slice(0, cut), test: candles.slice(cut) };
}

export interface TrainTestResult {
  trainRatio: number;
  trainCandles: number;
  testCandles: number;
  bestParams: StrategyParams;
  /** Best result found in-sample (on the training slice). */
  train: BacktestResult;
  /** Out-of-sample result: best params applied to the unseen test slice. */
  test: BacktestResult;
  /** Full in-sample ranking, for context. */
  ranking: SweepEntry[];
}

/**
 * Walk-forward validation. Optimizes parameters on the training slice, then
 * applies the single best combo to the untouched test slice. Comparing the two
 * returns is a direct read on overfitting: a strategy that looks great in-sample
 * but collapses out-of-sample was fitted to noise.
 */
export function trainTest(
  candles: Candle[],
  name: StrategyName,
  combos: StrategyParams[],
  trainRatio: number,
  opts: SweepOptions,
): TrainTestResult {
  const { train, test } = splitCandles(candles, trainRatio);

  const ranking = sweep(train, name, combos, opts);
  if (ranking.length === 0) {
    throw new Error(
      "No parameter combination produced enough trades on the training slice",
    );
  }

  const bestParams = ranking[0]!.params;
  const { strategy, warmup } = createStrategy(name, bestParams);
  const testResult = backtest(test, strategy, { ...opts.backtest, warmup });

  return {
    trainRatio,
    trainCandles: train.length,
    testCandles: test.length,
    bestParams,
    train: ranking[0]!.result,
    test: testResult,
    ranking,
  };
}
