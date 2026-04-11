// ============================================================
// Power Bus — Solar panel, battery SoC, load management, power modes
// ============================================================
//
// Models the satellite's electrical power subsystem:
//   1. Solar panel output as a function of sun angle, eclipse, and degradation
//   2. Battery state-of-charge (SoC) model with charge/discharge dynamics
//   3. Load table for all subsystems
//   4. Power modes that curtail loads based on SoC thresholds
//
// The power mode directly constrains how much power the PA and compute
// subsystems can draw, creating a feedback path into RF and protocol layers.
// ============================================================

import type { PowerBusState } from '../types';
import { SOLAR_CONSTANT_W_M2 } from '../../lib/constants';

// ---- Solar panel parameters ----
const SOLAR_EFFICIENCY = 0.30; // GaAs triple-junction cell efficiency
const SOLAR_PANEL_AREA_M2 = 3; // ~3 m² (realistic for Starlink v1.5 single solar panel)
const SOLAR_DEGRADATION = 0.95; // BOL-to-current degradation factor

// ---- Battery parameters ----
const BATTERY_CAPACITY_WH = 2500; // Wh
const BATTERY_CAPACITY_J = BATTERY_CAPACITY_WH * 3600; // 9e6 J

// ---- Nominal load table (watts) ----
const LOAD_ARRAY_ELECTRONICS_W = 30;
const LOAD_DIGITAL_W = 60;
const LOAD_THERMAL_W = 15;
const LOAD_ATTITUDE_CONTROL_W = 25;
const LOAD_HOUSEKEEPING_W = 10;
const LOAD_ISL_W = 40;

// ---- Power mode thresholds (by SoC percent) ----
// Mode 0: SoC > 40%  — nominal
// Mode 1: 30% < SoC <= 40% — ISL reduced, digital reduced
// Mode 2: 20% < SoC <= 30% — PA backoff, non-essential off
// Mode 3: SoC <= 20% — minimum power, PA disallowed

// PA allowed power per mode
const PA_ALLOWED_POWER: Record<0 | 1 | 2 | 3, number> = {
  0: 15,
  1: 12,
  2: 8,
  3: 0,
};

// Compute allowed power per mode
const COMPUTE_ALLOWED_POWER: Record<0 | 1 | 2 | 3, number> = {
  0: 80,
  1: 50,
  2: 40,
  3: 10,
};

/**
 * Determine the power mode from battery state-of-charge.
 */
function determinePowerMode(soc_percent: number): 0 | 1 | 2 | 3 {
  if (soc_percent > 40) return 0;
  if (soc_percent > 30) return 1;
  if (soc_percent > 20) return 2;
  return 3;
}

/**
 * Compute solar panel output power.
 *
 * @param sunAngle_deg - Angle between the solar panel normal and the sun vector (degrees).
 *   0 = sun directly normal to panels, 90 = sun parallel to panels.
 * @param inEclipse - Whether the satellite is in Earth's shadow.
 * @returns Solar panel electrical output in watts.
 */
function computeSolarOutput(sunAngle_deg: number, inEclipse: boolean): number {
  if (inEclipse) return 0;

  const sunAngle_rad = (sunAngle_deg * Math.PI) / 180;
  const cosAngle = Math.max(0, Math.cos(sunAngle_rad));

  return (
    SOLAR_EFFICIENCY *
    SOLAR_PANEL_AREA_M2 *
    SOLAR_CONSTANT_W_M2 *
    cosAngle *
    SOLAR_DEGRADATION
  );
}

/**
 * Compute the load table for a given power mode, PA draw, and compute load.
 */
function computeLoads(
  powerMode: 0 | 1 | 2 | 3,
  paActualDraw_W: number,
  computeLoad_W: number,
): PowerBusState['loads'] {
  // PA draw is externally constrained, but also clamped by mode
  const paAllowed = PA_ALLOWED_POWER[powerMode];
  const pa_W = Math.min(paActualDraw_W, paAllowed);

  // Digital/compute load clamped by mode
  const computeAllowed = COMPUTE_ALLOWED_POWER[powerMode];
  const digital_W =
    powerMode === 0
      ? LOAD_DIGITAL_W
      : powerMode === 1
        ? 50
        : powerMode === 2
          ? 40
          : 20;

  // ISL reduced in power-save modes
  const isl_W =
    powerMode === 0
      ? LOAD_ISL_W
      : powerMode === 1
        ? 20
        : powerMode === 2
          ? 10
          : 0;

  // Thermal management always runs, but reduced in mode 3
  const thermal_W = powerMode === 3 ? 8 : LOAD_THERMAL_W;

  // Attitude control always runs, reduced in mode 3
  const attitudeControl_W = powerMode === 3 ? 15 : LOAD_ATTITUDE_CONTROL_W;

  // Housekeeping is always on
  const housekeeping_W = LOAD_HOUSEKEEPING_W;

  // Array electronics always on but reduced in mode 3
  const arrayElectronics_W = powerMode === 3 ? 15 : LOAD_ARRAY_ELECTRONICS_W;

  return {
    pa_W,
    arrayElectronics_W,
    digital_W: Math.min(digital_W, computeAllowed),
    thermal_W,
    attitudeControl_W,
    housekeeping_W,
    isl_W,
  };
}

/**
 * Sum all load entries.
 */
function totalLoad(loads: PowerBusState['loads']): number {
  return (
    loads.pa_W +
    loads.arrayElectronics_W +
    loads.digital_W +
    loads.thermal_W +
    loads.attitudeControl_W +
    loads.housekeeping_W +
    loads.isl_W
  );
}

/**
 * Create the initial power bus state for the first simulation tick.
 *
 * @param solarAngle_deg - Sun angle at simulation start (degrees).
 * @param initialSoC - Initial battery state-of-charge (0-100 percent).
 * @param inEclipse - Whether the satellite starts in eclipse.
 */
export function createInitialPowerState(
  solarAngle_deg: number,
  initialSoC: number,
  inEclipse: boolean,
): PowerBusState {
  const soc = Math.max(0, Math.min(100, initialSoC));
  const powerMode = determinePowerMode(soc);
  const solarOutput = computeSolarOutput(solarAngle_deg, inEclipse);

  // At initialization, assume nominal PA draw (~10W) and nominal compute
  const loads = computeLoads(powerMode, 10, LOAD_DIGITAL_W);
  const totalDemand = totalLoad(loads);

  // Determine charge/discharge
  const surplus = solarOutput - totalDemand;
  const batteryChargePower_W = surplus; // positive = charging, negative = discharging

  return {
    solarPanelOutput_W: solarOutput,
    batteryChargePower_W,
    batterySoC_percent: soc,
    totalLoadDemand_W: totalDemand,
    totalLoadActual_W: totalDemand,
    powerMode,
    paAllowedPower_W: PA_ALLOWED_POWER[powerMode],
    computeAllowedPower_W: COMPUTE_ALLOWED_POWER[powerMode],
    sunAngle_deg: solarAngle_deg,
    inEclipse,
    loads,
  };
}

/**
 * Advance the power bus by one time step.
 *
 * @param prevState - Previous power bus state.
 * @param paActualDraw_W - Actual PA DC power draw this tick (from RF chain).
 * @param computeLoad_W - Actual compute/digital power draw this tick.
 * @param solarAngle_deg - Current sun angle (degrees).
 * @param inEclipse - Whether the satellite is currently in eclipse.
 * @param dt_s - Time step in seconds.
 * @returns Updated PowerBusState.
 */
export function stepPower(
  prevState: PowerBusState,
  paActualDraw_W: number,
  computeLoad_W: number,
  solarAngle_deg: number,
  inEclipse: boolean,
  dt_s: number,
): PowerBusState {
  // ---- Solar output ----
  const solarOutput = computeSolarOutput(solarAngle_deg, inEclipse);

  // ---- Power mode from previous SoC ----
  const powerMode = determinePowerMode(prevState.batterySoC_percent);

  // ---- Compute loads for this mode ----
  const loads = computeLoads(powerMode, paActualDraw_W, computeLoad_W);
  const totalDemand = totalLoad(loads);

  // ---- Battery charge/discharge dynamics ----
  // Surplus power goes to battery (charge). Deficit comes from battery (discharge).
  const surplus_W = solarOutput - totalDemand;

  // Charge power: positive = charging, negative = discharging
  // Apply charge efficiency (90% when charging, 95% discharge efficiency)
  const chargeEfficiency = surplus_W > 0 ? 0.90 : 0.95;
  const effectiveChargePower_W = surplus_W > 0
    ? surplus_W * chargeEfficiency
    : surplus_W / chargeEfficiency; // discharging loses more

  // Update SoC: SoC(t+1) = SoC(t) + P_charge * dt / E_capacity (in percent)
  const deltaEnergy_J = effectiveChargePower_W * dt_s;
  const deltaSoC_percent = (deltaEnergy_J / BATTERY_CAPACITY_J) * 100;
  const newSoC = Math.max(0, Math.min(100, prevState.batterySoC_percent + deltaSoC_percent));

  // ---- Actual load may differ from demand if battery is empty ----
  let totalLoadActual = totalDemand;
  if (newSoC <= 0 && surplus_W < 0) {
    // Battery depleted, can only draw what solar provides
    totalLoadActual = solarOutput;
  }

  return {
    solarPanelOutput_W: solarOutput,
    batteryChargePower_W: surplus_W,
    batterySoC_percent: newSoC,
    totalLoadDemand_W: totalDemand,
    totalLoadActual_W: totalLoadActual,
    powerMode,
    paAllowedPower_W: PA_ALLOWED_POWER[powerMode],
    computeAllowedPower_W: COMPUTE_ALLOWED_POWER[powerMode],
    sunAngle_deg: solarAngle_deg,
    inEclipse,
    loads,
  };
}
