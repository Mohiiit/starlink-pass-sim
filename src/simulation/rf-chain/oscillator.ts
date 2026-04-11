// Local Oscillator model — TCXO with frequency drift, phase noise, PLL lock

import type { OscillatorState } from '../types';
import {
  OSC_NOMINAL_FREQ_HZ,
  OSC_DRIFT_ALPHA_PPM_PER_C,
  OSC_DRIFT_BETA_PPM_PER_C2,
  OSC_UNLOCK_TEMP_C,
  THERMAL_REF_TEMP_C,
} from '../../lib/constants';

// Nominal phase noise mask at standard offsets [1kHz, 10kHz, 100kHz, 1MHz] in dBc/Hz
const NOMINAL_PHASE_NOISE_MASK: [number, number, number, number] = [
  -80, -100, -115, -130,
];

// Temperature effect: +0.05 dB per degC above reference on all mask entries
const PHASE_NOISE_TEMP_COEFF_DB_PER_C = 0.05;

// PLL unlock spike: +20 dB on all mask entries
const PLL_UNLOCK_SPIKE_DB = 20;

/**
 * Compute oscillator state given temperature and signal bandwidth.
 *
 * @param temperature_C  Oscillator temperature
 * @param bandwidth_Hz   Signal bandwidth (used for EVM estimation)
 */
export function computeOscillatorState(
  temperature_C: number,
  bandwidth_Hz: number,
  faultFreqOffset_Hz: number = 0,
  faultUnlock: boolean = false,
): OscillatorState {
  const deltaT = temperature_C - THERMAL_REF_TEMP_C;

  // ---- Frequency drift ----
  // Δf = f_nom * (α*ΔT + β*ΔT²) * 1e-6
  const frequencyOffset_Hz =
    OSC_NOMINAL_FREQ_HZ *
    (OSC_DRIFT_ALPHA_PPM_PER_C * deltaT +
      OSC_DRIFT_BETA_PPM_PER_C2 * deltaT * deltaT) *
    1e-6 + faultFreqOffset_Hz;

  // ---- PLL lock status ----
  const locked = (temperature_C <= OSC_UNLOCK_TEMP_C) && !faultUnlock;

  // ---- Phase noise mask with temperature degradation ----
  const deltaTPositive = Math.max(0, deltaT);
  const tempDegradation_dB =
    PHASE_NOISE_TEMP_COEFF_DB_PER_C * deltaTPositive;
  const unlockSpike_dB = locked ? 0 : PLL_UNLOCK_SPIKE_DB;

  const phaseNoiseMask_dBcHz = NOMINAL_PHASE_NOISE_MASK.map(
    (nominal) => nominal + tempDegradation_dB + unlockSpike_dB,
  );

  // ---- EVM contribution ----
  // Simplified model: EVM_osc ≈ sqrt(2 * 10^(L_avg/10) * BW_signal)
  // L_avg is average phase noise across the mask entries
  const avgPhaseNoise_dBcHz =
    phaseNoiseMask_dBcHz.reduce((sum, val) => sum + val, 0) /
    phaseNoiseMask_dBcHz.length;

  const phaseNoiseLinear = Math.pow(10, avgPhaseNoise_dBcHz / 10);
  const evmRaw = Math.sqrt(2 * phaseNoiseLinear * bandwidth_Hz);
  // Convert to percent; clamp to reasonable range [0.5%, 25%]
  const evmContribution_percent = Math.min(
    25,
    Math.max(0.5, evmRaw * 100),
  );

  return {
    nominalFrequency_Hz: OSC_NOMINAL_FREQ_HZ,
    frequencyOffset_Hz,
    phaseNoiseMask_dBcHz,
    evmContribution_percent,
    temperature_C,
    locked,
  };
}
