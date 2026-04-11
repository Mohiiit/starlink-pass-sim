import { DEFAULT_TLE, DEFAULT_GROUND_STATION, CHANNEL_BANDWIDTH_HZ, DOWNLINK_FREQ_HZ, ELEVATION_MASK_DEG } from '../lib/constants';
import type {
  SimulationConfig,
  SimulationResult,
  SimulationTick,
  PassWindow,
  CausalEvent,
  Anomaly,
  PacketRecord,
  ThermalState,
  PowerBusState,
  FaultEngineState,
} from './types';
import { parseTLE, generateDemoPass, findNextPass } from './orbit';
import { computeAntennaState } from './antenna';
import { computeRFChainState } from './rf-chain';
import { stepThermal, createInitialThermalState } from './thermal';
import { stepPower, createInitialPowerState } from './power';
import { computeLinkBudget } from './link-budget';
import { selectModCod, MODCOD_TABLE } from './modulation';
import { computeProtocolState } from './protocol';
import { getScenarioFaults, stepFaults, applyAntennaFaults, applyPAFaults, applyOscillatorFaults, applyPowerFaults, applyThermalFaults, applyComputeFaults } from './faults';

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
  const satrec = parseTLE(cfg.tle.line1, cfg.tle.line2);
  let passWindow: PassWindow;

  // Try to find a real pass via SGP4 propagation first
  const realPass = findNextPass(satrec.satrec, cfg.groundStation, new Date(), cfg.elevationMask_deg);
  if (realPass && realPass.maxElevation_deg >= 40 && realPass.geometry.length > 30) {
    // Validate the pass is actually near the ground station (stale TLEs can produce garbage)
    const midGeo = realPass.geometry[Math.floor(realPass.geometry.length / 2)];
    const latDiff = Math.abs(midGeo.subSatLat_deg - cfg.groundStation.lat);
    if (latDiff < 30) {
      passWindow = realPass;
    } else {
      passWindow = generateDemoPass(satrec.satrec, cfg.groundStation, 78, 480);
    }
  } else {
    passWindow = generateDemoPass(satrec.satrec, cfg.groundStation, 78, 480);
  }

  // Initialize subsystem state
  const scheduledFaults = cfg.faultScenario === 'custom'
    ? (cfg.customFaults ?? [])
    : getScenarioFaults(cfg.faultScenario);

  let thermalState = createInitialThermalState();
  let powerState = createInitialPowerState(45, cfg.initialBatterySoC, false);
  let faultState: FaultEngineState = {
    activeFaults: [],
    scheduledFaults,
    scenario: cfg.faultScenario,
    faultLog: [],
  };
  let currentModCodIndex = 1; // start with most robust

  // Accumulators
  const ticks: SimulationTick[] = [];
  const allPackets: PacketRecord[] = [];
  const eventLog: CausalEvent[] = [];
  const anomalies: Anomaly[] = [];

  let prevGoodput = 0;
  let prevSNR = 0;
  let consecutivePacketLosses = 0;

  // Run tick by tick
  for (let i = 0; i < passWindow.geometry.length; i++) {
    const geo = passWindow.geometry[i];
    const s = geo.secondIntoPass;

    // 1. Geometry is already computed

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

    // 3. Power bus (uses previous thermal state for solar heating estimate)
    const solarAngle = 45 + 10 * Math.sin((s / passWindow.durationSeconds) * Math.PI);
    const { solarReduction, capacityReduction } = applyPowerFaults(
      powerState.batterySoC_percent,
      powerState.solarPanelOutput_W,
      faultState.activeFaults,
    );
    const prevPADraw = i > 0 ? ticks[i - 1].rfChain.pa.dcPowerDraw_W : 8;
    const computeLoadFactor = applyComputeFaults(1.0, faultState.activeFaults);
    const computePower = 60 * computeLoadFactor;

    powerState = stepPower(
      { ...powerState, solarPanelOutput_W: powerState.solarPanelOutput_W * (1 - solarReduction) },
      prevPADraw,
      computePower,
      solarAngle,
      false, // not in eclipse for this demo
      1.0,
    );

    // Apply battery capacity reduction from faults
    if (capacityReduction > 0) {
      powerState.batterySoC_percent = Math.max(0,
        powerState.batterySoC_percent * (1 - capacityReduction));
    }

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
    const { heatMultiplier, radiatorEfficiency } = applyThermalFaults(thermalState, faultState.activeFaults);
    const solarLoad = 100 * Math.cos((solarAngle * Math.PI) / 180);

    thermalState = stepThermal(
      thermalState,
      paHeat * heatMultiplier,
      computePower * 0.3 * heatMultiplier, // 30% of compute power becomes heat
      solarLoad,
      1.0,
      radiatorEfficiency,
    );

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

    const rfChain = computeRFChainState(
      desiredBackoff + backoffMod,
      thermalState.paJunction_C,
      thermalState.oscillator_C,
      cfg.channelBandwidth_Hz,
      p1dbReduction,
      freqOffset,
      unlock,
    );

    // 7. Phased array
    const steeringAngle = Math.max(0, 90 - geo.elevation_deg);
    const activeElements = applyAntennaFaults(1200, faultState.activeFaults);
    const antenna = computeAntennaState(steeringAngle, activeElements, 1200, s);

    // 8. Link budget
    const linkBudget = computeLinkBudget(
      rfChain.txPower_dBm,
      antenna.effectiveGain_dBi,
      geo.slantRange_km,
      geo.elevation_deg,
      geo.rangeRate_km_s,
      rfChain.snrPenalty_dB,
      cfg.rainAttenuation_dB,
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

    // 10. Protocol stack
    const protocol = computeProtocolState(
      linkBudget.effectiveSNR_dB,
      modcod,
      geo.slantRange_km,
      computeLoadFactor,
      s,
      cfg.channelBandwidth_Hz,
    );

    // Fill in causalChain for each packet from current tick's hardware state
    for (const pkt of protocol.packetsThisSecond) {
      pkt.causalChain = {
        elevation_deg: geo.elevation_deg,
        scanAngle_deg: steeringAngle,
        antennaGain_dBi: antenna.effectiveGain_dBi,
        paBackoff_dB: rfChain.pa.backoff_dB,
        paTemp_C: thermalState.paJunction_C,
        txPower_dBm: rfChain.txPower_dBm,
        fspl_dB: linkBudget.fspl_dB,
        effectiveSNR_dB: linkBudget.effectiveSNR_dB,
      };
    }

    allPackets.push(...protocol.packetsThisSecond);

    // Goodput drop anomaly
    if (i > 5 && prevGoodput > 0 && (prevGoodput - protocol.goodput_Mbps) / prevGoodput > 0.2) {
      anomalies.push({
        id: `goodput-drop-${s}`,
        time_s: s,
        type: 'goodput_drop',
        severity: (prevGoodput - protocol.goodput_Mbps) / prevGoodput > 0.5 ? 'severe' : 'moderate',
        metric: 'goodput_Mbps',
        value: protocol.goodput_Mbps,
        previousValue: prevGoodput,
        description: `Goodput dropped ${((1 - protocol.goodput_Mbps / prevGoodput) * 100).toFixed(0)}%`,
      });
    }

    // Packet burst loss detection
    const droppedThisTick = protocol.packetsThisSecond.filter(p => p.dropped).length;
    if (droppedThisTick > 0) {
      consecutivePacketLosses++;
      if (consecutivePacketLosses >= 3) {
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
      }
    } else {
      consecutivePacketLosses = 0;
    }

    // Determine system health
    let systemHealth: 'nominal' | 'degraded' | 'critical' = 'nominal';
    if (linkBudget.margin_dB < 2 || thermalState.throttling !== 'none' || powerState.powerMode >= 1) {
      systemHealth = 'degraded';
    }
    if (linkBudget.margin_dB < 0 || thermalState.throttling === 'severe' || powerState.powerMode >= 3) {
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
  const totalDropped = allPackets.filter(p => p.dropped).length;

  const summary = {
    peakGoodput_Mbps: Math.max(...goodputs),
    avgGoodput_Mbps: goodputs.reduce((a, b) => a + b, 0) / goodputs.length,
    totalDataTransferred_MB: goodputs.reduce((a, b) => a + b, 0) / 8, // Mbps * seconds / 8 ≈ MB
    minMargin_dB: Math.min(...ticks.map(t => t.linkMargin_dB)),
    modcodChanges: anomalies.filter(a => a.type === 'modcod_change').length,
    faultsTriggered: anomalies.filter(a => a.type === 'fault_activation').length,
    packetsTotal: allPackets.length,
    packetsDropped: totalDropped,
    packetDropRate: allPackets.length > 0 ? totalDropped / allPackets.length : 0,
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
