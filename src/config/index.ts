import "dotenv/config";
import { z } from "zod";

const boolFromEnv = z
  .string()
  .optional()
  .transform((v) => v?.toLowerCase() === "true");

const boolFromEnvDefault = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : v.toLowerCase() === "true"));

const numFromEnv = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : Number(v)))
    .pipe(z.number().finite());

const schema = z.object({
  EXCHANGE_ID: z.string().min(1).default("binance"),
  EXCHANGE_API_KEY: z.string().default(""),
  EXCHANGE_SECRET: z.string().default(""),
  SYMBOL: z.string().min(1).default("BTC/USDT"),
  TIMEFRAME: z.string().min(1).default("1m"),
  SANDBOX: boolFromEnv,
  DRY_RUN: boolFromEnv,
  MAX_POSITION_USD: numFromEnv(100),
  STOP_LOSS_PCT: numFromEnv(2),
  TAKE_PROFIT_PCT: numFromEnv(4),
  // Only used to estimate fees for DRY_RUN orders; real orders report actual fees.
  FEE_RATE: numFromEnv(0.001),
  LOG_LEVEL: z.string().default("info"),
  POLL_INTERVAL_SEC: numFromEnv(15),
  STATE_FILE: z.string().min(1).default("./state.json"),
  TRADE_LOG_FILE: z.string().min(1).default("./trades.jsonl"),
  // On startup, reconcile the persisted position against the exchange balance.
  RECONCILE: boolFromEnvDefault(true),
  RECONCILE_TOLERANCE: numFromEnv(0.02),
  RECONCILE_DUST: numFromEnv(0),
  // Strategy selection & parameters (see src/strategy for available strategies).
  STRATEGY: z.string().min(1).default("sma"),
  FAST_PERIOD: numFromEnv(9),
  SLOW_PERIOD: numFromEnv(21),
  RSI_PERIOD: numFromEnv(14),
  RSI_OVERSOLD: numFromEnv(30),
  RSI_OVERBOUGHT: numFromEnv(70),
});

const parsed = schema.parse(process.env);

export const config = {
  exchangeId: parsed.EXCHANGE_ID,
  apiKey: parsed.EXCHANGE_API_KEY,
  secret: parsed.EXCHANGE_SECRET,
  symbol: parsed.SYMBOL,
  timeframe: parsed.TIMEFRAME,
  sandbox: parsed.SANDBOX,
  dryRun: parsed.DRY_RUN,
  maxPositionUsd: parsed.MAX_POSITION_USD,
  stopLossPct: parsed.STOP_LOSS_PCT,
  takeProfitPct: parsed.TAKE_PROFIT_PCT,
  feeRate: parsed.FEE_RATE,
  logLevel: parsed.LOG_LEVEL,
  pollIntervalSec: parsed.POLL_INTERVAL_SEC,
  stateFile: parsed.STATE_FILE,
  tradeLogFile: parsed.TRADE_LOG_FILE,
  reconcile: parsed.RECONCILE,
  reconcileTolerance: parsed.RECONCILE_TOLERANCE,
  reconcileDust: parsed.RECONCILE_DUST,
  strategy: parsed.STRATEGY,
  strategyParams: {
    fast: parsed.FAST_PERIOD,
    slow: parsed.SLOW_PERIOD,
    rsiPeriod: parsed.RSI_PERIOD,
    oversold: parsed.RSI_OVERSOLD,
    overbought: parsed.RSI_OVERBOUGHT,
  },
} as const;

export type Config = typeof config;
