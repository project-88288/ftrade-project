import { parseArgs } from "node:util";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { TradeLog, summarize } from "./trade-log.js";

/**
 * CLI: summarize the realized-PnL trade log.
 *
 *   npm run pnl
 *   npm run pnl -- --file ./trades.jsonl --list
 */
async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: "string", default: config.tradeLogFile },
      list: { type: "boolean", default: false },
    },
  });

  const log = new TradeLog(values.file!);
  const trades = await log.readAll();

  if (trades.length === 0) {
    console.log(`No trades logged yet in ${values.file}`);
    return;
  }

  if (values.list) {
    console.log("\ntime (exit)              symbol      side  entry      exit       pnl       pnl%");
    for (const t of trades) {
      console.log(
        `${new Date(t.exitTime).toISOString()}  ${t.symbol.padEnd(10)}  ${t.side.padEnd(4)}  ` +
          `${t.entryPrice.toFixed(2).padStart(9)}  ${t.exitPrice.toFixed(2).padStart(9)}  ` +
          `${t.pnl.toFixed(2).padStart(8)}  ${t.pnlPct.toFixed(2).padStart(6)}`,
      );
    }
  }

  const s = summarize(trades);
  console.log("\n=== Realized PnL ===");
  console.log(`Trades:      ${s.trades}`);
  console.log(`Win / Loss:  ${s.wins} / ${s.losses}  (${s.winRatePct.toFixed(1)}% win)`);
  console.log(`Total PnL:   ${s.totalPnl.toFixed(2)}`);
  console.log(`Avg PnL:     ${s.avgPnl.toFixed(2)}`);
  console.log(`Best / Worst:${s.bestPnl.toFixed(2)} / ${s.worstPnl.toFixed(2)}`);
  console.log("====================\n");
}

main().catch((err) => {
  logger.fatal({ err }, "PnL report failed");
  process.exit(1);
});
