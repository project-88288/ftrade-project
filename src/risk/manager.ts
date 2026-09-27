import { config } from "../config/index.js";
import type { Position, Side } from "../types/index.js";

/**
 * Position sizing and stop-loss / take-profit checks. Keeps risk decisions out
 * of the strategy and the main loop.
 */
export class RiskManager {
  /**
   * Amount of the base asset to trade. When POSITION_PCT > 0 and a balance is
   * available, size by margin: notional = balance * POSITION_PCT * LEVERAGE (so at
   * 20% and 10x, a 1000 USDT balance opens a 2000 USDT position). Otherwise fall
   * back to the fixed MAX_POSITION_USD notional.
   */
  positionSize(price: number, balance?: number): number {
    if (price <= 0) return 0;
    if (config.positionPct > 0 && balance != null && balance > 0) {
      const notional = balance * config.positionPct * config.leverage;
      return notional / price;
    }
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
