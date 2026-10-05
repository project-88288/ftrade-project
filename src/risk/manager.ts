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

  /**
   * Advance the position's peak (best price seen in its favour) toward the latest
   * price. Mutates `position.peakPrice` and returns true when it moves, so the
   * caller can persist the tightened trailing stop. Call before `exitReason`.
   */
  trackPeak(position: Position, currentPrice: number): boolean {
    const prev = position.peakPrice ?? position.entryPrice;
    const next =
      position.side === "buy" ? Math.max(prev, currentPrice) : Math.min(prev, currentPrice);
    if (next !== position.peakPrice) {
      position.peakPrice = next;
      return true;
    }
    return false;
  }

  /**
   * Reason to close the position now, or null to hold. Checks the fixed stop-loss,
   * the optional take-profit (disabled at <= 0), and the trailing stop (disabled at
   * <= 0): a retracement of `trailingStopPct` from the recorded peak. Because the
   * peak only ratchets in the position's favour, the trailing stop never loosens.
   */
  exitReason(position: Position, currentPrice: number): string | null {
    const change = (currentPrice - position.entryPrice) / position.entryPrice;
    const move = (position.side === "buy" ? change : -change) * 100;

    if (move <= -config.stopLossPct) return "stop-loss";
    if (config.takeProfitPct > 0 && move >= config.takeProfitPct) return "take-profit";

    if (config.trailingStopPct > 0) {
      const peak = position.peakPrice ?? position.entryPrice;
      const retrace =
        position.side === "buy" ? (peak - currentPrice) / peak : (currentPrice - peak) / peak;
      if (retrace * 100 >= config.trailingStopPct) return "trailing-stop";
    }
    return null;
  }

  exitSide(position: Position): Side {
    return position.side === "buy" ? "sell" : "buy";
  }
}
