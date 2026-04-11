// ============================================================
// Effective Antenna Gain Computation
// ============================================================
//
// The effective gain of a phased array combines several factors:
//
// G_effective = G_array + scanLoss + pointingLoss
//
// where G_array is the broadside array gain before scan losses:
//
//   G_array = 10*log10(N_active)    ... array factor (coherent combining)
//           + G_element(theta)       ... individual element pattern
//           + 10*log10(eta_taper)    ... taper efficiency loss
//
// Array factor:
//   N identical elements, coherently combined, give 10*log10(N) gain
//   above a single element. This assumes uniform excitation. In
//   practice, amplitude tapering (e.g., Taylor window) reduces
//   sidelobes at the cost of ~0.7 dB in directivity (eta_taper ~ 0.85).
//
// Beamwidth:
//   At boresight, the 3 dB beamwidth for a ~1200-element array at
//   Ku-band is approximately 2.5°. As the beam steers, the projected
//   aperture shrinks, broadening the beam:
//     bw(theta) = bw_boresight / cos(theta_steer)
//
// Pointing loss:
//   Real pointing systems have small errors from estimation noise,
//   attitude jitter, and quantization. The loss for a small pointing
//   error delta relative to beamwidth bw is:
//     L_pointing = 12 * (delta / bw)^2  [dB]
//   This is the standard Gaussian beam approximation — 12 dB factor
//   gives exactly 3 dB loss when delta = bw/2 (at the half-power point).
// ============================================================

import { TAPER_EFFICIENCY } from '../../lib/constants';
import { elementGain_dBi } from './element-pattern';
import { scanLoss_dB } from './scan-loss';

/** Boresight 3 dB beamwidth in degrees for the full array */
const BEAMWIDTH_BORESIGHT_DEG = 2.5;

/**
 * Simple seeded pseudo-random number generator (Mulberry32).
 * Returns a function that produces values in [0, 1) on each call.
 *
 * We need deterministic jitter for reproducible simulations.
 * Mulberry32 is a simple 32-bit PRNG with good statistical properties
 * for our purposes (not cryptographic, but fine for pointing jitter).
 *
 * @param seed - Integer seed value
 * @returns A function returning pseudo-random numbers in [0, 1)
 */
function mulberry32(seed: number): () => number {
  let state = seed | 0; // ensure 32-bit integer
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Compute the beamwidth at a given steering angle.
 *
 * As the beam steers off boresight, the projected aperture dimension
 * along the scan plane shrinks by cos(theta), which broadens the beam
 * by 1/cos(theta). This is a fundamental property of aperture antennas.
 *
 * @param steeringAngle_deg - Steering angle in degrees
 * @returns 3 dB beamwidth in degrees
 */
export function beamwidth_deg(steeringAngle_deg: number): number {
  const absTheta = Math.abs(steeringAngle_deg);

  // Clamp to avoid division by zero near 90°
  const clampedTheta = Math.min(absTheta, 89.0);
  const theta_rad = (clampedTheta * Math.PI) / 180;
  const cosTheta = Math.cos(theta_rad);

  // Beamwidth broadens as 1/cos(theta)
  return BEAMWIDTH_BORESIGHT_DEG / cosTheta;
}

/**
 * Compute the pointing error (random jitter) for this simulation step.
 *
 * Real satellite pointing systems have ~0.1° RMS jitter from:
 *   - Star tracker noise
 *   - Reaction wheel vibration
 *   - Beam-steering quantization (phase shifter bit resolution)
 *
 * We model this as a Rayleigh-distributed error with sigma = 0.1°.
 * The Rayleigh distribution naturally models the magnitude of a
 * 2D Gaussian pointing error (azimuth + elevation components).
 *
 * @param seed - Random seed for determinism
 * @returns Pointing error magnitude in degrees (always >= 0)
 */
export function pointingError_deg(seed: number): number {
  const rng = mulberry32(seed);
  const sigma = 0.1; // RMS pointing jitter in degrees

  // Rayleigh distribution from uniform: r = sigma * sqrt(-2 * ln(u))
  // where u is uniform on (0, 1)
  const u = rng();
  // Guard against u=0 which would give infinity
  const safeU = Math.max(u, 1e-10);
  const error = sigma * Math.sqrt(-2 * Math.log(safeU));

  return error;
}

/**
 * Compute pointing loss from a beam offset error.
 *
 * Standard Gaussian beam approximation:
 *   L = 12 * (error / beamwidth)^2  [dB]
 *
 * Derivation: A Gaussian beam has power P(theta) = P0 * exp(-4*ln(2) * (theta/bw)^2).
 * Converting to dB: L = -(10/ln(10)) * (-4*ln(2)) * (theta/bw)^2
 *                     = (40*ln(2)/ln(10)) * (theta/bw)^2
 *                     ≈ 12.04 * (theta/bw)^2
 * At theta = bw/2 (half-power point): L = 12 * 0.25 = 3 dB (correct by definition).
 *
 * @param error_deg - Pointing error in degrees
 * @param beamwidth_deg - 3 dB beamwidth in degrees
 * @returns Pointing loss in dB (positive value, representing loss to subtract)
 */
export function pointingLoss_dB(
  error_deg: number,
  beamwidth_deg: number
): number {
  if (beamwidth_deg <= 0) {
    return 0;
  }
  const ratio = error_deg / beamwidth_deg;
  return 12 * ratio * ratio;
}

/**
 * Compute the full effective antenna gain.
 *
 * @param steeringAngle_deg - Off-boresight steering angle in degrees
 * @param activeElements - Number of active radiating elements
 * @param randomSeed - Seed for deterministic pointing jitter
 * @returns Object with all gain components broken out
 */
export function computeEffectiveGain(
  steeringAngle_deg: number,
  activeElements: number,
  randomSeed: number
): {
  elementGain_dBi: number;
  arrayGain_dBi: number;
  scanLoss: number;
  beamwidth: number;
  pointingError: number;
  pointingLoss: number;
  effectiveGain_dBi: number;
} {
  // Clamp active elements to at least 1 to avoid log10(0) = -Infinity
  const clampedElements = Math.max(activeElements, 1);

  // Individual element gain at this scan angle
  const elGain = elementGain_dBi(steeringAngle_deg);

  // Array factor: coherent combining of N elements
  // Plus taper efficiency (Taylor window for sidelobe control)
  const arrayFactor_dB = 10 * Math.log10(clampedElements);
  const taperLoss_dB = 10 * Math.log10(TAPER_EFFICIENCY);
  const arrGain = arrayFactor_dB + elGain + taperLoss_dB;

  // Scan loss (negative dB value)
  const scan = scanLoss_dB(steeringAngle_deg);

  // Beamwidth at this steering angle
  const bw = beamwidth_deg(steeringAngle_deg);

  // Pointing error from jitter
  const ptError = pointingError_deg(randomSeed);

  // Pointing loss from the error
  const ptLoss = pointingLoss_dB(ptError, bw);

  // Effective gain: array gain + scan loss - pointing loss
  // scan loss is already negative, pointing loss is positive
  const effective = arrGain + scan - ptLoss;

  return {
    elementGain_dBi: elGain,
    arrayGain_dBi: arrGain,
    scanLoss: scan,
    beamwidth: bw,
    pointingError: ptError,
    pointingLoss: ptLoss,
    effectiveGain_dBi: effective,
  };
}
