// ============================================================
// Phased Array Antenna — Main Entry Point
// ============================================================
//
// Combines element pattern, scan loss, and effective gain into
// a single AntennaState for each simulation tick.
//
// The steering angle is the angle between boresight (nadir for
// Starlink) and the direction to the ground station. It comes
// from orbital geometry: at high elevation, the steering angle
// is small (beam near boresight); at low elevation, the steering
// angle is large (beam scanned far off boresight).
//
// Usage:
//   const state = computeAntennaState(45, 1100, 1200, 42);
//   // Returns full AntennaState with all gain components
// ============================================================

import { AntennaState } from '../types';
import {
  TOTAL_ELEMENTS,
  MAX_SCAN_ANGLE_DEG,
} from '../../lib/constants';
import { computeEffectiveGain } from './effective-gain';

// Re-export submodule functions for direct access if needed
export { elementGain_dBi } from './element-pattern';
export { scanLoss_dB, activeReflectionCoefficient } from './scan-loss';
export {
  beamwidth_deg,
  pointingError_deg,
  pointingLoss_dB,
  computeEffectiveGain,
} from './effective-gain';

/**
 * Compute the complete antenna state for a given simulation instant.
 *
 * @param steeringAngle_deg - Off-boresight steering angle in degrees.
 *   This is determined by orbital geometry: the angle between the
 *   satellite's nadir and the line-of-sight to the ground station.
 *   Valid range: 0° (overhead) to MAX_SCAN_ANGLE_DEG (~70°).
 *
 * @param activeElements - Number of currently active radiating elements.
 *   May be less than totalElements due to element failures (fault model)
 *   or deliberate deactivation for power/thermal management.
 *
 * @param totalElements - Total number of elements in the array
 *   (including failed/inactive ones). Used for reference only.
 *
 * @param randomSeed - Seed for the pseudo-random pointing jitter.
 *   Use a different seed each tick for varying jitter; use the same
 *   seed to reproduce identical results.
 *
 * @returns Complete AntennaState with all gain components
 */
export function computeAntennaState(
  steeringAngle_deg: number,
  activeElements: number,
  totalElements: number = TOTAL_ELEMENTS,
  randomSeed: number = 0
): AntennaState {
  // ---- Input validation and clamping ----

  // Clamp steering angle to the physically usable range.
  // Beyond MAX_SCAN_ANGLE_DEG, the beam quality degrades so severely
  // that the link is unusable — the link budget model should handle
  // this by detecting negative margin.
  const clampedSteering = Math.min(
    Math.max(Math.abs(steeringAngle_deg), 0),
    MAX_SCAN_ANGLE_DEG
  );

  // Active elements can't exceed total and must be at least 0
  const clampedActive = Math.min(
    Math.max(Math.round(activeElements), 0),
    totalElements
  );

  // ---- Compute all gain components ----

  const result = computeEffectiveGain(
    clampedSteering,
    clampedActive,
    randomSeed
  );

  // ---- Assemble output ----

  return {
    steeringAngle_deg: clampedSteering,
    elementGain_dBi: result.elementGain_dBi,
    arrayGain_dBi: result.arrayGain_dBi,
    scanLoss_dB: result.scanLoss,
    effectiveGain_dBi: result.effectiveGain_dBi,
    beamwidth_deg: result.beamwidth,
    pointingError_deg: result.pointingError,
    pointingLoss_dB: result.pointingLoss,
    activeElements: clampedActive,
    totalElements,
  };
}
