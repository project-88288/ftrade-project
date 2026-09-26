import { readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Position } from "../types/index.js";

export interface PersistedState {
  position: Position | null;
  updatedAt: number;
}

/**
 * Durable store for the bot's open position, backed by a JSON file. Writes are
 * atomic (write to a temp file, then rename) so a crash mid-write can't leave a
 * truncated file that loses the position on restart.
 */
export class PositionStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<Position | null> {
    let text: string;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }

    try {
      const parsed = JSON.parse(text) as PersistedState;
      return parsed.position ?? null;
    } catch {
      // Corrupt file — treat as no state rather than crashing the bot.
      return null;
    }
  }

  async save(position: Position | null): Promise<void> {
    const state: PersistedState = { position, updatedAt: Date.now() };
    const tmp = join(dirname(this.filePath), `.${Date.now()}.tmp`);
    await writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    await rename(tmp, this.filePath);
  }
}
