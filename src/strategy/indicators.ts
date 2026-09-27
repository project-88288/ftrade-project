/**
 * Technical indicators. Each returns an array aligned to the input length, with
 * `null` for positions where the indicator is not yet defined (warmup period).
 */

/** Simple moving average. */
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average, seeded with an SMA of the first `period` values. */
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);

  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i]!;
  let prev = seed / period;
  out[period - 1] = prev;

  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's Relative Strength Index (0..100). */
export function rsi(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length <= period) return out;

  let avgGain = 0;
  let avgLoss = 0;
  // Seed with the simple average of the first `period` changes.
  for (let i = 1; i <= period; i++) {
    const change = values[i]! - values[i - 1]!;
    if (change >= 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = rsiFrom(avgGain, avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i]! - values[i - 1]!;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = rsiFrom(avgGain, avgLoss);
  }
  return out;
}

function rsiFrom(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * MACD: the difference between a fast and slow EMA (the MACD line), a signal line
 * (an EMA of the MACD line), and their difference (the histogram). The signal EMA
 * is seeded with an SMA of the first `signalPeriod` defined MACD values.
 */
export function macd(
  values: number[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number,
): { macd: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] } {
  const fast = ema(values, fastPeriod);
  const slow = ema(values, slowPeriod);
  const line: (number | null)[] = values.map((_, i) =>
    fast[i] != null && slow[i] != null ? fast[i]! - slow[i]! : null,
  );

  const signal: (number | null)[] = new Array(values.length).fill(null);
  const firstIdx = line.findIndex((v) => v != null);
  if (firstIdx !== -1 && signalPeriod > 0 && values.length - firstIdx >= signalPeriod) {
    const k = 2 / (signalPeriod + 1);
    let seed = 0;
    for (let i = firstIdx; i < firstIdx + signalPeriod; i++) seed += line[i]!;
    let prev = seed / signalPeriod;
    signal[firstIdx + signalPeriod - 1] = prev;
    for (let i = firstIdx + signalPeriod; i < values.length; i++) {
      prev = line[i]! * k + prev * (1 - k);
      signal[i] = prev;
    }
  }

  const histogram: (number | null)[] = values.map((_, i) =>
    line[i] != null && signal[i] != null ? line[i]! - signal[i]! : null,
  );
  return { macd: line, signal, histogram };
}

/**
 * Bollinger Bands: an SMA middle band with upper/lower bands `mult` population
 * standard deviations away, measured over the same window.
 */
export function bollingerBands(
  values: number[],
  period: number,
  mult: number,
): { middle: (number | null)[]; upper: (number | null)[]; lower: (number | null)[] } {
  const middle = sma(values, period);
  const upper: (number | null)[] = new Array(values.length).fill(null);
  const lower: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) return { middle, upper, lower };

  for (let i = period - 1; i < values.length; i++) {
    const mean = middle[i];
    if (mean == null) continue;
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j]! - mean;
      sumSq += d * d;
    }
    const std = Math.sqrt(sumSq / period);
    upper[i] = mean + mult * std;
    lower[i] = mean - mult * std;
  }
  return { middle, upper, lower };
}

/**
 * Stochastic oscillator. %K is where the close sits within the high/low range of
 * the last `kPeriod` candles (0..100); %D is an SMA of %K over `dPeriod`.
 */
export function stochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod: number,
  dPeriod: number,
): { k: (number | null)[]; d: (number | null)[] } {
  const n = closes.length;
  const k: (number | null)[] = new Array(n).fill(null);
  const d: (number | null)[] = new Array(n).fill(null);
  if (kPeriod <= 0 || dPeriod <= 0) return { k, d };

  for (let i = kPeriod - 1; i < n; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (highs[j]! > hh) hh = highs[j]!;
      if (lows[j]! < ll) ll = lows[j]!;
    }
    const range = hh - ll;
    k[i] = range === 0 ? 100 : ((closes[i]! - ll) / range) * 100;
  }

  const firstK = kPeriod - 1;
  for (let i = firstK + dPeriod - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - dPeriod + 1; j <= i; j++) sum += k[j]!;
    d[i] = sum / dPeriod;
  }
  return { k, d };
}

/**
 * Donchian channel: the highest high and lowest low of the `period` candles
 * *preceding* the current one (excludes the current candle to avoid look-ahead,
 * so a breakout of the channel is a genuine new extreme).
 */
export function donchian(
  highs: number[],
  lows: number[],
  period: number,
): { upper: (number | null)[]; lower: (number | null)[] } {
  const n = highs.length;
  const upper: (number | null)[] = new Array(n).fill(null);
  const lower: (number | null)[] = new Array(n).fill(null);
  if (period <= 0) return { upper, lower };

  for (let i = period; i < n; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - period; j < i; j++) {
      if (highs[j]! > hh) hh = highs[j]!;
      if (lows[j]! < ll) ll = lows[j]!;
    }
    upper[i] = hh;
    lower[i] = ll;
  }
  return { upper, lower };
}
