import { summarize, type ClosedTrade } from "../state/trade-log.js";
import type { Position } from "../types/index.js";

/** Prometheus text exposition content type (version 0.0.4). */
export const PROM_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

interface Metric {
  name: string;
  help: string;
  type: "counter" | "gauge";
  samples: { labels?: Record<string, string>; value: number }[];
}

function render(metrics: Metric[]): string {
  const lines: string[] = [];
  for (const m of metrics) {
    lines.push(`# HELP ${m.name} ${m.help}`);
    lines.push(`# TYPE ${m.name} ${m.type}`);
    for (const s of m.samples) {
      const labels = s.labels
        ? "{" +
          Object.entries(s.labels)
            .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
            .join(",") +
          "}"
        : "";
      lines.push(`${m.name}${labels} ${s.value}`);
    }
  }
  return lines.join("\n") + "\n";
}

/**
 * Render the realized-PnL trade log and open positions as Prometheus metrics.
 * Pure — takes data in, returns the exposition text.
 */
export function renderMetrics(
  trades: ClosedTrade[],
  positions: Map<string, Position>,
): string {
  const s = summarize(trades);

  const metrics: Metric[] = [
    {
      name: "ftrade_trades_total",
      help: "Total number of closed trades.",
      type: "counter",
      samples: [{ value: s.trades }],
    },
    {
      name: "ftrade_wins_total",
      help: "Number of closed trades with positive net PnL.",
      type: "counter",
      samples: [{ value: s.wins }],
    },
    {
      name: "ftrade_losses_total",
      help: "Number of closed trades with non-positive net PnL.",
      type: "counter",
      samples: [{ value: s.losses }],
    },
    {
      name: "ftrade_win_rate_percent",
      help: "Percentage of closed trades that were wins.",
      type: "gauge",
      samples: [{ value: s.winRatePct }],
    },
    {
      name: "ftrade_realized_pnl",
      help: "Cumulative realized PnL, net of fees, in quote currency.",
      type: "gauge",
      samples: [{ value: s.totalPnl }],
    },
    {
      name: "ftrade_realized_gross_pnl",
      help: "Cumulative realized PnL before fees, in quote currency.",
      type: "gauge",
      samples: [{ value: s.totalGrossPnl }],
    },
    {
      name: "ftrade_fees_total",
      help: "Cumulative fees paid, in quote currency.",
      type: "counter",
      samples: [{ value: s.totalFees }],
    },
    {
      name: "ftrade_open_positions",
      help: "Number of currently open positions.",
      type: "gauge",
      samples: [{ value: positions.size }],
    },
  ];

  if (positions.size > 0) {
    const entries = [...positions.values()];
    metrics.push({
      name: "ftrade_position_entry_price",
      help: "Entry price of an open position, labelled by symbol and side.",
      type: "gauge",
      samples: entries.map((p) => ({
        labels: { symbol: p.symbol, side: p.side },
        value: p.entryPrice,
      })),
    });
    metrics.push({
      name: "ftrade_position_amount",
      help: "Base-asset amount of an open position, labelled by symbol and side.",
      type: "gauge",
      samples: entries.map((p) => ({
        labels: { symbol: p.symbol, side: p.side },
        value: p.amount,
      })),
    });
  }

  return render(metrics);
}
