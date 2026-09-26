import { createServer, type Server, type ServerResponse } from "node:http";
import { TradeLog, summarize } from "../state/trade-log.js";
import { PositionStore } from "../state/store.js";
import { renderMetrics, PROM_CONTENT_TYPE } from "../metrics/prometheus.js";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/**
 * A tiny read-only dashboard for the realized-PnL trade log. Serves an HTML page,
 * `/api/summary`, `/api/trades`, and Prometheus `/metrics` — reading the log (and
 * position state) fresh on each request so it reflects live trading. Built on Node's
 * http module — no extra dependencies.
 */
export function createDashboardServer(tradeLogFile: string, stateFile?: string): Server {
  const log = new TradeLog(tradeLogFile);
  const store = stateFile ? new PositionStore(stateFile) : null;
  const startedAt = Date.now();

  return createServer(async (req, res) => {
    try {
      const path = (req.url ?? "/").split("?")[0];

      if (path === "/health") {
        sendJson(res, 200, {
          status: "ok",
          uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
          timestamp: new Date().toISOString(),
        });
        return;
      }
      if (path === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(PAGE_HTML);
        return;
      }
      if (path === "/api/summary") {
        sendJson(res, 200, summarize(await log.readAll()));
        return;
      }
      if (path === "/api/trades") {
        // Most recent first.
        const trades = (await log.readAll()).slice().reverse();
        sendJson(res, 200, trades);
        return;
      }
      if (path === "/metrics") {
        const [trades, positions] = await Promise.all([
          log.readAll(),
          store ? store.load() : Promise.resolve(new Map()),
        ]);
        res.writeHead(200, { "content-type": PROM_CONTENT_TYPE });
        res.end(renderMetrics(trades, positions));
        return;
      }

      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });
}

const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ftrade — PnL dashboard</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 system-ui, sans-serif; background: #0d1117; color: #e6edf3; }
  header { padding: 20px 24px; border-bottom: 1px solid #21262d; display: flex; align-items: baseline; gap: 12px; }
  h1 { font-size: 18px; margin: 0; }
  .muted { color: #8b949e; font-size: 12px; }
  main { padding: 24px; max-width: 1000px; margin: 0 auto; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .card { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 14px 16px; }
  .card .label { color: #8b949e; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  .card .value { font-size: 22px; font-weight: 600; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; background: #161b22; border: 1px solid #21262d; border-radius: 8px; overflow: hidden; }
  th, td { padding: 8px 12px; text-align: right; border-bottom: 1px solid #21262d; white-space: nowrap; }
  th { color: #8b949e; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  th:first-child, td:first-child, th:nth-child(2), td:nth-child(2) { text-align: left; }
  tbody tr:last-child td { border-bottom: none; }
  .pos { color: #3fb950; } .neg { color: #f85149; }
  .empty { color: #8b949e; padding: 24px; text-align: center; }
</style>
</head>
<body>
<header>
  <h1>ftrade</h1>
  <span class="muted">realized-PnL dashboard · <span id="updated">loading…</span></span>
</header>
<main>
  <div class="cards" id="cards"></div>
  <table>
    <thead><tr>
      <th>Exit time</th><th>Symbol</th><th>Side</th><th>Entry</th><th>Exit</th>
      <th>Gross</th><th>Fees</th><th>Net PnL</th><th>PnL %</th>
    </tr></thead>
    <tbody id="rows"><tr><td class="empty" colspan="9">loading…</td></tr></tbody>
  </table>
</main>
<script>
const fmt = (n, d = 2) => Number(n).toFixed(d);
const cls = (n) => n > 0 ? "pos" : n < 0 ? "neg" : "";
const sign = (n, d = 2) => (n >= 0 ? "+" : "") + fmt(n, d);

async function load() {
  try {
    const [summary, trades] = await Promise.all([
      fetch("/api/summary").then(r => r.json()),
      fetch("/api/trades").then(r => r.json()),
    ]);

    document.getElementById("cards").innerHTML = [
      ["Trades", summary.trades],
      ["Win rate", fmt(summary.winRatePct, 1) + "%"],
      ["Net PnL", '<span class="' + cls(summary.totalPnl) + '">' + sign(summary.totalPnl) + "</span>"],
      ["Fees", fmt(summary.totalFees)],
      ["Best", '<span class="pos">' + sign(summary.bestPnl) + "</span>"],
      ["Worst", '<span class="neg">' + fmt(summary.worstPnl) + "</span>"],
    ].map(([label, value]) =>
      '<div class="card"><div class="label">' + label + '</div><div class="value">' + value + "</div></div>"
    ).join("");

    const rows = document.getElementById("rows");
    if (!trades.length) {
      rows.innerHTML = '<tr><td class="empty" colspan="9">No trades logged yet.</td></tr>';
    } else {
      rows.innerHTML = trades.map(t =>
        "<tr>" +
        "<td>" + new Date(t.exitTime).toLocaleString() + "</td>" +
        "<td>" + t.symbol + "</td>" +
        "<td>" + t.side + "</td>" +
        "<td>" + fmt(t.entryPrice) + "</td>" +
        "<td>" + fmt(t.exitPrice) + "</td>" +
        "<td>" + fmt(t.grossPnl) + "</td>" +
        "<td>" + fmt(t.fees) + "</td>" +
        '<td class="' + cls(t.pnl) + '">' + sign(t.pnl) + "</td>" +
        '<td class="' + cls(t.pnl) + '">' + sign(t.pnlPct) + "%</td>" +
        "</tr>"
      ).join("");
    }
    document.getElementById("updated").textContent = "updated " + new Date().toLocaleTimeString();
  } catch (err) {
    document.getElementById("updated").textContent = "error loading data";
  }
}

load();
setInterval(load, 10000);
</script>
</body>
</html>`;
