import "dotenv/config";
import { z } from "zod";
import type { SymbolStrategyOverride } from "../types/index.js";

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
  // Exchange-specific credential fallbacks (used when EXCHANGE_API_KEY is unset).
  BINANCE_API_KEY: z.string().default(""),
  BINANCE_SECRET: z.string().default(""),
  // "spot" or "future" (USDT-margined perpetuals on Binance).
  MARKET_TYPE: z.enum(["spot", "future"]).default("spot"),
  // Leverage applied to futures positions (ignored on spot).
  LEVERAGE: numFromEnv(1),
  // "isolated" caps a position's loss to its own margin; "cross" backs it with the
  // whole balance.
  MARGIN_MODE: z.enum(["isolated", "cross"]).default("isolated"),
  // Fraction of quote balance used as margin per trade (e.g. 0.20 = 20%). At >0 this
  // overrides MAX_POSITION_USD: notional = balance * POSITION_PCT * LEVERAGE.
  POSITION_PCT: numFromEnv(0),
  SYMBOL: z.string().min(1).default("BTC/USDT"),
  // Comma-separated markets for the live bot to trade concurrently. Falls back to
  // SYMBOL when unset.
  SYMBOLS: z.string().default(""),
  TIMEFRAME: z.string().min(1).default("1m"),
  SANDBOX: boolFromEnv,
  DRY_RUN: boolFromEnv,
  MAX_POSITION_USD: numFromEnv(100),
  STOP_LOSS_PCT: numFromEnv(2),
  TAKE_PROFIT_PCT: numFromEnv(4),
  // Trailing stop as a % retracement from the best price seen since entry. The
  // stop ratchets toward profit and never loosens; 0 disables it.
  TRAILING_STOP_PCT: numFromEnv(0),
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
  // Telegram alerts on fills (both must be set to enable).
  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_CHAT_ID: z.string().default(""),
  DASHBOARD_PORT: numFromEnv(3000),
  // Strategy selection & parameters (see src/strategy for available strategies).
  STRATEGY: z.string().min(1).default("sma"),
  // Optional per-symbol strategy overrides as JSON, e.g.
  // {"BTC/USDT":{"strategy":"ema","fast":12,"slow":26},"ETH/USDT":{"strategy":"rsi"}}
  SYMBOL_STRATEGIES: z.string().default(""),
  FAST_PERIOD: numFromEnv(9),
  SLOW_PERIOD: numFromEnv(21),
  MACD_SIGNAL: numFromEnv(9),
  RSI_PERIOD: numFromEnv(14),
  RSI_OVERSOLD: numFromEnv(30),
  RSI_OVERBOUGHT: numFromEnv(70),
  BB_PERIOD: numFromEnv(20),
  BB_STDDEV: numFromEnv(2),
  STOCH_K: numFromEnv(14),
  STOCH_D: numFromEnv(3),
  DONCHIAN_PERIOD: numFromEnv(20),
  TREND_PERIOD: numFromEnv(100),
});

const parsed = schema.parse(process.env);

const symbols = parsed.SYMBOLS
  ? parsed.SYMBOLS.split(",").map((s) => s.trim()).filter(Boolean)
  : [parsed.SYMBOL];

let symbolStrategies: Record<string, SymbolStrategyOverride> = {};
if (parsed.SYMBOL_STRATEGIES) {
  try {
    symbolStrategies = JSON.parse(parsed.SYMBOL_STRATEGIES);
  } catch {
    throw new Error("SYMBOL_STRATEGIES must be valid JSON");
  }
}

export const config = {
  exchangeId: parsed.EXCHANGE_ID,
  apiKey: parsed.EXCHANGE_API_KEY || parsed.BINANCE_API_KEY,
  secret: parsed.EXCHANGE_SECRET || parsed.BINANCE_SECRET,
  /** Single default symbol — used by the backtest/optimize CLIs. */
  symbol: parsed.SYMBOL,
  /** Markets the live bot trades concurrently. */
  symbols,
  timeframe: parsed.TIMEFRAME,
  sandbox: parsed.SANDBOX,
  dryRun: parsed.DRY_RUN,
  marketType: parsed.MARKET_TYPE,
  leverage: parsed.LEVERAGE,
  marginMode: parsed.MARGIN_MODE,
  positionPct: parsed.POSITION_PCT,
  maxPositionUsd: parsed.MAX_POSITION_USD,
  stopLossPct: parsed.STOP_LOSS_PCT,
  takeProfitPct: parsed.TAKE_PROFIT_PCT,
  trailingStopPct: parsed.TRAILING_STOP_PCT,
  feeRate: parsed.FEE_RATE,
  logLevel: parsed.LOG_LEVEL,
  pollIntervalSec: parsed.POLL_INTERVAL_SEC,
  stateFile: parsed.STATE_FILE,
  tradeLogFile: parsed.TRADE_LOG_FILE,
  reconcile: parsed.RECONCILE,
  reconcileTolerance: parsed.RECONCILE_TOLERANCE,
  reconcileDust: parsed.RECONCILE_DUST,
  telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
  telegramChatId: parsed.TELEGRAM_CHAT_ID,
  dashboardPort: parsed.DASHBOARD_PORT,
  strategy: parsed.STRATEGY,
  symbolStrategies,
  strategyParams: {
    fast: parsed.FAST_PERIOD,
    slow: parsed.SLOW_PERIOD,
    signal: parsed.MACD_SIGNAL,
    rsiPeriod: parsed.RSI_PERIOD,
    oversold: parsed.RSI_OVERSOLD,
    overbought: parsed.RSI_OVERBOUGHT,
    bbPeriod: parsed.BB_PERIOD,
    bbStdDev: parsed.BB_STDDEV,
    stochK: parsed.STOCH_K,
    stochD: parsed.STOCH_D,
    donchianPeriod: parsed.DONCHIAN_PERIOD,
    trendPeriod: parsed.TREND_PERIOD,
  },
} as const;

export type Config = typeof config;
