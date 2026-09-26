import type { Position } from "../types/index.js";

export type ReconcileStatus =
  | "flat-confirmed"
  | "match"
  | "closed-externally"
  | "quantity-adjusted"
  | "unexpected-balance"
  | "unverifiable-short";

export interface ReconcileResult {
  /** The position the bot should run with after reconciliation. */
  position: Position | null;
  status: ReconcileStatus;
  message: string;
  /** True when the persisted state disagreed with the exchange. */
  changed: boolean;
}

export interface ReconcileOptions {
  /** Relative tolerance when matching amounts (e.g. 0.02 = 2%). */
  tolerance?: number;
  /** Base-asset amount at or below which a balance counts as dust (i.e. flat). */
  dust?: number;
}

/**
 * Reconcile the bot's persisted position against the actual base-asset balance
 * held on the exchange. Fills or manual trades that happened while the bot was
 * down show up here as drift; this decides how to resolve it.
 *
 * Only long (spot) positions can be verified from a base balance — a short can't
 * be confirmed this way, so it's left untouched with a warning.
 */
export function reconcilePosition(
  persisted: Position | null,
  actualBase: number,
  opts: ReconcileOptions = {},
): ReconcileResult {
  const tolerance = opts.tolerance ?? 0.02;
  const dust = opts.dust ?? 0;

  if (!persisted) {
    if (actualBase <= dust) {
      return {
        position: null,
        status: "flat-confirmed",
        message: "No persisted position and no meaningful balance — flat as expected.",
        changed: false,
      };
    }
    return {
      position: null,
      status: "unexpected-balance",
      message:
        `Holding ${actualBase} base asset but no persisted position. ` +
        "Staying flat (entry price unknown); close or fund manually if unexpected.",
      changed: false,
    };
  }

  if (persisted.side === "sell") {
    return {
      position: persisted,
      status: "unverifiable-short",
      message: "Persisted position is short; cannot verify from a spot balance. Keeping it.",
      changed: false,
    };
  }

  // Long position: expected to hold `amount` of the base asset.
  const expected = persisted.amount;
  if (actualBase <= dust) {
    return {
      position: null,
      status: "closed-externally",
      message:
        `Persisted a long of ${expected} but the balance is ${actualBase}. ` +
        "Treating the position as closed while the bot was down.",
      changed: true,
    };
  }

  const drift = Math.abs(actualBase - expected) / expected;
  if (drift <= tolerance) {
    return {
      position: persisted,
      status: "match",
      message: `Persisted long matches the exchange balance (${actualBase}).`,
      changed: false,
    };
  }

  return {
    position: { ...persisted, amount: actualBase },
    status: "quantity-adjusted",
    message:
      `Adjusted position amount from ${expected} to ${actualBase} to match the ` +
      "exchange balance.",
    changed: true,
  };
}
