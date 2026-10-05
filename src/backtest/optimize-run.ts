import { parseArgs } from "node:util";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { isStrategyName, STRATEGY_NAMES, type StrategyParams } from "../strategy/index.js";
import { fetchHistory, loadCsv } from "./data.js";
import {
  buildGrid,
  rangesFromArgs,
  sweep,
  type OptimizeMetric,
} from "./optimize.js";
import type { Candle } from "../types/index.js";

const VALID_METRICS: OptimizeMetric[] = ["return", "winRate", "trades"];

/**
 * CLI: grid-search a strategy's parameters over historical data.
 *
 *   npm run optimize -- --strategy ema --fast 5:15 --slow 20:40:5
 *   npm run optimize -- --strategy rsi --rsi-period 7:21:7 --oversold 20,25,30 --overbought 70,75,80
 *   npm run optimize -- --strategy sma --fast 5:12 --slow 20:30 --metric winRate --min-trades 10 --top 15
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
      // Ranges: "5", "5,10,15" or "start:end:step".
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
      top: { type: "string", default: "10" },
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

  logger.info(
    { strategy: strategyName, combos: combos.length, candles: candles.length, metric },
    "Running parameter sweep",
  );

  const ranked = sweep(candles, strategyName, combos, {
    backtest: {
      initialCash: Number(values.cash),
      positionUsd: Number(values.size),
      feeRate: Number(values.fee),
      stopLossPct: config.stopLossPct,
      takeProfitPct: config.takeProfitPct,
      trailingStopPct: config.trailingStopPct,
    },
    metric,
    minTrades: Number(values["min-trades"]),
  });

  const top = Number(values.top);
  const rows = ranked.slice(0, top);

  console.log(`\n=== Parameter Sweep: ${strategyName.toUpperCase()} (ranked by ${metric}) ===`);
  console.log(`Tested ${combos.length} combos, ${ranked.length} passed the min-trades filter.\n`);

  if (rows.length === 0) {
    console.log("No combinations met the minimum trade count.\n");
    return;
  }

  console.log(
    `${"#".padStart(3)}  ${"params".padEnd(24)}  ${"return%".padStart(9)}  ${"trades".padStart(6)}  ${"win%".padStart(6)}  ${"maxDD%".padStart(7)}`,
  );
  rows.forEach((entry, i) => {
    const r = entry.result;
    console.log(
      `${String(i + 1).padStart(3)}  ${formatParams(strategyName, entry.params).padEnd(24)}  ` +
        `${r.totalReturnPct.toFixed(2).padStart(9)}  ${String(r.trades.length).padStart(6)}  ` +
        `${r.winRatePct.toFixed(1).padStart(6)}  ${r.maxDrawdownPct.toFixed(2).padStart(7)}`,
    );
  });

  const best = rows[0]!;
  console.log(`\nBest: ${best.result.strategy} → ${best.result.totalReturnPct.toFixed(2)}% return, ${best.result.trades.length} trades\n`);
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
  logger.fatal({ err }, "Optimize failed");
  process.exit(1);
});
