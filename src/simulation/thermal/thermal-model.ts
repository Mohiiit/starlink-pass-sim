// 5-node lumped thermal model with Euler integration
// Nodes: PA Junction, Array Panel, Digital Board, Oscillator, Radiator

import type { ThermalState } from '../types';
import {
  STEFAN_BOLTZMANN,
  SPACE_TEMP_K,
  EARTH_TEMP_K,
  PA_THERMAL_THROTTLE_MILD_C,
  PA_THERMAL_THROTTLE_SEVERE_C,
} from '../../lib/constants';

// ---- Node indices (for internal arrays) ----
const PA = 0;
const ARRAY = 1;
const DIGITAL = 2;
const OSC = 3;
const RADIATOR = 4;
const NUM_NODES = 5;

// ---- Thermal masses (J/°C) ----
const THERMAL_MASS: number[] = [
  5,    // PA junction — small die
  200,  // Array panel — large aluminum structure
  50,   // Digital board
  10,   // Oscillator
  500,  // Radiator — large thermal mass
];

// ---- Initial temperatures (°C) ----
const INITIAL_TEMPS: number[] = [55, 40, 45, 42, 30];

// ---- Conductances between nodes (W/°C) ----
// Stored as [nodeA, nodeB, conductance]
const CONDUCTANCES: [number, number, number][] = [
  [PA, ARRAY, 2.0],
  [ARRAY, RADIATOR, 5.0],
  [DIGITAL, RADIATOR, 3.0],
  [OSC, DIGITAL, 1.5],
  [DIGITAL, ARRAY, 1.0],
];

// ---- Radiator parameters ----
const RADIATOR_EMISSIVITY = 0.85;
const RADIATOR_AREA_M2 = 2.0;
const SPACE_VIEW_FACTOR = 0.5;
const EARTH_VIEW_FACTOR = 0.5;

// ---- Baseline heat generation (W) ----
const BASELINE_DIGITAL_HEAT_W = 15;
const BASELINE_ARRAY_HEAT_W = 2;
const BASELINE_OSC_HEAT_W = 0.5;

// ---- Default solar loading (W) ----
const DEFAULT_SOLAR_RADIATOR_W = 100;
const DEFAULT_SOLAR_ARRAY_W = 50;

/**
 * Create initial thermal state with nominal temperatures.
 */
export function createInitialThermalState(): ThermalState {
  return {
    paJunction_C: INITIAL_TEMPS[PA],
    arrayPanel_C: INITIAL_TEMPS[ARRAY],
    digitalBoard_C: INITIAL_TEMPS[DIGITAL],
    oscillator_C: INITIAL_TEMPS[OSC],
    radiator_C: INITIAL_TEMPS[RADIATOR],
    solarLoading_W: DEFAULT_SOLAR_RADIATOR_W + DEFAULT_SOLAR_ARRAY_W,
    inEclipse: false,
    throttling: 'none',
  };
}

/**
 * Compute radiative heat rejection from a node to space + Earth.
 * Q_rad = ε * σ * A * (T^4 - T_env^4)
 * Environment is 50/50 split between space (3K) and Earth (255K).
 */
function computeRadiativeHeat(temp_C: number): number {
  const T_K = temp_C + 273.15;
  const qSpace =
    RADIATOR_EMISSIVITY *
    STEFAN_BOLTZMANN *
    RADIATOR_AREA_M2 *
    SPACE_VIEW_FACTOR *
    (Math.pow(T_K, 4) - Math.pow(SPACE_TEMP_K, 4));
  const qEarth =
    RADIATOR_EMISSIVITY *
    STEFAN_BOLTZMANN *
    RADIATOR_AREA_M2 *
    EARTH_VIEW_FACTOR *
    (Math.pow(T_K, 4) - Math.pow(EARTH_TEMP_K, 4));
  return qSpace + qEarth;
}

/**
 * Advance the thermal model by one time step using forward Euler integration.
 *
 * @param prevState     Previous thermal state
 * @param paHeat_W      PA heat dissipation (from PA model)
 * @param digitalHeat_W Digital board heat (baseline + compute load)
 * @param solarLoad_W   Total solar loading (0 if in eclipse)
 * @param dt_s          Time step in seconds (default 1)
 */
export function stepThermal(
  prevState: ThermalState,
  paHeat_W: number,
  digitalHeat_W: number,
  solarLoad_W: number,
  dt_s: number = 1,
  radiatorEfficiencyFactor: number = 1.0,
): ThermalState {
  // ---- Unpack current temps into array ----
  const T: number[] = [
    prevState.paJunction_C,
    prevState.arrayPanel_C,
    prevState.digitalBoard_C,
    prevState.oscillator_C,
    prevState.radiator_C,
  ];

  // ---- Heat generation per node (W) ----
  const Q_gen: number[] = [
    paHeat_W,
    BASELINE_ARRAY_HEAT_W,
    digitalHeat_W > 0 ? digitalHeat_W : BASELINE_DIGITAL_HEAT_W,
    BASELINE_OSC_HEAT_W,
    0, // radiator generates no heat
  ];

  // ---- Solar loading distribution ----
  // Solar load is split: primarily radiator and array
  const inEclipse = solarLoad_W <= 0;
  if (!inEclipse) {
    // Default split: ~67% to radiator, ~33% to array
    const radiatorSolar = solarLoad_W * (DEFAULT_SOLAR_RADIATOR_W / (DEFAULT_SOLAR_RADIATOR_W + DEFAULT_SOLAR_ARRAY_W));
    const arraySolar = solarLoad_W * (DEFAULT_SOLAR_ARRAY_W / (DEFAULT_SOLAR_RADIATOR_W + DEFAULT_SOLAR_ARRAY_W));
    Q_gen[RADIATOR] += radiatorSolar;
    Q_gen[ARRAY] += arraySolar;
  }

  // ---- Compute dT/dt for each node ----
  const dTdt: number[] = new Array(NUM_NODES).fill(0);

  // Heat generation contribution
  for (let i = 0; i < NUM_NODES; i++) {
    dTdt[i] += Q_gen[i];
  }

  // Conductive coupling between nodes
  for (const [a, b, G] of CONDUCTANCES) {
    const flow = G * (T[b] - T[a]); // positive flow means heat into node a
    dTdt[a] += flow;
    dTdt[b] -= flow;
  }

  // Radiative cooling — only the radiator radiates to space
  // radiatorEfficiencyFactor < 1.0 simulates degraded radiator (e.g. from faults)
  const Q_rad = computeRadiativeHeat(T[RADIATOR]) * radiatorEfficiencyFactor;
  dTdt[RADIATOR] -= Q_rad;

  // Divide by thermal mass to get temperature rate
  for (let i = 0; i < NUM_NODES; i++) {
    dTdt[i] /= THERMAL_MASS[i];
  }

  // ---- Euler integration ----
  const newT: number[] = new Array(NUM_NODES);
  for (let i = 0; i < NUM_NODES; i++) {
    newT[i] = T[i] + dTdt[i] * dt_s;
  }

  // ---- Throttling logic ----
  let throttling: ThermalState['throttling'] = 'none';
  if (newT[PA] > PA_THERMAL_THROTTLE_SEVERE_C) {
    throttling = 'severe';
  } else if (newT[PA] > PA_THERMAL_THROTTLE_MILD_C) {
    throttling = 'mild';
  }

  return {
    paJunction_C: newT[PA],
    arrayPanel_C: newT[ARRAY],
    digitalBoard_C: newT[DIGITAL],
    oscillator_C: newT[OSC],
    radiator_C: newT[RADIATOR],
    solarLoading_W: solarLoad_W,
    inEclipse,
    throttling,
  };
}
