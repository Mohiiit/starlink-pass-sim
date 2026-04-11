/**
 * Format a number to fixed decimal places, handling edge cases.
 */
export function fmt(value: number, decimals: number = 1): string {
  if (!isFinite(value)) return '—';
  return value.toFixed(decimals);
}

/**
 * Format a number in engineering/scientific notation for BER display.
 */
export function fmtSci(value: number): string {
  if (value === 0) return '0';
  if (!isFinite(value)) return '—';
  return value.toExponential(1);
}

/**
 * Format seconds into MM:SS.
 */
export function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Format Mbps to human-readable.
 */
export function fmtRate(mbps: number): string {
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(1)} Gbps`;
  if (mbps >= 1) return `${mbps.toFixed(1)} Mbps`;
  return `${(mbps * 1000).toFixed(0)} kbps`;
}

/**
 * Convert dBm to Watts.
 */
export function dbmToW(dBm: number): number {
  return Math.pow(10, (dBm - 30) / 10);
}

/**
 * Convert Watts to dBm.
 */
export function wToDbm(w: number): number {
  return 10 * Math.log10(w) + 30;
}

/**
 * dB to linear ratio.
 */
export function dbToLinear(dB: number): number {
  return Math.pow(10, dB / 10);
}

/**
 * Linear ratio to dB.
 */
export function linearToDb(ratio: number): number {
  return 10 * Math.log10(ratio);
}

/**
 * Clamp a value to [min, max].
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Deterministic pseudo-random number generator (mulberry32).
 * Returns a function that produces numbers in [0, 1).
 */
export function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Color for system health status.
 */
export function healthColor(health: 'nominal' | 'degraded' | 'critical'): string {
  switch (health) {
    case 'nominal': return '#22c55e';
    case 'degraded': return '#f59e0b';
    case 'critical': return '#ef4444';
  }
}

/**
 * Color for a value on a green-yellow-red gradient.
 * low = green, high = red.
 */
export function heatColor(value: number, min: number, max: number): string {
  const t = clamp((value - min) / (max - min), 0, 1);
  if (t < 0.5) {
    // green to yellow
    const g = 197;
    const r = Math.round(t * 2 * 245);
    return `rgb(${r}, ${g}, 62)`;
  } else {
    // yellow to red
    const r = 245;
    const g = Math.round((1 - (t - 0.5) * 2) * 197);
    return `rgb(${r}, ${g}, 62)`;
  }
}
