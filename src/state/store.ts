import { readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Position } from "../types/index.js";

export interface PersistedState {
  /** Open positions keyed by symbol. */
  positions: Record<string, Position>;
  updatedAt: number;
}

/** Legacy single-position format, migrated on load. */
interface LegacyState {
  position: Position | null;
  updatedAt: number;
}

/**
 * Durable store for the bot's open positions (keyed by symbol), backed by a JSON
 * file. Writes are atomic (write to a temp file, then rename) so a crash mid-write
 * can't leave a truncated file that loses positions on restart.
 */
export class PositionStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<Map<string, Position>> {
    let text: string;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Map();
      throw err;
    }

    try {
      const parsed = JSON.parse(text) as Partial<PersistedState & LegacyState>;
      if (parsed.positions) {
        return new Map(Object.entries(parsed.positions));
      }
      // Migrate the legacy single-position format.
      if (parsed.position) {
        return new Map([[parsed.position.symbol, parsed.position]]);
      }
      return new Map();
    } catch {
      // Corrupt file — treat as no state rather than crashing the bot.
      return new Map();
    }
  }

  async save(positions: Map<string, Position>): Promise<void> {
    const state: PersistedState = {
      positions: Object.fromEntries(positions),
      updatedAt: Date.now(),
    };
    const tmp = join(dirname(this.filePath), `.${Date.now()}.tmp`);
    await writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    await rename(tmp, this.filePath);
  }
}
