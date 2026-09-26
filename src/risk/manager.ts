import { config } from "../config/index.js";
import type { Position, Side } from "../types/index.js";

/**
 * Position sizing and stop-loss / take-profit checks. Keeps risk decisions out
 * of the strategy and the main loop.
 */
export class RiskManager {
  /** Amount of the base asset to trade, sized by MAX_POSITION_USD. */
  positionSize(price: number): number {
    if (price <= 0) return 0;
    return config.maxPositionUsd / price;
  }

  /** Returns true if an open position should be closed based on SL/TP. */
  shouldExit(position: Position, currentPrice: number): boolean {
    const change = (currentPrice - position.entryPrice) / position.entryPrice;
    const pct = position.side === "buy" ? change : -change;
    const move = pct * 100;
    return move <= -config.stopLossPct || move >= config.takeProfitPct;
  }

  exitSide(position: Position): Side {
    return position.side === "buy" ? "sell" : "buy";
  }
}
