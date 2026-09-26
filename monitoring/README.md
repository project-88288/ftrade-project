# Monitoring

Prometheus + Grafana setup that consumes the dashboard's `/metrics` endpoint.

## Files

| File | Purpose |
| --- | --- |
| `prometheus.yml` | Example scrape config (targets the `dashboard` service) + rule file include |
| `alert-rules.yml` | Prometheus alerting rules (dashboard down, negative PnL, drawdown, low win rate, stuck position) |
| `grafana-dashboard.json` | Importable Grafana dashboard (PnL, win rate, trades, open positions) |

## Prometheus

Point the scrape target at wherever the dashboard runs (`dashboard:3000` inside the
compose network, or `host:3000` otherwise), then run Prometheus with these files:

```bash
prometheus --config.file=prometheus.yml
```

Validate before deploying (no local install needed):

```bash
docker run --rm -v "$PWD:/m" -w /m --entrypoint promtool prom/prometheus:latest check config prometheus.yml
```

Edit thresholds in `alert-rules.yml` to your risk tolerance — the drawdown alert
defaults to a 50 (quote-currency) drop from the 6h peak.

## Grafana

Dashboards → Import → upload `grafana-dashboard.json`, then pick your Prometheus data
source when prompted. Panels use a `datasource` template variable, so no UID editing
is required.
