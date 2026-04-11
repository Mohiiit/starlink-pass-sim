// ============================================================
// Fault Scheduler — Scenario definitions and fault lifecycle
// ============================================================
//
// Manages the lifecycle of fault events: scheduling, activation,
// and deactivation. Each fault scenario pre-defines a set of
// FaultEvents that trigger at specific times during the pass.
//
// Fault types map to specific subsystem degradations:
//   - element_failure: antenna elements go dark
//   - pa_degradation: PA gain/P1dB reduction
//   - pa_thermal_runaway: PA junction temperature spike
//   - oscillator_drift: increased frequency offset
//   - oscillator_unlock: PLL loses lock entirely
//   - solar_panel_damage: reduced solar output
//   - battery_degradation: reduced battery capacity
//   - compute_overload: increased compute load factor
//   - radiator_degradation: reduced thermal radiation
//   - attitude_glitch: temporary pointing error spike
// ============================================================

import type { FaultEvent, FaultScenario, FaultEngineState } from '../types';

/**
 * Generate a unique fault ID from type and trigger time.
 */
function faultId(type: string, triggerTime: number): string {
  return `${type}_t${triggerTime}`;
}

/**
 * Get the predefined fault events for a given scenario.
 *
 * @param scenario - The fault scenario name.
 * @param customFaults - Custom fault events (only used when scenario is 'custom').
 * @returns Array of FaultEvent objects, not yet activated.
 */
export function getScenarioFaults(
  scenario: FaultScenario,
  customFaults: FaultEvent[] = [],
): FaultEvent[] {
  switch (scenario) {
    case 'clean':
      return [];

    case 'degraded':
      return [
        {
          id: faultId('element_failure', 0),
          name: 'Antenna Element Failure (minor)',
          type: 'element_failure',
          triggerTime_s: 0,
          duration_s: -1, // permanent
          severity: 0.05,
          parameters: { failedFraction: 0.05 },
          active: false,
        },
        {
          id: faultId('pa_degradation', 0),
          name: 'PA Gain Degradation',
          type: 'pa_degradation',
          triggerTime_s: 0,
          duration_s: -1,
          severity: 0.3,
          parameters: { gainReduction_dB: 1.5, p1dBReduction_dB: 1.0 },
          active: false,
        },
        {
          id: faultId('battery_degradation', 0),
          name: 'Battery Capacity Degradation',
          type: 'battery_degradation',
          triggerTime_s: 0,
          duration_s: -1,
          severity: 0.3,
          parameters: { capacityReduction: 0.3, solarReduction: 0 },
          active: false,
        },
      ];

    case 'stressed':
      return [
        {
          id: faultId('element_failure', 0),
          name: 'Antenna Element Failure (moderate)',
          type: 'element_failure',
          triggerTime_s: 0,
          duration_s: -1,
          severity: 0.15,
          parameters: { failedFraction: 0.15 },
          active: false,
        },
        {
          id: faultId('compute_overload', 180),
          name: 'Compute Overload Spike',
          type: 'compute_overload',
          triggerTime_s: 180,
          duration_s: 120,
          severity: 0.5,
          parameters: { loadMultiplier: 1.5 },
          active: false,
        },
        {
          id: faultId('battery_degradation', 0),
          name: 'Battery Severe Degradation',
          type: 'battery_degradation',
          triggerTime_s: 0,
          duration_s: -1,
          severity: 0.5,
          parameters: { capacityReduction: 0.5, solarReduction: 0.1 },
          active: false,
        },
      ];

    case 'failing':
      return [
        {
          id: faultId('oscillator_unlock', 200),
          name: 'Oscillator PLL Unlock',
          type: 'oscillator_unlock',
          triggerTime_s: 200,
          duration_s: 15,
          severity: 1.0,
          parameters: { frequencySpike_Hz: 50000, phaseNoiseSpike_dB: 20 },
          active: false,
        },
        {
          id: faultId('element_failure', 0),
          name: 'Antenna Element Failure (severe)',
          type: 'element_failure',
          triggerTime_s: 0,
          duration_s: -1,
          severity: 0.25,
          parameters: { failedFraction: 0.25 },
          active: false,
        },
        {
          id: faultId('pa_thermal_runaway', 150),
          name: 'PA Thermal Runaway',
          type: 'pa_thermal_runaway',
          triggerTime_s: 150,
          duration_s: -1,
          severity: 0.6,
          parameters: { tempRise_C: 30, heatMultiplier: 2.0 },
          active: false,
        },
      ];

    case 'custom':
      return customFaults.map((f) => ({ ...f, active: false }));

    default:
      return [];
  }
}

/**
 * Create the initial fault engine state for a scenario.
 */
export function createInitialFaultState(
  scenario: FaultScenario,
  customFaults: FaultEvent[] = [],
): FaultEngineState {
  const scheduled = getScenarioFaults(scenario, customFaults);
  return {
    activeFaults: [],
    scheduledFaults: scheduled,
    scenario,
    faultLog: [],
  };
}

/**
 * Advance the fault engine by one tick.
 *
 * Activates faults whose trigger time has arrived and deactivates
 * faults whose duration has expired.
 *
 * @param currentSecond - Current simulation second.
 * @param scheduledFaults - All scheduled faults (active and inactive).
 * @param prevState - Previous fault engine state.
 * @returns Updated FaultEngineState.
 */
export function stepFaults(
  currentSecond: number,
  scheduledFaults: FaultEvent[],
  prevState: FaultEngineState,
): FaultEngineState {
  const newLog = [...prevState.faultLog];
  const updatedFaults = scheduledFaults.map((fault) => {
    const wasPreviouslyActive = prevState.activeFaults.some(
      (f) => f.id === fault.id,
    );

    // Check if fault should be active at this time
    const shouldBeActive =
      currentSecond >= fault.triggerTime_s &&
      (fault.duration_s === -1 ||
        currentSecond < fault.triggerTime_s + fault.duration_s);

    // Log activation
    if (shouldBeActive && !wasPreviouslyActive) {
      newLog.push({
        time_s: currentSecond,
        faultId: fault.id,
        event: 'activated',
        message: `Fault activated: ${fault.name} (severity=${fault.severity.toFixed(2)})`,
      });
    }

    // Log deactivation
    if (!shouldBeActive && wasPreviouslyActive) {
      newLog.push({
        time_s: currentSecond,
        faultId: fault.id,
        event: 'deactivated',
        message: `Fault deactivated: ${fault.name}`,
      });
    }

    return { ...fault, active: shouldBeActive };
  });

  const activeFaults = updatedFaults.filter((f) => f.active);

  return {
    activeFaults,
    scheduledFaults: updatedFaults,
    scenario: prevState.scenario,
    faultLog: newLog,
  };
}
