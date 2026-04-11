// Power Amplifier model — Rapp model for solid-state PA
// AM/AM compression, AM/PM distortion, EVM, efficiency, thermal derating

import type { PowerAmplifierState } from '../types';
import {
  PA_SMALL_SIGNAL_GAIN_DB,
  PA_P_SAT_DBM,
  PA_P1DB_DBM,
  PA_RAPP_P,
  PA_AMPM_ALPHA_DEG,
  PA_EFF_AT_SAT,
  PA_P1DB_DERATING_DB_PER_C,
  PA_GAIN_DERATING_DB_PER_C,
  PA_EFF_DERATING_PER_C,
  PA_THERMAL_THROTTLE_MILD_C,
  PA_THERMAL_THROTTLE_SEVERE_C,
  PA_THERMAL_THROTTLE_EXTRA_BACKOFF_DB,
  THERMAL_REF_TEMP_C,
} from '../../lib/constants';

// ---- dBm <-> linear (mW) helpers ----

function dBmToLinear(dBm: number): number {
  return Math.pow(10, dBm / 10); // mW
}

function linearTodBm(mW: number): number {
  return 10 * Math.log10(mW);
}

// ---- Calibrate EVM constant k ----
// Model: EVM_PA ≈ k / 10^(OBO/20)
// At OBO = 3 dB, EVM = 4%  =>  k = 4 * 10^(3/20) ≈ 5.65
// At OBO = 6 dB, EVM = 1.5% => k = 1.5 * 10^(6/20) ≈ 2.99
// At OBO = 1 dB, EVM = 10%  => k = 10 * 10^(1/20) ≈ 11.22
// Average k ≈ 6.6 — use geometric-ish mean biased toward the 3 dB point
const EVM_K = 5.65;

/**
 * Compute PA state using Rapp model with thermal derating.
 *
 * @param desiredBackoff_dB  Target output backoff from P_sat (positive dB)
 * @param junctionTemp_C     PA junction temperature
 */
export function computePAState(
  desiredBackoff_dB: number,
  junctionTemp_C: number,
  faultP1dBReduction_dB: number = 0,
): PowerAmplifierState {
  const deltaT = junctionTemp_C - THERMAL_REF_TEMP_C;
  const deltaTPositive = Math.max(0, deltaT);

  // ---- Thermal derating ----
  const gainDerate_dB = PA_GAIN_DERATING_DB_PER_C * deltaTPositive;
  const p1dBDerate_dB = PA_P1DB_DERATING_DB_PER_C * deltaTPositive + faultP1dBReduction_dB;
  const effDerate = PA_EFF_DERATING_PER_C * deltaTPositive;

  const gain_dB = PA_SMALL_SIGNAL_GAIN_DB - gainDerate_dB;
  const p1dB_derated_dBm = PA_P1DB_DBM - p1dBDerate_dB;
  const pSat_derated_dBm = PA_P_SAT_DBM - p1dBDerate_dB; // P_sat derates similarly
  const etaSat = Math.max(0.05, PA_EFF_AT_SAT - effDerate);

  // ---- Throttling: force extra backoff ----
  let effectiveBackoff_dB = desiredBackoff_dB;
  if (junctionTemp_C > PA_THERMAL_THROTTLE_SEVERE_C) {
    effectiveBackoff_dB += 2 * PA_THERMAL_THROTTLE_EXTRA_BACKOFF_DB;
  } else if (junctionTemp_C > PA_THERMAL_THROTTLE_MILD_C) {
    effectiveBackoff_dB += PA_THERMAL_THROTTLE_EXTRA_BACKOFF_DB;
  }

  // ---- Desired output power ----
  const pOut_dBm = pSat_derated_dBm - effectiveBackoff_dB;
  const pOut_mW = dBmToLinear(pOut_dBm);
  const pSat_mW = dBmToLinear(pSat_derated_dBm);

  // ---- Rapp AM/AM: solve for P_in ----
  // P_out = G_ss * P_in / (1 + (G_ss * P_in / P_sat)^(2p))^(1/(2p))
  // We invert: given P_out, find P_in numerically via bisection
  const G_ss = Math.pow(10, gain_dB / 10); // linear gain
  const p = PA_RAPP_P;

  const pIn_mW = solveRappInput(pOut_mW, G_ss, pSat_mW, p);
  const pIn_dBm = linearTodBm(pIn_mW);

  // Verify actual output through Rapp model
  const actualPOut_mW = rappAmAm(pIn_mW, G_ss, pSat_mW, p);
  const actualPOut_dBm = linearTodBm(actualPOut_mW);

  // ---- Compression level ----
  // How far we are from linear: compression = G_ss*P_in (linear) - actual P_out
  const linearOut_dBm = linearTodBm(G_ss * pIn_mW);
  const compressionLevel_dB = linearOut_dBm - actualPOut_dBm;

  // ---- AM/PM distortion ----
  const p1dB_mW = dBmToLinear(p1dB_derated_dBm);
  const ratio = pIn_mW / p1dB_mW;
  const ampmDistortion_deg =
    PA_AMPM_ALPHA_DEG * Math.pow(ratio, 2) / (1 + Math.pow(ratio, 2));

  // ---- EVM from backoff ----
  const obo_dB = effectiveBackoff_dB;
  const evmContribution_percent = EVM_K / Math.pow(10, obo_dB / 20);

  // ---- Efficiency (class AB approximation) ----
  const pOutRatio = actualPOut_mW / pSat_mW;
  const efficiency = etaSat * Math.sqrt(Math.max(0, pOutRatio));
  const efficiency_percent = Math.min(100, Math.max(1, efficiency * 100));

  // ---- DC power and heat ----
  const pOut_W = actualPOut_mW / 1000; // mW -> W
  const dcPowerDraw_W = pOut_W / (efficiency_percent / 100);
  const heatDissipation_W = dcPowerDraw_W - pOut_W;

  return {
    inputPower_dBm: pIn_dBm,
    outputPower_dBm: actualPOut_dBm,
    gain_dB: actualPOut_dBm - pIn_dBm,
    backoff_dB: effectiveBackoff_dB,
    compressionLevel_dB,
    efficiency_percent,
    dcPowerDraw_W,
    heatDissipation_W,
    evmContribution_percent,
    ampmDistortion_deg,
    junctionTemperature_C: junctionTemp_C,
    p1dB_derated_dBm,
  };
}

// ---- Rapp model AM/AM transfer ----

function rappAmAm(
  pIn_mW: number,
  G_ss: number,
  pSat_mW: number,
  p: number,
): number {
  const linearOut = G_ss * pIn_mW;
  const x = linearOut / pSat_mW;
  const denominator = Math.pow(1 + Math.pow(x, 2 * p), 1 / (2 * p));
  return linearOut / denominator;
}

// ---- Bisection solver: find P_in for desired P_out ----

function solveRappInput(
  targetPOut_mW: number,
  G_ss: number,
  pSat_mW: number,
  p: number,
): number {
  // P_in must be between 0 and P_sat / G_ss (well into saturation)
  let lo = 0;
  let hi = (pSat_mW / G_ss) * 10; // generous upper bound
  const maxIter = 60;
  const tol = 1e-9;

  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    const pOut = rappAmAm(mid, G_ss, pSat_mW, p);
    if (Math.abs(pOut - targetPOut_mW) < tol) return mid;
    if (pOut < targetPOut_mW) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}
