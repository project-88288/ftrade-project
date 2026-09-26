import { parseArgs } from "node:util";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { createStrategy, isStrategyName, STRATEGY_NAMES } from "../strategy/index.js";
import { backtest } from "./engine.js";
import { fetchHistory, loadCsv } from "./data.js";
import type { Candle } from "../types/index.js";

/**
 * CLI: backtest a strategy over historical data.
 *
 *   npm run backtest -- --limit 2000
 *   npm run backtest -- --strategy ema --fast 12 --slow 26
 *   npm run backtest -- --strategy rsi --rsi-period 14 --oversold 30 --overbought 70
 *   npm run backtest -- --csv ./data/btc.csv --strategy sma --fast 5 --slow 20
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
      fast: { type: "string", default: "9" },
      slow: { type: "string", default: "21" },
      "rsi-period": { type: "string", default: "14" },
      oversold: { type: "string", default: "30" },
      overbought: { type: "string", default: "70" },
      cash: { type: "string", default: "10000" },
      size: { type: "string", default: String(config.maxPositionUsd) },
      fee: { type: "string", default: "0.001" },
    },
  });

  const strategyName = values.strategy!;
  if (!isStrategyName(strategyName)) {
    logger.fatal(
      { strategy: strategyName, available: STRATEGY_NAMES },
      "Unknown strategy",
    );
    process.exit(1);
  }

  const { strategy, warmup } = createStrategy(strategyName, {
    fast: Number(values.fast),
    slow: Number(values.slow),
    rsiPeriod: Number(values["rsi-period"]),
    oversold: Number(values.oversold),
    overbought: Number(values.overbought),
  });

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

  logger.info({ candles: candles.length, strategy: strategy.name }, "Running backtest");

  const result = backtest(candles, strategy, {
    initialCash: Number(values.cash),
    positionUsd: Number(values.size),
    feeRate: Number(values.fee),
    warmup,
    stopLossPct: config.stopLossPct,
    takeProfitPct: config.takeProfitPct,
  });

  const from = candles[0]?.timestamp;
  const to = candles[candles.length - 1]?.timestamp;

  console.log("\n=== Backtest Result ===");
  console.log(`Strategy:       ${result.strategy}`);
  if (from && to) {
    console.log(`Period:         ${new Date(from).toISOString()} → ${new Date(to).toISOString()}`);
  }
  console.log(`Candles:        ${candles.length}`);
  console.log(`Initial cash:   ${result.initialCash.toFixed(2)}`);
  console.log(`Final equity:   ${result.finalEquity.toFixed(2)}`);
  console.log(`Total return:   ${result.totalReturnPct.toFixed(2)}%`);
  console.log(`Trades:         ${result.trades.length}`);
  console.log(`Win / Loss:     ${result.wins} / ${result.losses}`);
  console.log(`Win rate:       ${result.winRatePct.toFixed(1)}%`);
  console.log(`Max drawdown:   ${result.maxDrawdownPct.toFixed(2)}%`);
  console.log("=======================\n");
}

main().catch((err) => {
  logger.fatal({ err }, "Backtest failed");
  process.exit(1);
});
