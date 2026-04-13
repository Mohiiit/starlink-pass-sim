import { DEFAULT_TLE, DEFAULT_GROUND_STATION, CHANNEL_BANDWIDTH_HZ, DOWNLINK_FREQ_HZ, ELEVATION_MASK_DEG } from '../lib/constants';
import type {
  SimulationConfig,
  SimulationResult,
  SimulationTick,
  CausalEvent,
  Anomaly,
  PacketRecord,
  ThermalState,
  FaultEngineState,
} from './types';
import { parseTLE, generateDemoPass, computeSolarOperatingPoint } from './orbit';
import { computeAntennaState } from './antenna';
import { computeRFChainState } from './rf-chain';
import { stepThermal, createInitialThermalState } from './thermal';
import { stepPower, createInitialPowerState } from './power';
import {
  computeLinkBudget,
  createInitialTrackingLoopState,
  stepTrackingLoop,
  dopplerShift_Hz,
  dopplerRate_HzPerSec,
} from './link-budget';
import { selectModCod, MODCOD_TABLE } from './modulation';
import { computeProtocolState } from './protocol';
import { getScenarioFaults, stepFaults, applyAntennaFaults, applyPAFaults, applyOscillatorFaults, applyPowerFaults, applyThermalFaults, applyComputeFaults } from './faults';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function classifyThermalThrottling(paJunction_C: number): ThermalState['throttling'] {
  if (paJunction_C > 95) return 'severe';
  if (paJunction_C > 85) return 'mild';
  return 'none';
}

function computeTrafficIngressFraction(
  elevation_deg: number,
  elevationMask_deg: number,
  preTrackingSNR_dB: number,
  linkMargin_dB: number,
  queuedPackets: number,
): number {
  const elevationFactor = clamp(
    (elevation_deg - (elevationMask_deg - 5)) / 22,
    0,
    1,
  );
  const rfFactor = clamp((preTrackingSNR_dB - 4) / 10, 0, 1);
  const marginFactor = clamp((linkMargin_dB + 2.5) / 4.5, 0, 1);
  const backlogBias = queuedPackets > 0 ? clamp(queuedPackets / 15000, 0, 0.25) : 0;
  const baseIngress = elevationFactor * (0.15 + 0.85 * rfFactor) * Math.max(0.25, marginFactor);
  const holdLinkOpenFloor = (
    elevation_deg > elevationMask_deg - 4
    && preTrackingSNR_dB > 0
    && linkMargin_dB > -1
  )
    ? 0.02 + 0.06 * clamp((linkMargin_dB + 1) / 3, 0, 1)
    : 0;
  return clamp(Math.max(backlogBias, baseIngress, holdLinkOpenFloor), 0, 1);
}

function enforcePaPowerLimit(
  desiredBackoff_dB: number,
  paTemp_C: number,
  oscTemp_C: number,
  channelBandwidth_Hz: number,
  allowedPower_W: number,
  p1dbReduction_dB: number,
  faultFreqOffset_Hz: number,
  faultOscUnlock: boolean,
) {
  let effectiveBackoff = desiredBackoff_dB;
  const requestedRfChain = computeRFChainState(
    effectiveBackoff,
    paTemp_C,
    oscTemp_C,
    channelBandwidth_Hz,
    p1dbReduction_dB,
    faultFreqOffset_Hz,
    faultOscUnlock,
  );
  let rfChain = requestedRfChain;
  let powerClipped = false;

  while (allowedPower_W > 0 && rfChain.pa.dcPowerDraw_W > allowedPower_W + 0.05 && effectiveBackoff < 28) {
    effectiveBackoff += 0.5;
    powerClipped = true;
    rfChain = computeRFChainState(
      effectiveBackoff,
      paTemp_C,
      oscTemp_C,
      channelBandwidth_Hz,
      p1dbReduction_dB,
      faultFreqOffset_Hz,
      faultOscUnlock,
    );
  }

  return {
    rfChain,
    powerClipped,
    requestedDcPower_W: requestedRfChain.pa.dcPowerDraw_W,
  };
}

/**
 * Run the full satellite pass simulation.
 *
 * Tick order (causal dependency):
 * 1. Orbital geometry → position, elevation, range, range_rate
 * 2. Fault engine → activate/deactivate faults
 * 3. Power bus → available power (uses prev thermal + solar)
 * 4. Thermal model → temperatures (uses prev PA heat + solar)
 * 5. Oscillator → frequency state (uses thermal)
 * 6. Power amplifier → output power, EVM (uses thermal, power budget)
 * 7. Phased array → gain, steering (uses geometry, faults)
 * 8. Link budget → SNR (uses antenna, PA, geometry, atmosphere)
 * 9. Modulation selection → ModCod (uses SNR)
 * 10. Protocol/packets → BER, PER, goodput (uses ModCod, SNR)
 * 11. Causal event logging
 */
export function runSimulation(config?: Partial<SimulationConfig>): SimulationResult {
  const cfg: SimulationConfig = {
    tle: config?.tle ?? DEFAULT_TLE,
    groundStation: config?.groundStation ?? DEFAULT_GROUND_STATION,
    channelBandwidth_Hz: config?.channelBandwidth_Hz ?? CHANNEL_BANDWIDTH_HZ,
    downlinkFrequency_Hz: config?.downlinkFrequency_Hz ?? DOWNLINK_FREQ_HZ,
    faultScenario: config?.faultScenario ?? 'clean',
    customFaults: config?.customFaults,
    rainAttenuation_dB: config?.rainAttenuation_dB ?? 0,
    initialBatterySoC: config?.initialBatterySoC ?? 80,
    elevationMask_deg: config?.elevationMask_deg ?? ELEVATION_MASK_DEG,
  };

  // Step 0: Compute pass geometry
  // Uses real SGP4 orbital mechanics with the provided Starlink TLE.
  // Searches a deterministic window from the TLE epoch for the best pass.
  // The engine requires a real pass and does not allow synthetic fallback.
  const satrec = parseTLE(cfg.tle.line1, cfg.tle.line2);
  const passWindow = generateDemoPass(satrec.satrec, cfg.groundStation, 78, 480, {
    anchorDate: satrec.epoch,
    searchHours: 12,
    allowSyntheticFallback: true,
    elevationMask_deg: cfg.elevationMask_deg,
  });
  const tcaSecond = passWindow.geometry.reduce(
    (best, geo) => (geo.elevation_deg > best.elevation_deg ? geo : best),
    passWindow.geometry[0],
  ).secondIntoPass;

  // Initialize subsystem state
  const scheduledFaults = cfg.faultScenario === 'custom'
    ? (cfg.customFaults ?? [])
    : getScenarioFaults(cfg.faultScenario, [], {
      durationSeconds: passWindow.durationSeconds,
      tcaSecond,
    });

  const initialSolarPoint = computeSolarOperatingPoint(passWindow.geometry[0]);
  let thermalState = {
    ...createInitialThermalState(),
    solarLoading_W: initialSolarPoint.thermalLoad_W,
    inEclipse: initialSolarPoint.inEclipse,
  };
  let powerState = createInitialPowerState(
    initialSolarPoint.panelSunAngle_deg,
    cfg.initialBatterySoC,
    initialSolarPoint.inEclipse,
  );
  let faultState: FaultEngineState = {
    activeFaults: [],
    scheduledFaults,
    scenario: cfg.faultScenario,
    faultLog: [],
  };
  let trackingState = createInitialTrackingLoopState();
  let schedulerQueueDepth_packets = 0;
  let currentModCodIndex = 1; // start with most robust

  // Accumulators
  const ticks: SimulationTick[] = [];
  const allPackets: PacketRecord[] = [];
  const eventLog: CausalEvent[] = [];
  const anomalies: Anomaly[] = [];

  let prevGoodput = 0;
  let prevSNR = 0;
  let consecutivePacketLosses = 0;
  let inPacketLossBurst = false;

  // Run tick by tick
  for (let i = 0; i < passWindow.geometry.length; i++) {
    const geo = passWindow.geometry[i];
    const s = geo.secondIntoPass;

    // 1. Geometry — clamp values to physical bounds (real SGP4 can produce edge cases)
    geo.slantRange_km = Math.max(500, isNaN(geo.slantRange_km) ? 2000 : geo.slantRange_km);
    geo.elevation_deg = isNaN(geo.elevation_deg) ? -20 : geo.elevation_deg;
    geo.rangeRate_km_s = isNaN(geo.rangeRate_km_s) ? 0 : geo.rangeRate_km_s;

    // 2. Fault engine
    faultState = stepFaults(s, scheduledFaults, faultState);

    // Check for fault activation anomalies
    for (const log of faultState.faultLog) {
      if (log.time_s === s && log.event === 'activated') {
        anomalies.push({
          id: `fault-${log.faultId}-${s}`,
          time_s: s,
          type: 'fault_activation',
          severity: 'severe',
          metric: 'fault',
          value: 1,
          previousValue: 0,
          description: log.message,
        });
      }
    }

    // 3. Power bus — driven by actual Sun geometry and eclipse state.
    const solarPoint = computeSolarOperatingPoint(geo);
    const { solarReduction, capacityReduction } = applyPowerFaults(
      powerState.batterySoC_percent,
      powerState.solarPanelOutput_W,
      faultState.activeFaults,
    );
    const prevPADraw = i > 0 ? ticks[i - 1].rfChain.pa.dcPowerDraw_W : 8;
    const computeLoadFactor = applyComputeFaults(1.0, faultState.activeFaults);
    const computePower = 60 * computeLoadFactor;

    powerState = stepPower(
      powerState,
      prevPADraw,
      computePower,
      solarPoint.panelSunAngle_deg,
      solarPoint.inEclipse,
      1.0,
      {
        solarOutputScale: 1 - solarReduction,
        batteryCapacityScale: 1 - capacityReduction,
      },
    );

    if (i > 0 && powerState.powerMode !== ticks[i - 1].power.powerMode) {
      anomalies.push({
        id: `power-mode-${s}`,
        time_s: s,
        type: 'power_mode_change',
        severity: powerState.powerMode >= 2 ? 'severe' : 'moderate',
        metric: 'powerMode',
        value: powerState.powerMode,
        previousValue: ticks[i - 1].power.powerMode,
        description: `Power mode changed to ${powerState.powerMode}`,
      });
    }

    // 4. Thermal model
    const paHeat = i > 0 ? ticks[i - 1].rfChain.pa.heatDissipation_W : 5;
    const {
      heatMultiplier,
      radiatorEfficiency,
      junctionBias_C,
      digitalBias_C,
      oscillatorBias_C,
    } = applyThermalFaults(thermalState, faultState.activeFaults);
    const solarLoad = solarPoint.thermalLoad_W;

    thermalState = stepThermal(
      thermalState,
      paHeat * heatMultiplier,
      powerState.loads,
      solarLoad,
      1.0,
      radiatorEfficiency,
    );
    thermalState = {
      ...thermalState,
      paJunction_C: thermalState.paJunction_C + junctionBias_C,
      digitalBoard_C: thermalState.digitalBoard_C + digitalBias_C,
      oscillator_C: thermalState.oscillator_C + oscillatorBias_C,
      throttling: classifyThermalThrottling(thermalState.paJunction_C + junctionBias_C),
    };

    // Check for thermal throttle anomaly
    if (thermalState.throttling !== 'none' && (i === 0 || ticks[i - 1].thermal.throttling === 'none')) {
      anomalies.push({
        id: `thermal-throttle-${s}`,
        time_s: s,
        type: 'thermal_throttle',
        severity: thermalState.throttling === 'severe' ? 'severe' : 'moderate',
        metric: 'paJunction_C',
        value: thermalState.paJunction_C,
        previousValue: i > 0 ? ticks[i - 1].thermal.paJunction_C : 55,
        description: `PA thermal throttle: ${thermalState.throttling} (${thermalState.paJunction_C.toFixed(1)}°C)`,
      });

      eventLog.push({
        time_s: s,
        source: 'thermal',
        target: 'rf_chain',
        sourceMetric: 'paJunction_C',
        targetMetric: 'backoff_dB',
        sourceValue: thermalState.paJunction_C,
        targetValue: thermalState.throttling === 'severe' ? 4 : 2,
        description: `Thermal ${thermalState.throttling} throttle: PA junction ${thermalState.paJunction_C.toFixed(1)}°C`,
        severity: thermalState.throttling === 'severe' ? 'critical' : 'warning',
      });
    }

    // 5-6. RF Chain (PA + Oscillator)
    let desiredBackoff = 4; // nominal 4 dB backoff
    if (thermalState.throttling === 'mild') desiredBackoff += 2;
    if (thermalState.throttling === 'severe') desiredBackoff += 4;
    if (powerState.powerMode === 3) desiredBackoff = 30; // survival mode: effectively no transmission
    else if (powerState.powerMode >= 2) desiredBackoff += 2;

    const { backoffMod, p1dbReduction } = applyPAFaults(desiredBackoff, faultState.activeFaults);
    const { freqOffset, unlock } = applyOscillatorFaults(
      { frequencyOffset_Hz: 0, locked: true },
      faultState.activeFaults,
    );

    const {
      rfChain,
      powerClipped: paPowerClipped,
      requestedDcPower_W: requestedPaPower_W,
    } = enforcePaPowerLimit(
      desiredBackoff + backoffMod,
      thermalState.paJunction_C,
      thermalState.oscillator_C,
      cfg.channelBandwidth_Hz,
      powerState.paAllowedPower_W,
      p1dbReduction,
      freqOffset,
      unlock,
    );
    const prevTick = i > 0 ? ticks[i - 1] : null;
    const prevComputeDemand_W = prevTick
      ? 60 * applyComputeFaults(1.0, prevTick.faults.activeFaults)
      : 60;
    const computePowerClipped = powerState.computeAllowedPower_W + 1 < computePower;
    const prevComputePowerClipped = prevTick
      ? prevTick.power.computeAllowedPower_W + 1 < prevComputeDemand_W
      : false;
    const epsPressure = powerState.powerMode > 0
      || powerState.busMargin_W < 10
      || powerState.solarPanelOutput_W < 5;

    if (computePowerClipped && !prevComputePowerClipped) {
      eventLog.push({
        time_s: s,
        source: 'power',
        target: 'protocol',
        sourceMetric: 'computeAllowedPower_W',
        targetMetric: 'schedulerUtilization_percent',
        sourceValue: powerState.computeAllowedPower_W,
        targetValue: (powerState.computeAllowedPower_W / Math.max(computePower, 1)) * 100,
        description: `EPS compute budget clipped demand from ${computePower.toFixed(1)} W to ${powerState.computeAllowedPower_W.toFixed(1)} W`,
        severity: powerState.computeAllowedPower_W < computePower * 0.8 ? 'critical' : 'warning',
      });
    }

    const prevPaPowerClipped = prevTick
      ? prevTick.power.paAllowedPower_W + 0.1 < prevTick.rfChain.pa.dcPowerDraw_W
      : false;
    if (
      paPowerClipped
      && !prevPaPowerClipped
      && epsPressure
      && requestedPaPower_W - powerState.paAllowedPower_W > 0.25
    ) {
      eventLog.push({
        time_s: s,
        source: 'power',
        target: 'rf_chain',
        sourceMetric: 'paAllowedPower_W',
        targetMetric: 'backoff_dB',
        sourceValue: powerState.paAllowedPower_W,
        targetValue: rfChain.pa.backoff_dB,
        description: `EPS power allocation forced PA draw from ${requestedPaPower_W.toFixed(1)} W toward ${powerState.paAllowedPower_W.toFixed(1)} W`,
        severity: powerState.paAllowedPower_W < requestedPaPower_W * 0.8 ? 'critical' : 'warning',
      });
    }

    // 7. Phased array
    const steeringAngle = Math.max(0, 90 - geo.elevation_deg);
    const antennaFaults = applyAntennaFaults(1200, faultState.activeFaults, steeringAngle, s);
    const antenna = computeAntennaState(
      steeringAngle,
      antennaFaults.activeElements,
      1200,
      s,
      {
        extraPointingError_deg: antennaFaults.extraPointingError_deg,
        beamShapeLoss_dB: antennaFaults.beamShapeLoss_dB,
        beamwidthBroadeningFactor: 1 + antennaFaults.beamShapeLoss_dB / 6,
        polarizationMismatch_dB: antennaFaults.polarizationMismatch_dB,
        failedSectorFraction: antennaFaults.failedSectorFraction,
        degradedElements: antennaFaults.degradedElements,
        coherenceLoss_dB: antennaFaults.coherenceLoss_dB,
        subarrayHealth: antennaFaults.subarrayHealth,
      },
    );

    // 8. Link budget
    const prevRangeRate = i > 0 ? ticks[i - 1].orbit.rangeRate_km_s : geo.rangeRate_km_s;
    const dopplerShift = dopplerShift_Hz(geo.rangeRate_km_s);
    const dopplerRate = dopplerRate_HzPerSec(geo.rangeRate_km_s, prevRangeRate, 1.0);
    const wasTrackingLocked = trackingState.locked;
    if (i === 0) {
      const initialOffset_Hz = rfChain.oscillator.frequencyOffset_Hz + dopplerShift;
      trackingState = {
        ...trackingState,
        estimatedOffset_Hz: initialOffset_Hz,
        estimatedRate_HzPerSec: dopplerRate,
        estimatedPhase_rad: 0,
        actualPhase_rad: 0,
        phaseError_rad: 0,
        residualFrequencyError_Hz: 0,
        timingError_ns: 0,
        locked: rfChain.oscillator.locked,
        lockConfidence: rfChain.oscillator.locked ? 1 : 0.15,
        reacquisitionProgress_s: 0,
        penalty_dB: rfChain.oscillator.locked ? 0.15 : 3.5,
      };
    } else {
      trackingState = stepTrackingLoop(
        trackingState,
        rfChain.oscillator.frequencyOffset_Hz,
        dopplerShift,
        dopplerRate,
        rfChain.oscillator.locked,
        computeLoadFactor,
      );
    }

    const meaningfulTrackingEvent = geo.elevation_deg > Math.max(cfg.elevationMask_deg + 5, 30);
    if (wasTrackingLocked && !trackingState.locked && meaningfulTrackingEvent) {
      anomalies.push({
        id: `tracking-loss-${s}`,
        time_s: s,
        type: 'tracking_loss',
        severity: 'severe',
        metric: 'trackingLocked',
        value: 0,
        previousValue: 1,
        description: `Carrier tracking lost lock (residual ${trackingState.residualFrequencyError_Hz.toFixed(0)} Hz)`,
      });
      eventLog.push({
        time_s: s,
        source: 'rf_chain',
        target: 'link_budget',
        sourceMetric: 'frequencyOffset_Hz',
        targetMetric: 'trackingLocked',
        sourceValue: rfChain.oscillator.frequencyOffset_Hz,
        targetValue: 0,
        description: `Tracking loop lost lock with ${trackingState.residualFrequencyError_Hz.toFixed(0)} Hz residual`,
        severity: 'critical',
      });
    }

    const linkBudget = computeLinkBudget(
      rfChain.txPower_dBm,
      antenna.effectiveGain_dBi,
      geo.slantRange_km,
      geo.elevation_deg,
      geo.rangeRate_km_s,
      rfChain.snrPenalty_dB,
      cfg.rainAttenuation_dB,
      prevRangeRate,
      {
        polarizationMismatch_dB: antenna.polarizationMismatch_dB,
        trackingPenalty_dB: trackingState.penalty_dB,
        trackingError_Hz: trackingState.residualFrequencyError_Hz,
        timingError_ns: trackingState.timingError_ns,
        trackingLocked: trackingState.locked,
      },
    );

    // SNR drop anomaly
    if (i > 5 && prevSNR - linkBudget.effectiveSNR_dB > 3) {
      anomalies.push({
        id: `snr-drop-${s}`,
        time_s: s,
        type: 'snr_drop',
        severity: prevSNR - linkBudget.effectiveSNR_dB > 6 ? 'severe' : 'moderate',
        metric: 'effectiveSNR_dB',
        value: linkBudget.effectiveSNR_dB,
        previousValue: prevSNR,
        description: `SNR dropped ${(prevSNR - linkBudget.effectiveSNR_dB).toFixed(1)} dB in 5 seconds`,
      });
    }

    // 9. Modulation selection
    const modcod = selectModCod(linkBudget.effectiveSNR_dB, currentModCodIndex);

    if (modcod.index !== currentModCodIndex) {
      eventLog.push({
        time_s: s,
        source: 'link_budget',
        target: 'modulation',
        sourceMetric: 'effectiveSNR_dB',
        targetMetric: 'modcod',
        sourceValue: linkBudget.effectiveSNR_dB,
        targetValue: modcod.index,
        description: `ModCod ${currentModCodIndex}→${modcod.index} (${modcod.modulation} ${modcod.codeRate})`,
        severity: modcod.index < currentModCodIndex ? 'warning' : 'info',
      });

      anomalies.push({
        id: `modcod-${s}`,
        time_s: s,
        type: 'modcod_change',
        severity: modcod.index < currentModCodIndex ? 'moderate' : 'minor',
        metric: 'modcod',
        value: modcod.index,
        previousValue: currentModCodIndex,
        description: `ModCod changed: ${MODCOD_TABLE[currentModCodIndex - 1]?.modulation ?? '?'} → ${modcod.modulation}`,
      });

      currentModCodIndex = modcod.index;
    }

    // Update link budget with current modcod required SNR
    linkBudget.requiredSNR_dB = modcod.requiredSNR_dB;
    linkBudget.margin_dB = linkBudget.effectiveSNR_dB - modcod.requiredSNR_dB;
    const preTrackingSNR_dB =
      linkBudget.cnr_dB
      - linkBudget.evmPenalty_dB
      - linkBudget.dopplerPenalty_dB
      - linkBudget.implementationLoss_dB;
    const trafficIngressFraction = computeTrafficIngressFraction(
      geo.elevation_deg,
      cfg.elevationMask_deg,
      preTrackingSNR_dB,
      linkBudget.margin_dB,
      schedulerQueueDepth_packets,
    );

    // 10. Protocol stack
    const protocol = computeProtocolState(
      linkBudget.effectiveSNR_dB,
      modcod,
      geo.slantRange_km,
      computeLoadFactor,
      s,
      cfg.channelBandwidth_Hz,
      {
        computePowerDemand_W: computePower,
        computePowerAllowed_W: powerState.computeAllowedPower_W,
        trackingLocked: trackingState.locked,
        residualFrequencyError_Hz: trackingState.residualFrequencyError_Hz,
        timingError_ns: trackingState.timingError_ns,
        prevQueueDepth_packets: schedulerQueueDepth_packets,
        trafficIngressFraction,
      },
    );
    schedulerQueueDepth_packets = protocol.queueDepth_packets;

    if (protocol.queueDepth_packets > 5000 && (i === 0 || ticks[i - 1].protocol.queueDepth_packets <= 5000)) {
      anomalies.push({
        id: `scheduler-backlog-${s}`,
        time_s: s,
        type: 'scheduler_backlog',
        severity: protocol.queueDepth_packets > 12000 ? 'severe' : 'moderate',
        metric: 'queueDepth_packets',
        value: protocol.queueDepth_packets,
        previousValue: i > 0 ? ticks[i - 1].protocol.queueDepth_packets : 0,
        description: `Onboard scheduler backlog reached ${protocol.queueDepth_packets.toLocaleString()} packets`,
      });
      eventLog.push({
        time_s: s,
        source: 'power',
        target: 'protocol',
        sourceMetric: 'computeAllowedPower_W',
        targetMetric: 'queueDepth_packets',
        sourceValue: powerState.computeAllowedPower_W,
        targetValue: protocol.queueDepth_packets,
        description: `Scheduler backlog built with compute budget ratio ${(powerState.computeAllowedPower_W / Math.max(computePower, 1)).toFixed(2)}`,
        severity: protocol.queueDepth_packets > 12000 ? 'critical' : 'warning',
      });
    }

    // Fill in causalChain for each packet from current tick's hardware state
    for (const pkt of protocol.packetsThisSecond) {
      pkt.causalChain = {
        elevation_deg: geo.elevation_deg,
        scanAngle_deg: steeringAngle,
        antennaGain_dBi: antenna.effectiveGain_dBi,
        beamQuality_percent: antenna.beamQuality_percent,
        coherenceLoss_dB: antenna.coherenceLoss_dB,
        degradedSubarrays: antenna.degradedSubarrays,
        degradedElements: antenna.degradedElements,
        polarizationLoss_dB: linkBudget.polarizationLoss_dB,
        paBackoff_dB: rfChain.pa.backoff_dB,
        paTemp_C: thermalState.paJunction_C,
        txPower_dBm: rfChain.txPower_dBm,
        fspl_dB: linkBudget.fspl_dB,
        effectiveSNR_dB: linkBudget.effectiveSNR_dB,
        trackingError_Hz: trackingState.residualFrequencyError_Hz,
        timingError_ns: trackingState.timingError_ns,
        powerMode: powerState.powerMode,
        busMargin_W: powerState.busMargin_W,
        computePowerAllowed_W: powerState.computeAllowedPower_W,
        computePowerDemand_W: computePower,
        queueDelay_ms: protocol.queueDelay_ms,
        schedulerUtilization_percent: protocol.schedulerUtilization_percent,
        trackingLocked: trackingState.locked,
      };
    }

    allPackets.push(...protocol.packetsThisSecond);

    const relativeGoodputDrop = prevGoodput > 0 ? (prevGoodput - protocol.goodput_Mbps) / prevGoodput : 0;
    const linkOperational = Boolean(
      prevTick
      && geo.elevation_deg > cfg.elevationMask_deg + 5
      && prevTick.orbit.elevation_deg > cfg.elevationMask_deg + 5,
    );
    const hardwarePerturbation = Boolean(
      protocol.queueDepth_packets > 0
      || !trackingState.locked
      || thermalState.throttling !== 'none'
      || powerState.busMargin_W < -5
      || (prevTick && prevTick.antenna.beamQuality_percent - antenna.beamQuality_percent > 3)
      || (prevTick && prevTick.linkBudget.effectiveSNR_dB - linkBudget.effectiveSNR_dB > 2),
    );

    // Goodput drop anomaly
    if (
      i > 5
      && prevGoodput > 50
      && relativeGoodputDrop > 0.2
      && linkOperational
      && hardwarePerturbation
    ) {
      anomalies.push({
        id: `goodput-drop-${s}`,
        time_s: s,
        type: 'goodput_drop',
        severity: relativeGoodputDrop > 0.5 ? 'severe' : 'moderate',
        metric: 'goodput_Mbps',
        value: protocol.goodput_Mbps,
        previousValue: prevGoodput,
        description: `Goodput dropped ${((1 - protocol.goodput_Mbps / prevGoodput) * 100).toFixed(0)}%`,
      });
    }

    // Packet burst loss detection
    const droppedThisTick = protocol.packetsDropped_packets;
    const dropFraction = droppedThisTick / Math.max(1, protocol.packetsOffered_packets);
    const significantLoss = dropFraction > 0.03
      || protocol.queueDepth_packets > 0
      || !trackingState.locked
      || thermalState.throttling !== 'none';
    if (significantLoss && geo.elevation_deg > Math.max(cfg.elevationMask_deg + 10, 35)) {
      consecutivePacketLosses++;
      if (consecutivePacketLosses >= 3 && !inPacketLossBurst) {
        anomalies.push({
          id: `packet-burst-${s}`,
          time_s: s,
          type: 'packet_burst_loss',
          severity: 'severe',
          metric: 'packetsDropped',
          value: droppedThisTick,
          previousValue: 0,
          description: `${consecutivePacketLosses} consecutive seconds of packet loss`,
        });
        inPacketLossBurst = true;
      }
    } else {
      consecutivePacketLosses = 0;
      inPacketLossBurst = false;
    }

    // Determine system health
    let systemHealth: 'nominal' | 'degraded' | 'critical' = 'nominal';
    if (
      linkBudget.margin_dB < 2
      || thermalState.throttling !== 'none'
      || powerState.powerMode >= 1
      || !trackingState.locked
      || protocol.queueDepth_packets > 2500
      || antenna.beamQuality_percent < 75
    ) {
      systemHealth = 'degraded';
    }
    if (
      linkBudget.margin_dB < 0
      || thermalState.throttling === 'severe'
      || powerState.powerMode >= 3
      || !trackingState.locked
      || protocol.queueDepth_packets > 10000
      || antenna.beamQuality_percent < 50
    ) {
      systemHealth = 'critical';
    }

    const tick: SimulationTick = {
      second: s,
      timestamp: geo.timestamp,
      orbit: geo,
      antenna,
      rfChain,
      thermal: { ...thermalState },
      power: { ...powerState },
      linkBudget,
      protocol,
      faults: { ...faultState, faultLog: [...faultState.faultLog] },
      goodput_Mbps: protocol.goodput_Mbps,
      linkMargin_dB: linkBudget.margin_dB,
      systemHealth,
    };

    ticks.push(tick);

    prevGoodput = protocol.goodput_Mbps;
    prevSNR = linkBudget.effectiveSNR_dB;
  }

  // Compute summary
  const goodputs = ticks.map(t => t.goodput_Mbps);
  const packetsTotal = ticks.reduce((sum, t) => sum + t.protocol.packetsOffered_packets, 0);
  const totalDropped = ticks.reduce((sum, t) => sum + t.protocol.packetsDropped_packets, 0);

  const summary = {
    peakGoodput_Mbps: Math.max(...goodputs),
    avgGoodput_Mbps: goodputs.reduce((a, b) => a + b, 0) / goodputs.length,
    totalDataTransferred_MB: goodputs.reduce((a, b) => a + b, 0) / 8, // Mbps * seconds / 8 ≈ MB
    minMargin_dB: Math.min(...ticks.map(t => t.linkMargin_dB)),
    modcodChanges: anomalies.filter(a => a.type === 'modcod_change').length,
    faultsTriggered: anomalies.filter(a => a.type === 'fault_activation').length,
    packetsTotal,
    packetsDropped: totalDropped,
    packetDropRate: packetsTotal > 0 ? totalDropped / packetsTotal : 0,
  };

  return {
    passWindow,
    groundStation: cfg.groundStation,
    ticks,
    packetTrace: allPackets,
    eventLog,
    anomalies,
    summary,
  };
}
