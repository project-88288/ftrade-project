import "dotenv/config";
import { z } from "zod";

const boolFromEnv = z
  .string()
  .optional()
  .transform((v) => v?.toLowerCase() === "true");

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
  LOG_LEVEL: z.string().default("info"),
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
  logLevel: parsed.LOG_LEVEL,
} as const;

export type Config = typeof config;
