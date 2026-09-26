# ftrade-project

[![CI](https://github.com/project-88288/ftrade-project/actions/workflows/ci.yml/badge.svg)](https://github.com/project-88288/ftrade-project/actions/workflows/ci.yml)

A TypeScript trading bot scaffold built on [ccxt](https://github.com/ccxt/ccxt). It
polls an exchange, runs a pluggable strategy, applies risk management, and places
orders — with a dry-run mode so you can watch it think before risking capital.

> ⚠️ Trading involves financial risk. Start with `SANDBOX=true` and `DRY_RUN=true`.
> This scaffold is for education/experimentation; it is not financial advice.

## Structure

```
src/
  config/      Environment loading & validation (zod)
  exchange/    ccxt client wrapper (candles, price, orders)
  strategy/    Trading strategies (SMA/EMA crossover, RSI) + indicators
  risk/        Position sizing + stop-loss / take-profit
  state/       Durable position store (survives restarts)
  notify/      Telegram alerts on fills
  dashboard/   Web dashboard for the PnL log
  backtest/    Event-driven backtester + data loader + CLI runner
  types/       Shared types
  utils/       Logger (pino)
  index.ts     Main polling loop
```

## Getting started

```bash
npm install
cp .env.example .env   # then fill in your values
npm run dev            # run with hot reload
```

Other scripts:

- `npm run build` — compile to `dist/`
- `npm start` — run the compiled bot
- `npm test` — run the test suite (vitest)
- `npm run typecheck` — type-check without emitting

## Configuration

All configuration is via environment variables — see `.env.example`. Key ones:

| Var | Meaning |
| --- | --- |
| `EXCHANGE_ID` | Any ccxt exchange id (e.g. `binance`) |
| `SYMBOL` | Default market for the backtest/optimize CLIs, e.g. `BTC/USDT` |
| `SYMBOLS` | Comma-separated markets the live bot trades concurrently (falls back to `SYMBOL`) |
| `SANDBOX` | Use the exchange testnet when `true` |
| `DRY_RUN` | Log intended orders instead of sending them |
| `MAX_POSITION_USD` | Notional size per position |
| `STOP_LOSS_PCT` / `TAKE_PROFIT_PCT` | Exit thresholds |
| `FEE_RATE` | Fee rate for estimating `DRY_RUN` order fees (real orders use actual fees) |
| `STRATEGY` | Which strategy the live bot runs: `sma`, `ema`, or `rsi` |
| `FAST_PERIOD` / `SLOW_PERIOD` | Crossover periods (sma, ema) |
| `RSI_PERIOD` / `RSI_OVERSOLD` / `RSI_OVERBOUGHT` | RSI parameters |
| `POLL_INTERVAL_SEC` | Seconds between exchange polls |
| `STATE_FILE` | Path where the open position is persisted (default `./state.json`) |
| `TRADE_LOG_FILE` | Append-only log of closed trades (default `./trades.jsonl`) |
| `RECONCILE` | Reconcile persisted position vs. exchange balance on startup (default `true`) |
| `RECONCILE_TOLERANCE` / `RECONCILE_DUST` | Match tolerance and dust threshold |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Set both to get Telegram alerts on fills |

The live bot picks its strategy from `STRATEGY` (and the matching parameter vars),
so once you've found good params via `optimize` / `traintest` you can plug them
straight in. CLI flags override the env for a one-off run:

```bash
npm run dev -- --strategy ema --fast 12 --slow 26
npm run dev -- --strategy rsi --rsi-period 14 --oversold 30 --overbought 70
```

### Multi-symbol trading

Set `SYMBOLS` to trade several markets concurrently — each polled every cycle with
its own independent position, sized to `MAX_POSITION_USD`:

```bash
SYMBOLS="BTC/USDT,ETH/USDT,SOL/USDT" npm run dev
```

By default the global strategy runs across all symbols (strategies are stateless —
they read the candle window each time). Positions are stored per symbol in
`STATE_FILE`, and a failure on one symbol is logged and skipped without affecting the
others. Note total exposure scales with the number of symbols (`N × MAX_POSITION_USD`).

### Per-symbol strategies

Give individual symbols their own strategy and parameters with `SYMBOL_STRATEGIES`
(JSON). Any field left out falls back to the global config; symbols not listed use the
global default strategy:

```bash
SYMBOLS="BTC/USDT,ETH/USDT,SOL/USDT" \
SYMBOL_STRATEGIES='{"BTC/USDT":{"strategy":"ema","fast":12,"slow":26},"ETH/USDT":{"strategy":"rsi","rsiPeriod":14}}' \
npm run dev
```

Here BTC/USDT runs `EMA(12/26)`, ETH/USDT runs `RSI(14)`, and SOL/USDT falls back to
the global `STRATEGY`. An unknown strategy name aborts startup with a clear error.

### Position persistence

The bot writes its open position to `STATE_FILE` (default `./state.json`) whenever it
opens or closes, and reloads it on startup — so a restart or crash doesn't lose track
of a live position. Writes are atomic (temp file + rename) so an interrupted write
can't corrupt the state. The file is gitignored.

### Telegram alerts

Get a message whenever the bot opens or closes a position. Set both
`TELEGRAM_BOT_TOKEN` (from [@BotFather](https://t.me/BotFather)) and
`TELEGRAM_CHAT_ID` (from [@userinfobot](https://t.me/userinfobot)); leave either
blank to disable. Alerts include side, price, amount/PnL, fees, and whether the run
is `LIVE` or `DRY_RUN`:

```
🟢 Opened BUY BTC/USDT @ 61250.5
Amount: 0.00163, fee 0.10 — DRY_RUN
Reason: Fast EMA crossed above slow EMA
```

Delivery is best-effort — a Telegram outage is logged as a warning and never
interrupts trading.

### Startup reconciliation

On boot (with live credentials, not in `DRY_RUN`) the bot fetches the actual
base-asset balance and reconciles it against the persisted position, so a fill or
manual trade that happened while it was down doesn't leave it out of sync:

| Situation | Outcome |
| --- | --- |
| No position, no balance | `flat-confirmed` |
| No position, but a balance exists | `unexpected-balance` — stays flat, warns |
| Long matches balance (within `RECONCILE_TOLERANCE`) | `match` |
| Long persisted but balance gone | `closed-externally` — clears the position |
| Long balance drifted beyond tolerance | `quantity-adjusted` — resizes to the real balance |
| Short position | `unverifiable-short` — can't confirm from a spot balance, kept |

Set `RECONCILE=false` to disable. A balance at or below `RECONCILE_DUST` counts as flat.

### Realized-PnL trade log

Every time the bot closes a position it appends a record — entry/exit price, amount,
realized PnL and return % — to `TRADE_LOG_FILE` (default `./trades.jsonl`, one JSON
object per line). Review your track record with:

```bash
npm run pnl            # summary: trades, win rate, total/avg/best/worst PnL
npm run pnl -- --list  # also print every trade
```

```
=== Realized PnL (net of fees) ===
Trades:       2
Win / Loss:   1 / 1  (50.0% win)
Gross PnL:    0.00
Fees:         0.24
Net PnL:      -0.24
Avg net PnL:  -0.12
Best / Worst: 1.08 / -1.32
==================================
```

Live PnL is **fee-accurate**: each order's actual fee is read back from the exchange
(ccxt `order.fee`/`fees`, converted to quote currency), stored with the position on
entry, and netted out on close. `DRY_RUN` orders estimate the fee from `FEE_RATE`.
The backtester models fees separately via `--fee`.

### Web dashboard

Prefer a browser over the terminal? Serve the same trade log as a live dashboard:

```bash
npm run dashboard            # http://localhost:3000 (set DASHBOARD_PORT to change)
```

It shows summary cards (trades, win rate, net PnL, fees, best/worst) and a
newest-first trade table, auto-refreshing every 10s by reading the log fresh — so you
can watch fills land while the bot runs. Endpoints: `/` (HTML), `/api/summary`,
`/api/trades`. Built on Node's `http` module, no extra dependencies.

## Backtesting

Evaluate a strategy over historical candles before risking capital. The engine is
event-driven — it feeds the strategy only the data available up to each candle (no
look-ahead), simulates fills at the candle close with a flat fee, supports long/short
flipping, and reports return, win rate and max drawdown.

```bash
# Fetch data live from a public exchange (no API key needed) and backtest
npm run backtest -- --exchange binance --symbol BTC/USDT --timeframe 1h --limit 500

# Tune the strategy parameters
npm run backtest -- --fast 5 --slow 20 --cash 10000 --size 100 --fee 0.001

# Or backtest from a local CSV (timestamp,open,high,low,close,volume)
npm run backtest -- --csv ./data/btc.csv
```

Sample output:

```
=== Backtest Result ===
Strategy:       SMA(9/21)
Period:         2026-09-05T11:00:00.000Z → 2026-09-26T06:00:00.000Z
Candles:        500
Initial cash:   10000.00
Final equity:   10007.39
Total return:   0.07%
Trades:         23
Win / Loss:     11 / 12
Win rate:       47.8%
Max drawdown:   0.05%
=======================
```

Stop-loss / take-profit are read from your `.env` (`STOP_LOSS_PCT` / `TAKE_PROFIT_PCT`).

## Optimizing (parameter sweep)

Grid-search a strategy's parameters to find the best-performing combination. Ranges
accept a single value (`9`), a list (`5,10,15`), or `start:end:step` (`5:15:2`,
inclusive). Invalid combos (`fast >= slow`, `oversold >= overbought`) are skipped.

```bash
# Sweep EMA fast/slow, rank by return
npm run optimize -- --strategy ema --fast 5:15:2 --slow 20:40:5

# Sweep RSI, rank by win rate, require at least 5 trades, show top 15
npm run optimize -- --strategy rsi --rsi-period 7:21:7 --oversold 20,25,30 \
  --overbought 70,75,80 --metric winRate --min-trades 5 --top 15
```

Flags: `--metric return|winRate|trades`, `--min-trades N` (filters out combos with too
few trades to be meaningful), `--top N` (rows to print). Sample output:

```
=== Parameter Sweep: RSI (ranked by winRate) ===
Tested 27 combos, 23 passed the min-trades filter.

  #  params                      return%  trades    win%   maxDD%
  1  p=14 os=30 ob=70               0.12       8    75.0     0.06
  2  p=7  os=20 ob=80               0.10      10    70.0     0.06
  ...
```

> ⚠️ Grid-search invites overfitting — a combo that looks best on past data may not
> generalize. Use `--min-trades` to avoid rewarding lucky one-off trades, and validate
> a promising combo on a separate time period before trusting it (see below).

## Train/test validation

Measures overfitting directly. The data is split chronologically: parameters are
optimized on the earlier **train** slice, then the single best combo is applied,
untouched, to the later **test** slice. If in-sample returns look great but
out-of-sample collapses, the params were fitted to noise.

```bash
npm run traintest -- --strategy ema --fast 5:15:2 --slow 20:40:5 --train-ratio 0.7
```

Takes the same range/metric/`--min-trades` flags as `optimize`, plus `--train-ratio`
(fraction of candles used for training, default `0.7`). Sample output:

```
=== Train/Test Validation: EMA ===
Split:          70% train / 30% test
Best params:    fast=15 slow=20  (chosen by return in-sample)

--- IN-SAMPLE  (train) ---
  return:   0.04%   trades: 25 (28.0% win)   max DD: 0.10%
--- OUT-OF-SAMPLE (test) ---
  return:   0.07%   trades:  9 (44.4% win)   max DD: 0.04%

Return decay (train - test): -0.04 pts
✓  Out-of-sample performance held up reasonably.
```

## Strategies

Select a strategy with `--strategy` in the backtester. All are built on the shared
indicator helpers in `src/strategy/indicators.ts` (`sma`, `ema`, `rsi`).

| Name | Class | Parameters | Idea |
| --- | --- | --- | --- |
| `sma` | `SmaCrossoverStrategy` | `--fast --slow` | Trend-following: fast SMA crossing the slow SMA |
| `ema` | `EmaCrossoverStrategy` | `--fast --slow` | Like SMA but EMAs react faster to recent price |
| `rsi` | `RsiStrategy` | `--rsi-period --oversold --overbought` | Mean-reversion: buy exiting oversold, sell exiting overbought |

```bash
npm run backtest -- --strategy ema --fast 12 --slow 26
npm run backtest -- --strategy rsi --rsi-period 14 --oversold 30 --overbought 70
```

## Writing your own strategy

Implement the `Strategy` interface — a `name` and an `evaluate(candles: Candle[]): Signal`
method (see `src/strategy/sma-crossover.ts`). Register it in `src/strategy/index.ts` so
it's selectable from the CLI, and/or wire it into `src/index.ts` for live trading.

## Docker

A multi-stage `Dockerfile` builds TypeScript in a full-deps stage, then ships only
the compiled `dist/` and production dependencies in a slim runtime image that runs as
an unprivileged user.

```bash
# Build and run just the bot
docker build -t ftrade-project .
docker run --rm --env-file .env ftrade-project
```

`docker compose` runs the bot and the dashboard together, sharing one data volume so
the dashboard reads the same trade log the bot writes:

```bash
cp .env.example .env          # fill in your values first
docker compose up -d --build  # dashboard on http://localhost:3000
docker compose logs -f bot
```

State and the trade log persist in the named `ftrade-data` volume (mounted at
`/app/data`), so they survive container restarts. Override the default entrypoint to
run the dashboard standalone: `docker run ... ftrade-project node dist/dashboard/run.js`.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request to `main`, across
Node 20 and 22: `npm ci`, then type-check, tests, and build. The status badge at the
top of this file reflects the latest run on `main`.
#   f t r a d e - p r o j e c t  
 