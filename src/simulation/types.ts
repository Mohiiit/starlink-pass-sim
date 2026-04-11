// ============================================================
// Core simulation types — shared across all subsystems
// ============================================================

// ---- Orbital / Pass Geometry ----

export interface GroundStationConfig {
  name: string;
  lat: number; // degrees
  lon: number; // degrees
  alt: number; // km above sea level
}

export interface PassGeometry {
  timestamp: Date;
  secondIntoPass: number;
  elevation_deg: number; // 0–90
  azimuth_deg: number; // 0–360
  slantRange_km: number; // satellite-to-ground distance
  rangeRate_km_s: number; // negative = approaching, positive = receding
  altitude_km: number;
  subSatLat_deg: number;
  subSatLon_deg: number;
}

export interface PassWindow {
  aos: Date; // Acquisition of Signal
  tca: Date; // Time of Closest Approach
  los: Date; // Loss of Signal
  maxElevation_deg: number;
  durationSeconds: number;
  geometry: PassGeometry[]; // one entry per second
}

// ---- Phased Array Antenna ----

export interface AntennaState {
  steeringAngle_deg: number;
  elementGain_dBi: number;
  arrayGain_dBi: number;
  scanLoss_dB: number;
  effectiveGain_dBi: number;
  beamwidth_deg: number;
  pointingError_deg: number;
  pointingLoss_dB: number;
  activeElements: number;
  totalElements: number;
}

// ---- RF Chain ----

export interface PowerAmplifierState {
  inputPower_dBm: number;
  outputPower_dBm: number;
  gain_dB: number;
  backoff_dB: number;
  compressionLevel_dB: number;
  efficiency_percent: number;
  dcPowerDraw_W: number;
  heatDissipation_W: number;
  evmContribution_percent: number;
  ampmDistortion_deg: number;
  junctionTemperature_C: number;
  p1dB_derated_dBm: number;
}

export interface OscillatorState {
  nominalFrequency_Hz: number;
  frequencyOffset_Hz: number;
  phaseNoiseMask_dBcHz: number[]; // at [1kHz, 10kHz, 100kHz, 1MHz]
  evmContribution_percent: number;
  temperature_C: number;
  locked: boolean;
}

export interface RFChainState {
  pa: PowerAmplifierState;
  oscillator: OscillatorState;
  totalEVM_percent: number;
  snrPenalty_dB: number;
  txPower_dBm: number;
}

// ---- Thermal ----

export interface ThermalState {
  paJunction_C: number;
  arrayPanel_C: number;
  digitalBoard_C: number;
  oscillator_C: number;
  radiator_C: number;
  solarLoading_W: number;
  inEclipse: boolean;
  throttling: 'none' | 'mild' | 'severe';
}

// ---- Power Bus ----

export interface PowerBusState {
  solarPanelOutput_W: number;
  batteryChargePower_W: number;
  batterySoC_percent: number;
  totalLoadDemand_W: number;
  totalLoadActual_W: number;
  powerMode: 0 | 1 | 2 | 3;
  paAllowedPower_W: number;
  computeAllowedPower_W: number;
  sunAngle_deg: number;
  inEclipse: boolean;
  loads: {
    pa_W: number;
    arrayElectronics_W: number;
    digital_W: number;
    thermal_W: number;
    attitudeControl_W: number;
    housekeeping_W: number;
    isl_W: number;
  };
}

// ---- Link Budget ----

export interface LinkBudgetState {
  txPower_dBW: number;
  antennaGain_dBi: number;
  feedLoss_dB: number;
  eirp_dBW: number;
  slantRange_km: number;
  fspl_dB: number;
  atmosphericLoss_dB: number;
  rainLoss_dB: number;
  rxAntennaGain_dBi: number;
  systemNoiseTemp_K: number;
  gOverT_dBK: number;
  noiseBandwidth_Hz: number;
  carrierPower_dBW: number;
  noisePower_dBW: number;
  cnr_dB: number;
  evmPenalty_dB: number;
  dopplerPenalty_dB: number;
  implementationLoss_dB: number;
  effectiveSNR_dB: number;
  dopplerShift_Hz: number;
  dopplerRate_HzPerSec: number;
  requiredSNR_dB: number;
  margin_dB: number;
}

// ---- Modulation / Protocol ----

export interface ModCodEntry {
  index: number;
  modulation: string;
  codeRate: string;
  requiredSNR_dB: number;
  spectralEfficiency: number;
}

export interface PacketRecord {
  id: number;
  timestamp_ms: number;
  secondIntoPass: number;
  size_bytes: number;
  modulation: string;
  snr_dB: number;
  ber: number;
  corrupted: boolean;
  retransmission: boolean;
  retransmitCount: number;
  dropped: boolean;
  latency_ms: number;
  jitter_ms: number;
  causalChain: {
    elevation_deg: number;
    scanAngle_deg: number;
    antennaGain_dBi: number;
    paBackoff_dB: number;
    paTemp_C: number;
    txPower_dBm: number;
    fspl_dB: number;
    effectiveSNR_dB: number;
  };
}

export interface ProtocolState {
  currentModCod: number;
  modulationName: string;
  codeRate: string;
  spectralEfficiency: number;
  rawDataRate_Mbps: number;
  usefulDataRate_Mbps: number;
  ber: number;
  packetErrorRate: number;
  retransmissionRate: number;
  goodput_Mbps: number;
  avgLatency_ms: number;
  jitter_ms: number;
  packetsThisSecond: PacketRecord[];
}

// ---- Faults ----

export type FaultType =
  | 'element_failure'
  | 'pa_degradation'
  | 'pa_thermal_runaway'
  | 'oscillator_drift'
  | 'oscillator_unlock'
  | 'solar_panel_damage'
  | 'battery_degradation'
  | 'compute_overload'
  | 'radiator_degradation'
  | 'attitude_glitch';

export type FaultScenario = 'clean' | 'degraded' | 'stressed' | 'failing' | 'custom';

export interface FaultEvent {
  id: string;
  name: string;
  type: FaultType;
  triggerTime_s: number;
  duration_s: number; // -1 = permanent
  severity: number; // 0–1
  parameters: Record<string, number>;
  active: boolean;
}

export interface FaultEngineState {
  activeFaults: FaultEvent[];
  scheduledFaults: FaultEvent[];
  scenario: FaultScenario;
  faultLog: Array<{
    time_s: number;
    faultId: string;
    event: 'activated' | 'deactivated' | 'escalated';
    message: string;
  }>;
}

// ---- Causality ----

export type SubsystemName =
  | 'orbit'
  | 'antenna'
  | 'rf_chain'
  | 'thermal'
  | 'power'
  | 'link_budget'
  | 'modulation'
  | 'protocol'
  | 'faults';

export interface CausalEvent {
  time_s: number;
  source: SubsystemName;
  target: SubsystemName;
  sourceMetric: string;
  targetMetric: string;
  sourceValue: number;
  targetValue: number;
  description: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface Anomaly {
  id: string;
  time_s: number;
  type:
    | 'goodput_drop'
    | 'snr_drop'
    | 'modcod_change'
    | 'packet_burst_loss'
    | 'thermal_throttle'
    | 'power_mode_change'
    | 'fault_activation';
  severity: 'minor' | 'moderate' | 'severe';
  metric: string;
  value: number;
  previousValue: number;
  description: string;
}

export interface CausalChainNode {
  subsystem: SubsystemName;
  metric: string;
  value: number;
  unit: string;
  isRootCause: boolean;
  description: string;
  children: CausalChainNode[];
}

// ---- Simulation Tick ----

export interface SimulationTick {
  second: number;
  timestamp: Date;
  orbit: PassGeometry;
  antenna: AntennaState;
  rfChain: RFChainState;
  thermal: ThermalState;
  power: PowerBusState;
  linkBudget: LinkBudgetState;
  protocol: ProtocolState;
  faults: FaultEngineState;
  goodput_Mbps: number;
  linkMargin_dB: number;
  systemHealth: 'nominal' | 'degraded' | 'critical';
}

export interface SimulationResult {
  passWindow: PassWindow;
  groundStation: GroundStationConfig;
  ticks: SimulationTick[];
  packetTrace: PacketRecord[];
  eventLog: CausalEvent[];
  anomalies: Anomaly[];
  summary: {
    peakGoodput_Mbps: number;
    avgGoodput_Mbps: number;
    totalDataTransferred_MB: number;
    minMargin_dB: number;
    modcodChanges: number;
    faultsTriggered: number;
    packetsTotal: number;
    packetsDropped: number;
    packetDropRate: number;
  };
}

export interface SimulationConfig {
  tle: { line1: string; line2: string };
  groundStation: GroundStationConfig;
  channelBandwidth_Hz: number;
  downlinkFrequency_Hz: number;
  faultScenario: FaultScenario;
  customFaults?: FaultEvent[];
  rainAttenuation_dB: number;
  initialBatterySoC: number;
  elevationMask_deg: number;
}
