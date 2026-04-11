// ============================================================
// ModCod Selection — Modulation and Coding Rate Table
// ============================================================
//
// DVB-S2-style adaptive modulation and coding (ACM) table.
// Each entry defines a modulation scheme, code rate, required SNR
// threshold, and spectral efficiency. The selector picks the highest
// spectral efficiency entry that the current SNR can support.
//
// Hysteresis prevents rapid toggling between adjacent entries
// when SNR is near a threshold boundary.
// ============================================================

import type { ModCodEntry } from '../types';

/**
 * Complete ModCod table ordered by increasing required SNR.
 * The selector walks this from top (most robust) to bottom (most efficient).
 */
export const MODCOD_TABLE: ModCodEntry[] = [
  { index: 1, modulation: 'QPSK', codeRate: '1/4', requiredSNR_dB: 0.2, spectralEfficiency: 0.49 },
  { index: 2, modulation: 'QPSK', codeRate: '1/3', requiredSNR_dB: 1.0, spectralEfficiency: 0.66 },
  { index: 3, modulation: 'QPSK', codeRate: '1/2', requiredSNR_dB: 3.0, spectralEfficiency: 1.0 },
  { index: 4, modulation: 'QPSK', codeRate: '2/3', requiredSNR_dB: 4.7, spectralEfficiency: 1.3 },
  { index: 5, modulation: 'QPSK', codeRate: '3/4', requiredSNR_dB: 5.5, spectralEfficiency: 1.5 },
  { index: 6, modulation: '8PSK', codeRate: '2/3', requiredSNR_dB: 8.5, spectralEfficiency: 2.0 },
  { index: 7, modulation: '8PSK', codeRate: '3/4', requiredSNR_dB: 10.0, spectralEfficiency: 2.3 },
  { index: 8, modulation: '16APSK', codeRate: '2/3', requiredSNR_dB: 11.5, spectralEfficiency: 2.6 },
  { index: 9, modulation: '16APSK', codeRate: '3/4', requiredSNR_dB: 13.0, spectralEfficiency: 3.0 },
  { index: 10, modulation: '32APSK', codeRate: '3/4', requiredSNR_dB: 16.0, spectralEfficiency: 3.7 },
  { index: 11, modulation: '64APSK', codeRate: '2/3', requiredSNR_dB: 18.0, spectralEfficiency: 4.0 },
  { index: 12, modulation: '64APSK', codeRate: '3/4', requiredSNR_dB: 20.0, spectralEfficiency: 4.5 },
];

/**
 * Select the best ModCod entry for the current SNR.
 *
 * Selection logic with hysteresis:
 *   - To move UP to a higher index (more efficient): SNR must exceed
 *     that entry's requiredSNR + hysteresis_dB. This prevents oscillation.
 *   - To STAY at the current index: SNR must exceed requiredSNR - 0.5 dB.
 *     This provides a "stay" region that avoids dropping prematurely.
 *   - To move DOWN: if SNR falls below current entry's requiredSNR - 0.5 dB,
 *     drop to the highest entry we can still support.
 *
 * @param snr_dB - Current effective SNR in dB.
 * @param currentModCod - Index of the currently active ModCod (1-12), or 0 for initial.
 * @param hysteresis_dB - Hysteresis margin for upward transitions (default 1.5 dB).
 * @returns The selected ModCodEntry.
 */
export function selectModCod(
  snr_dB: number,
  currentModCod: number,
  hysteresis_dB: number = 1.5,
): ModCodEntry {
  // If SNR is below the most robust entry, return it anyway (best effort)
  if (snr_dB < MODCOD_TABLE[0].requiredSNR_dB - 0.5) {
    return MODCOD_TABLE[0];
  }

  // Find the current entry (or treat index 0 as "no previous")
  const currentEntry = MODCOD_TABLE.find((e) => e.index === currentModCod);

  // Determine the best entry we can select
  let selected = MODCOD_TABLE[0];

  for (let i = MODCOD_TABLE.length - 1; i >= 0; i--) {
    const entry = MODCOD_TABLE[i];

    if (currentEntry && entry.index === currentEntry.index) {
      // Staying at current: use relaxed threshold
      if (snr_dB > entry.requiredSNR_dB - 0.5) {
        selected = entry;
        break;
      }
    } else if (currentEntry && entry.index > currentEntry.index) {
      // Moving up: require hysteresis
      if (snr_dB > entry.requiredSNR_dB + hysteresis_dB) {
        selected = entry;
        break;
      }
    } else {
      // Moving down or no previous: use base threshold
      if (snr_dB > entry.requiredSNR_dB) {
        selected = entry;
        break;
      }
    }
  }

  return selected;
}

/**
 * Look up a ModCod entry by index.
 * Returns the entry or the most robust fallback if the index is invalid.
 */
export function getModCodByIndex(index: number): ModCodEntry {
  return MODCOD_TABLE.find((e) => e.index === index) ?? MODCOD_TABLE[0];
}
