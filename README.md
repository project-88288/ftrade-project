# ftrade-project

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
| `SYMBOL` | Market to trade, e.g. `BTC/USDT` |
| `SANDBOX` | Use the exchange testnet when `true` |
| `DRY_RUN` | Log intended orders instead of sending them |
| `MAX_POSITION_USD` | Notional size per position |
| `STOP_LOSS_PCT` / `TAKE_PROFIT_PCT` | Exit thresholds |

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
