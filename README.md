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
  strategy/    Trading strategies (SMA crossover reference impl)
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

## Writing your own strategy

Implement an `evaluate(candles: Candle[]): Signal` method (see
`src/strategy/sma-crossover.ts`) and wire it into `src/index.ts`.
