// ============================================================
// Fault Applicator — Apply active faults to subsystem states
// ============================================================
//
// Each function takes a baseline subsystem parameter and the list
// of currently active faults, then returns the degraded value.
// Faults are additive/multiplicative depending on the degradation
// mode — multiple simultaneous faults compound their effects.
// ============================================================

import type { FaultEvent, ThermalState } from '../types';

/**
 * Apply antenna element failure faults.
 * Reduces the count of active elements based on fault severity.
 *
 * @param baseActiveElements - Nominal active element count.
 * @param activeFaults - Currently active faults.
 * @returns Reduced active element count.
 */
export function applyAntennaFaults(
  baseActiveElements: number,
  activeFaults: FaultEvent[],
): number {
  let elements = baseActiveElements;

  for (const fault of activeFaults) {
    if (fault.type === 'element_failure') {
      // severity maps to fraction of elements failed
      const failedFraction = fault.parameters.failedFraction ?? fault.severity;
      elements = Math.max(0, Math.round(elements * (1 - failedFraction)));
    }
  }

  return elements;
}

/**
 * Apply PA-related faults.
 * Returns the additional backoff modifier and P1dB reduction relative
 * to the base operating point. The engine adds backoffMod to the
 * desired backoff, and passes p1dbReduction to the RF chain.
 *
 * @param baseBackoff_dB - Nominal PA backoff in dB (used as reference only).
 * @param activeFaults - Currently active faults.
 * @returns Object with backoffMod (dB to add) and p1dbReduction (dB to subtract from P1dB).
 */
export function applyPAFaults(
  baseBackoff_dB: number,
  activeFaults: FaultEvent[],
): { backoffMod: number; p1dbReduction: number } {
  let backoffMod = 0;
  let p1dbReduction = 0;

  for (const fault of activeFaults) {
    if (fault.type === 'pa_degradation') {
      // Gain degradation effectively forces more backoff
      const gainReduction = fault.parameters.gainReduction_dB ?? fault.severity * 5;
      backoffMod += gainReduction;
      // P1dB also degrades
      const p1dBLoss = fault.parameters.p1dBReduction_dB ?? fault.severity * 3;
      p1dbReduction += p1dBLoss;
    }

    if (fault.type === 'pa_thermal_runaway') {
      // Thermal runaway reduces P1dB significantly and forces backoff
      const tempRise = fault.parameters.tempRise_C ?? fault.severity * 50;
      // Every 10C above nominal reduces P1dB by ~0.2 dB
      p1dbReduction += tempRise * 0.02;
      // Also forces additional backoff to prevent further heating
      backoffMod += fault.severity * 3;
    }
  }

  return { backoffMod, p1dbReduction };
}

/**
 * Apply oscillator faults.
 * Can cause frequency offset spikes (drift) or complete PLL unlock.
 * Returns the fault-induced frequency offset delta and unlock flag.
 *
 * @param baseState - Nominal oscillator state (at minimum: frequencyOffset_Hz, locked).
 * @param activeFaults - Currently active faults.
 * @returns Object with freqOffset (Hz delta from fault) and unlock (true if PLL unlocked by fault).
 */
export function applyOscillatorFaults(
  baseState: {
    frequencyOffset_Hz: number;
    locked: boolean;
  },
  activeFaults: FaultEvent[],
): {
  freqOffset: number;
  unlock: boolean;
} {
  let freqOffset = 0;
  let unlock = false;

  for (const fault of activeFaults) {
    if (fault.type === 'oscillator_drift') {
      // Add extra frequency offset
      const extraOffset = fault.parameters.frequencySpike_Hz ?? fault.severity * 10000;
      freqOffset += extraOffset;
    }

    if (fault.type === 'oscillator_unlock') {
      // Complete PLL unlock
      unlock = true;
      // Massive frequency spike
      const spike = fault.parameters.frequencySpike_Hz ?? 50000;
      freqOffset += spike;
    }
  }

  return { freqOffset, unlock };
}

/**
 * Apply power/battery/solar faults.
 * Returns reduction fractions (0-1) that the engine applies multiplicatively
 * to the solar output and battery SoC.
 *
 * @param baseSoC_percent - Current battery SoC (percent).
 * @param baseSolarOutput_W - Current solar panel output (watts).
 * @param activeFaults - Currently active faults.
 * @returns solarReduction (fraction, 0-1) and capacityReduction (fraction, 0-1).
 */
export function applyPowerFaults(
  baseSoC_percent: number,
  baseSolarOutput_W: number,
  activeFaults: FaultEvent[],
): { solarReduction: number; capacityReduction: number } {
  let solarReduction = 0;
  let capacityReduction = 0;

  for (const fault of activeFaults) {
    if (fault.type === 'battery_degradation') {
      // Accumulate capacity reduction
      const capRed = fault.parameters.capacityReduction ?? fault.severity;
      capacityReduction = 1 - (1 - capacityReduction) * (1 - capRed);
      // Some battery faults also affect solar charging
      const solRed = fault.parameters.solarReduction ?? 0;
      solarReduction = 1 - (1 - solarReduction) * (1 - solRed);
    }

    if (fault.type === 'solar_panel_damage') {
      // Direct reduction of solar output
      const damage = fault.parameters.outputReduction ?? fault.severity;
      solarReduction = 1 - (1 - solarReduction) * (1 - damage);
    }
  }

  return {
    solarReduction: Math.max(0, Math.min(1, solarReduction)),
    capacityReduction: Math.max(0, Math.min(1, capacityReduction)),
  };
}

/**
 * Apply thermal faults.
 * Can increase heat generation or reduce radiator efficiency.
 * Accepts a ThermalState (or compatible object) and returns
 * a heat multiplier and radiator efficiency factor.
 *
 * @param baseState - Baseline thermal state (uses paJunction_C for reference).
 * @param activeFaults - Currently active faults.
 * @returns heatMultiplier (>=1.0) and radiatorEfficiency (0-1).
 */
export function applyThermalFaults(
  baseState: ThermalState | { paJunction_C: number },
  activeFaults: FaultEvent[],
): {
  heatMultiplier: number;
  radiatorEfficiency: number;
} {
  let heatMultiplier = 1.0;
  let radiatorEfficiency = 1.0;

  for (const fault of activeFaults) {
    if (fault.type === 'pa_thermal_runaway') {
      // Increased heat generation
      const heatMult = fault.parameters.heatMultiplier ?? 1 + fault.severity;
      heatMultiplier *= heatMult;
    }

    if (fault.type === 'radiator_degradation') {
      // Reduced radiator efficiency (e.g., micrometeorite damage, coating degradation)
      const effReduction = fault.parameters.efficiencyReduction ?? fault.severity * 0.3;
      radiatorEfficiency *= 1 - effReduction;
      radiatorEfficiency = Math.max(0.1, radiatorEfficiency); // minimum 10% efficiency
    }
  }

  return {
    heatMultiplier,
    radiatorEfficiency,
  };
}

/**
 * Apply compute overload faults.
 * Increases the compute load factor, which affects protocol processing
 * and jitter.
 *
 * @param baseLoadFactor - Nominal compute load factor (0-1).
 * @param activeFaults - Currently active faults.
 * @returns Modified compute load factor (can exceed 1.0 under fault).
 */
export function applyComputeFaults(
  baseLoadFactor: number,
  activeFaults: FaultEvent[],
): number {
  let loadFactor = baseLoadFactor;

  for (const fault of activeFaults) {
    if (fault.type === 'compute_overload') {
      // Multiply the load factor
      const multiplier = fault.parameters.loadMultiplier ?? 1 + fault.severity;
      loadFactor *= multiplier;
    }

    // Attitude glitches can also add compute overhead
    // (the ADCS corrector burns extra cycles)
    if (fault.type === 'attitude_glitch') {
      loadFactor += fault.severity * 0.2;
    }
  }

  // Clamp to [0, 2.0] — above 1.0 means overloaded
  return Math.max(0, Math.min(2.0, loadFactor));
}
