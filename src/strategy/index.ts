import type { Strategy, SymbolStrategyOverride } from "../types/index.js";
import { SmaCrossoverStrategy } from "./sma-crossover.js";
import { EmaCrossoverStrategy } from "./ema-crossover.js";
import { RsiStrategy } from "./rsi.js";
import { MacdStrategy } from "./macd.js";
import { BollingerStrategy } from "./bollinger.js";
import { StochasticStrategy } from "./stochastic.js";
import { DonchianStrategy } from "./donchian.js";
import { TrendBreakStrategy } from "./trendbreak.js";

export { SmaCrossoverStrategy } from "./sma-crossover.js";
export { EmaCrossoverStrategy } from "./ema-crossover.js";
export { RsiStrategy } from "./rsi.js";
export { MacdStrategy } from "./macd.js";
export { BollingerStrategy } from "./bollinger.js";
export { StochasticStrategy } from "./stochastic.js";
export { DonchianStrategy } from "./donchian.js";
export { TrendBreakStrategy } from "./trendbreak.js";

export interface StrategyParams {
  fast: number;
  slow: number;
  /** MACD signal-line EMA period. */
  signal: number;
  rsiPeriod: number;
  oversold: number;
  overbought: number;
  /** Bollinger Band lookback and standard-deviation multiplier. */
  bbPeriod: number;
  bbStdDev: number;
  /** Stochastic %K lookback and %D smoothing. */
  stochK: number;
  stochD: number;
  /** Donchian channel lookback (also the breakout channel for trendbreak). */
  donchianPeriod: number;
  /** Long-term SMA period used as the trendbreak trend filter. */
  trendPeriod: number;
}

export const STRATEGY_NAMES = [
  "sma",
  "ema",
  "rsi",
  "macd",
  "bollinger",
  "stochastic",
  "donchian",
  "trendbreak",
] as const;
export type StrategyName = (typeof STRATEGY_NAMES)[number];

export function isStrategyName(value: string): value is StrategyName {
  return (STRATEGY_NAMES as readonly string[]).includes(value);
}

/** Build a strategy by name, along with the warmup it needs. */
export function createStrategy(
  name: StrategyName,
  params: StrategyParams,
): { strategy: Strategy; warmup: number } {
  switch (name) {
    case "sma":
      return {
        strategy: new SmaCrossoverStrategy(params.fast, params.slow),
        warmup: params.slow + 1,
      };
    case "ema":
      return {
        strategy: new EmaCrossoverStrategy(params.fast, params.slow),
        warmup: params.slow + 1,
      };
    case "rsi":
      return {
        strategy: new RsiStrategy(params.rsiPeriod, params.oversold, params.overbought),
        warmup: params.rsiPeriod + 1,
      };
    case "macd":
      return {
        strategy: new MacdStrategy(params.fast, params.slow, params.signal),
        warmup: params.slow + params.signal + 1,
      };
    case "bollinger":
      return {
        strategy: new BollingerStrategy(params.bbPeriod, params.bbStdDev),
        warmup: params.bbPeriod + 1,
      };
    case "stochastic":
      return {
        strategy: new StochasticStrategy(params.stochK, params.stochD, params.oversold, params.overbought),
        warmup: params.stochK + params.stochD + 1,
      };
    case "donchian":
      return {
        strategy: new DonchianStrategy(params.donchianPeriod),
        warmup: params.donchianPeriod + 1,
      };
    case "trendbreak":
      return {
        strategy: new TrendBreakStrategy(params.donchianPeriod, params.trendPeriod),
        warmup: Math.max(params.donchianPeriod, params.trendPeriod) + 1,
      };
  }
}

export interface ResolvedStrategy {
  strategy: Strategy;
  warmup: number;
}

/**
 * Build a strategy for each symbol. A symbol listed in `overrides` uses its own
 * strategy/parameters (unset fields fall back to the global defaults); everything
 * else uses the global default strategy.
 */
export function resolveSymbolStrategies(
  symbols: string[],
  defaultName: StrategyName,
  defaultParams: StrategyParams,
  overrides: Record<string, SymbolStrategyOverride> = {},
): Map<string, ResolvedStrategy> {
  const map = new Map<string, ResolvedStrategy>();
  for (const symbol of symbols) {
    const ov = overrides[symbol] ?? {};
    const name = ov.strategy ?? defaultName;
    if (!isStrategyName(name)) {
      throw new Error(`Unknown strategy "${name}" configured for ${symbol}`);
    }
    map.set(
      symbol,
      createStrategy(name, {
        fast: ov.fast ?? defaultParams.fast,
        slow: ov.slow ?? defaultParams.slow,
        signal: defaultParams.signal,
        rsiPeriod: ov.rsiPeriod ?? defaultParams.rsiPeriod,
        oversold: ov.oversold ?? defaultParams.oversold,
        overbought: ov.overbought ?? defaultParams.overbought,
        bbPeriod: defaultParams.bbPeriod,
        bbStdDev: defaultParams.bbStdDev,
        stochK: defaultParams.stochK,
        stochD: defaultParams.stochD,
        donchianPeriod: defaultParams.donchianPeriod,
        trendPeriod: defaultParams.trendPeriod,
      }),
    );
  }
  return map;
}
