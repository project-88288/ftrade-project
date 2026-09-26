import { parseArgs } from "node:util";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { isStrategyName, STRATEGY_NAMES, type StrategyParams } from "../strategy/index.js";
import { fetchHistory, loadCsv } from "./data.js";
import { buildGrid, parseRange, type GridRanges, type OptimizeMetric } from "./optimize.js";
import { trainTest } from "./traintest.js";
import type { Candle } from "../types/index.js";
import type { BacktestResult } from "./engine.js";

const VALID_METRICS: OptimizeMetric[] = ["return", "winRate", "trades"];

/**
 * CLI: optimize a strategy on a training slice, then report out-of-sample
 * performance on a held-out test slice.
 *
 *   npm run traintest -- --strategy ema --fast 5:15:2 --slow 20:40:5 --train-ratio 0.7
 *   npm run traintest -- --strategy rsi --rsi-period 7:21:7 --metric winRate
 */
async function main() {
  const { values } = parseArgs({
    options: {
      strategy: { type: "string", default: "sma" },
      exchange: { type: "string", default: config.exchangeId },
      symbol: { type: "string", default: config.symbol },
      timeframe: { type: "string", default: config.timeframe },
      limit: { type: "string", default: "1000" },
      csv: { type: "string" },
      fast: { type: "string", default: "5:15" },
      slow: { type: "string", default: "20:40:5" },
      "rsi-period": { type: "string", default: "7:21:7" },
      oversold: { type: "string", default: "20,25,30" },
      overbought: { type: "string", default: "70,75,80" },
      cash: { type: "string", default: "10000" },
      size: { type: "string", default: String(config.maxPositionUsd) },
      fee: { type: "string", default: "0.001" },
      metric: { type: "string", default: "return" },
      "min-trades": { type: "string", default: "5" },
      "train-ratio": { type: "string", default: "0.7" },
    },
  });

  const strategyName = values.strategy!;
  if (!isStrategyName(strategyName)) {
    logger.fatal({ strategy: strategyName, available: STRATEGY_NAMES }, "Unknown strategy");
    process.exit(1);
  }

  const metric = values.metric as OptimizeMetric;
  if (!VALID_METRICS.includes(metric)) {
    logger.fatal({ metric, available: VALID_METRICS }, "Unknown metric");
    process.exit(1);
  }

  const ranges: GridRanges =
    strategyName === "rsi"
      ? {
          rsiPeriod: parseRange(values["rsi-period"]!),
          oversold: parseRange(values.oversold!),
          overbought: parseRange(values.overbought!),
        }
      : {
          fast: parseRange(values.fast!),
          slow: parseRange(values.slow!),
        };

  const combos = buildGrid(strategyName, ranges);
  if (combos.length === 0) {
    logger.fatal("No valid parameter combinations to test");
    process.exit(1);
  }

  let candles: Candle[];
  if (values.csv) {
    logger.info({ csv: values.csv }, "Loading candles from CSV");
    candles = await loadCsv(values.csv);
  } else {
    logger.info(
      { exchange: values.exchange, symbol: values.symbol, timeframe: values.timeframe },
      "Fetching historical candles",
    );
    candles = await fetchHistory(
      values.exchange!,
      values.symbol!,
      values.timeframe!,
      Number(values.limit),
    );
  }

  const trainRatio = Number(values["train-ratio"]);
  logger.info(
    { strategy: strategyName, combos: combos.length, candles: candles.length, trainRatio, metric },
    "Running train/test validation",
  );

  const result = trainTest(candles, strategyName, combos, trainRatio, {
    backtest: {
      initialCash: Number(values.cash),
      positionUsd: Number(values.size),
      feeRate: Number(values.fee),
      stopLossPct: config.stopLossPct,
      takeProfitPct: config.takeProfitPct,
    },
    metric,
    minTrades: Number(values["min-trades"]),
  });

  console.log(`\n=== Train/Test Validation: ${strategyName.toUpperCase()} ===`);
  console.log(`Split:          ${(trainRatio * 100).toFixed(0)}% train / ${((1 - trainRatio) * 100).toFixed(0)}% test`);
  console.log(`Train candles:  ${result.trainCandles}`);
  console.log(`Test candles:   ${result.testCandles}`);
  console.log(`Best params:    ${formatParams(strategyName, result.bestParams)}  (chosen by ${metric} in-sample)\n`);

  printSlice("IN-SAMPLE  (train)", result.train);
  printSlice("OUT-OF-SAMPLE (test)", result.test);

  const decay = result.train.totalReturnPct - result.test.totalReturnPct;
  console.log(`\nReturn decay (train - test): ${decay.toFixed(2)} pts`);
  if (result.test.totalReturnPct <= 0 && result.train.totalReturnPct > 0) {
    console.log("⚠️  Profitable in-sample but not out-of-sample — likely overfit.");
  } else if (decay > Math.abs(result.train.totalReturnPct) * 0.5) {
    console.log("⚠️  Large drop out-of-sample — treat these params with caution.");
  } else {
    console.log("✓  Out-of-sample performance held up reasonably.");
  }
  console.log("");
}

function printSlice(label: string, r: BacktestResult) {
  console.log(`--- ${label} ---`);
  console.log(`  return:   ${r.totalReturnPct.toFixed(2)}%`);
  console.log(`  trades:   ${r.trades.length}  (W ${r.wins} / L ${r.losses}, ${r.winRatePct.toFixed(1)}% win)`);
  console.log(`  max DD:   ${r.maxDrawdownPct.toFixed(2)}%`);
}

function formatParams(name: string, p: StrategyParams): string {
  if (name === "rsi") return `period=${p.rsiPeriod} oversold=${p.oversold} overbought=${p.overbought}`;
  return `fast=${p.fast} slow=${p.slow}`;
}

main().catch((err) => {
  logger.fatal({ err }, "Train/test failed");
  process.exit(1);
});
