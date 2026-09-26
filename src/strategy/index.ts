import type { Strategy, SymbolStrategyOverride } from "../types/index.js";
import { SmaCrossoverStrategy } from "./sma-crossover.js";
import { EmaCrossoverStrategy } from "./ema-crossover.js";
import { RsiStrategy } from "./rsi.js";

export { SmaCrossoverStrategy } from "./sma-crossover.js";
export { EmaCrossoverStrategy } from "./ema-crossover.js";
export { RsiStrategy } from "./rsi.js";

export interface StrategyParams {
  fast: number;
  slow: number;
  rsiPeriod: number;
  oversold: number;
  overbought: number;
}

export const STRATEGY_NAMES = ["sma", "ema", "rsi"] as const;
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
        rsiPeriod: ov.rsiPeriod ?? defaultParams.rsiPeriod,
        oversold: ov.oversold ?? defaultParams.oversold,
        overbought: ov.overbought ?? defaultParams.overbought,
      }),
    );
  }
  return map;
}
