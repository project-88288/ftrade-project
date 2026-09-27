import { parseArgs } from "node:util";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { isStrategyName, STRATEGY_NAMES, type StrategyParams } from "../strategy/index.js";
import { fetchHistory, loadCsv } from "./data.js";
import { buildGrid, rangesFromArgs, type OptimizeMetric } from "./optimize.js";
import { walkForward } from "./walkforward.js";
import type { Candle } from "../types/index.js";

const VALID_METRICS: OptimizeMetric[] = ["return", "winRate", "trades"];

/**
 * CLI: rolling walk-forward validation. Re-optimizes on a sliding training window
 * and reports the chained out-of-sample performance across every fold.
 *
 *   npm run walkforward -- --strategy rsi --folds 5 --rsi-period 7,14,21
 *   npm run walkforward -- --strategy sma --timeframe 1h --limit 4000 --folds 6
 */
async function main() {
  const { values } = parseArgs({
    options: {
      strategy: { type: "string", default: "sma" },
      exchange: { type: "string", default: config.exchangeId },
      symbol: { type: "string", default: config.symbol },
      timeframe: { type: "string", default: config.timeframe },
      limit: { type: "string", default: "2000" },
      csv: { type: "string" },
      fast: { type: "string", default: "5:15" },
      slow: { type: "string", default: "20:40:5" },
      signal: { type: "string", default: "9" },
      "rsi-period": { type: "string", default: "7:21:7" },
      oversold: { type: "string", default: "20,25,30" },
      overbought: { type: "string", default: "70,75,80" },
      "bb-period": { type: "string", default: "10:30:5" },
      "bb-stddev": { type: "string", default: "1.5,2,2.5" },
      "stoch-k": { type: "string", default: "9,14,21" },
      "stoch-d": { type: "string", default: "3" },
      "donchian-period": { type: "string", default: "10:40:5" },
      "trend-period": { type: "string", default: "50,100,200" },
      cash: { type: "string", default: "10000" },
      size: { type: "string", default: String(config.maxPositionUsd) },
      fee: { type: "string", default: "0.001" },
      metric: { type: "string", default: "return" },
      "min-trades": { type: "string", default: "5" },
      "train-ratio": { type: "string", default: "0.5" },
      folds: { type: "string", default: "5" },
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

  const ranges = rangesFromArgs(strategyName, values as Record<string, string | undefined>);
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
  const folds = Number(values.folds);
  logger.info(
    { strategy: strategyName, combos: combos.length, candles: candles.length, trainRatio, folds, metric },
    "Running walk-forward validation",
  );

  const result = walkForward(candles, strategyName, combos, trainRatio, folds, {
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

  console.log(`\n=== Walk-Forward Validation: ${strategyName.toUpperCase()} ===`);
  console.log(`Rolling window: ${(trainRatio * 100).toFixed(0)}% train, ${result.folds.length} folds (params re-chosen by ${metric} each fold)\n`);

  console.log(
    `${"fold".padStart(4)}  ${"best params".padEnd(26)}  ${"train%".padStart(8)}  ${"test%".padStart(8)}  ${"test win%".padStart(9)}  ${"trades".padStart(6)}`,
  );
  result.folds.forEach((f, i) => {
    console.log(
      `${String(i + 1).padStart(4)}  ${formatParams(strategyName, f.bestParams).padEnd(26)}  ` +
        `${f.train.totalReturnPct.toFixed(2).padStart(8)}  ${f.test.totalReturnPct.toFixed(2).padStart(8)}  ` +
        `${f.test.winRatePct.toFixed(1).padStart(9)}  ${String(f.test.trades.length).padStart(6)}`,
    );
  });

  console.log(`\n--- Aggregate out-of-sample (chained across folds) ---`);
  console.log(`  compounded return:  ${result.oosReturnPct.toFixed(2)}%`);
  console.log(`  win rate:           ${result.oosWinRatePct.toFixed(1)}%  (${result.oosTrades} trades)`);
  console.log(`  profitable folds:   ${result.profitableFolds}/${result.folds.length}`);

  if (result.profitableFolds === result.folds.length && result.oosReturnPct > 0) {
    console.log("\n✓  Edge held out-of-sample in every fold.");
  } else if (result.oosReturnPct > 0 && result.profitableFolds >= Math.ceil(result.folds.length / 2)) {
    console.log("\n~  Positive overall but inconsistent across folds — a weak edge at best.");
  } else {
    console.log("\n⚠️  Out-of-sample performance did not hold up — likely overfit.");
  }
  console.log("");
}

function formatParams(name: string, p: StrategyParams): string {
  switch (name) {
    case "rsi":
      return `p=${p.rsiPeriod} os=${p.oversold} ob=${p.overbought}`;
    case "macd":
      return `f=${p.fast} s=${p.slow} sig=${p.signal}`;
    case "bollinger":
      return `p=${p.bbPeriod} sd=${p.bbStdDev}`;
    case "stochastic":
      return `k=${p.stochK} d=${p.stochD} os=${p.oversold} ob=${p.overbought}`;
    case "donchian":
      return `p=${p.donchianPeriod}`;
    case "trendbreak":
      return `ch=${p.donchianPeriod} tr=${p.trendPeriod}`;
    default:
      return `fast=${p.fast} slow=${p.slow}`;
  }
}

main().catch((err) => {
  logger.fatal({ err }, "Walk-forward failed");
  process.exit(1);
});
