// ============================================================
// Doppler Shift and Doppler-Induced Penalty
// ============================================================
//
// Computes the Doppler frequency shift from satellite range rate and
// estimates the SNR penalty caused by imperfect Doppler tracking.
//
// At Ku-band (12 GHz) with LEO velocities (~7.5 km/s), the maximum
// Doppler shift is approximately +/-300 kHz. The tracking loop
// compensates for most of this, but residual errors degrade the SNR.
// ============================================================

import { SPEED_OF_LIGHT, DOWNLINK_FREQ_HZ } from '../../lib/constants';

// Maximum expected Doppler rate for normalization (Hz/s)
// At 550 km LEO, overhead pass: ~40 kHz/s peak
const MAX_DOPPLER_RATE_HZ_PER_S = 40000;

/**
 * Compute the Doppler frequency shift from range rate.
 *
 * @param rangeRate_km_s - Range rate in km/s (negative = approaching, positive = receding).
 * @param carrierFreq_Hz - Carrier frequency in Hz (default: 12 GHz).
 * @returns Doppler shift in Hz. Negative means frequency is higher than nominal (approaching).
 */
export function dopplerShift_Hz(
  rangeRate_km_s: number,
  carrierFreq_Hz: number = DOWNLINK_FREQ_HZ,
): number {
  // Convert range rate from km/s to m/s
  const rangeRate_m_s = rangeRate_km_s * 1000;
  // f_doppler = f_carrier * v_radial / c
  // Positive range rate (receding) -> negative frequency shift
  return carrierFreq_Hz * rangeRate_m_s / SPEED_OF_LIGHT;
}

/**
 * Estimate the Doppler rate (rate of change of Doppler shift) from
 * consecutive range rate values.
 *
 * @param rangeRate_km_s - Current range rate in km/s.
 * @param prevRangeRate_km_s - Previous range rate in km/s.
 * @param dt_s - Time between samples in seconds.
 * @param carrierFreq_Hz - Carrier frequency in Hz.
 * @returns Doppler rate in Hz/s.
 */
export function dopplerRate_HzPerSec(
  rangeRate_km_s: number,
  prevRangeRate_km_s: number,
  dt_s: number,
  carrierFreq_Hz: number = DOWNLINK_FREQ_HZ,
): number {
  if (dt_s <= 0) return 0;

  const currentShift = dopplerShift_Hz(rangeRate_km_s, carrierFreq_Hz);
  const prevShift = dopplerShift_Hz(prevRangeRate_km_s, carrierFreq_Hz);

  return (currentShift - prevShift) / dt_s;
}

/**
 * Compute the SNR penalty from Doppler tracking residual.
 *
 * Higher Doppler rates mean the tracking loop has more difficulty
 * keeping up, leading to larger frequency/phase errors and SNR loss.
 *
 * @param dopplerRateValue_HzPerSec - Absolute Doppler rate in Hz/s.
 * @returns Doppler-induced SNR penalty in dB (always >= 0).
 */
export function dopplerPenalty_dB(dopplerRateValue_HzPerSec: number): number {
  const absDopplerRate = Math.abs(dopplerRateValue_HzPerSec);
  // Base penalty of 0.1 dB (always present from oscillator/tracking imperfections)
  // plus a rate-dependent term scaled to max expected Doppler rate
  return 0.1 + 0.2 * absDopplerRate / MAX_DOPPLER_RATE_HZ_PER_S;
}
