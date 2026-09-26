import type { Strategy } from "../types/index.js";
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
