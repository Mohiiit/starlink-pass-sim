'use client';

import { useMemo, useState } from 'react';
import type { SimulationTick, Anomaly, CausalEvent } from '../../simulation/types';
import { fmt, fmtTime } from '../../lib/utils';

interface Props {
  tick: SimulationTick;
  allTicks: SimulationTick[];
  anomalies: Anomaly[];
  eventLog: CausalEvent[];
  currentSecond: number;
  onJumpToSecond: (s: number) => void;
}

interface CausalChainNode {
  label: string;
  value: string;
  subsystem: string;
  isRoot: boolean;
  children: CausalChainNode[];
}

function buildCausalChain(tick: SimulationTick, anomaly: Anomaly): CausalChainNode {
  const root: CausalChainNode = {
    label: anomaly.description,
    value: `${anomaly.metric}: ${typeof anomaly.value === 'number' ? fmt(anomaly.value) : anomaly.value}`,
    subsystem: anomaly.type,
    isRoot: false,
    children: [],
  };

  if (anomaly.type === 'goodput_drop' || anomaly.type === 'modcod_change') {
    const snrNode: CausalChainNode = {
      label: `SNR: ${fmt(tick.linkBudget.effectiveSNR_dB)} dB`,
      value: `Margin: ${fmt(tick.linkBudget.margin_dB)} dB`,
      subsystem: 'link_budget',
      isRoot: false,
      children: [],
    };

    // EIRP branch
    const eirpNode: CausalChainNode = {
      label: `EIRP: ${fmt(tick.linkBudget.eirp_dBW)} dBW`,
      value: '',
      subsystem: 'link_budget',
      isRoot: false,
      children: [],
    };

    // PA branch
    const paNode: CausalChainNode = {
      label: `PA Output: ${fmt(tick.rfChain.pa.outputPower_dBm)} dBm`,
      value: `Backoff: ${fmt(tick.rfChain.pa.backoff_dB)} dB`,
      subsystem: 'rf_chain',
      isRoot: false,
      children: [],
    };

    if (tick.thermal.throttling !== 'none') {
      paNode.children.push({
        label: `Thermal Throttle: ${tick.thermal.throttling}`,
        value: `PA Junction: ${fmt(tick.thermal.paJunction_C)} C`,
        subsystem: 'thermal',
        isRoot: true,
        children: [],
      });
    }

    if (tick.power.powerMode >= 2) {
      paNode.children.push({
        label: `Power Limited: Mode ${tick.power.powerMode}`,
        value: `Battery: ${fmt(tick.power.batterySoC_percent)}%`,
        subsystem: 'power',
        isRoot: true,
        children: [],
      });
    }

    if (paNode.children.length === 0 && tick.rfChain.pa.backoff_dB > 5) {
      paNode.isRoot = true;
      paNode.value += ' (high backoff)';
    }

    eirpNode.children.push(paNode);

    // Antenna branch
    const antNode: CausalChainNode = {
      label: `Antenna Gain: ${fmt(tick.antenna.effectiveGain_dBi)} dBi`,
      value: `Scan Loss: ${fmt(Math.abs(tick.antenna.scanLoss_dB))} dB`,
      subsystem: 'antenna',
      isRoot: false,
      children: [],
    };

    if (tick.antenna.steeringAngle_deg > 50) {
      antNode.children.push({
        label: `High Scan Angle: ${fmt(tick.antenna.steeringAngle_deg)} deg`,
        value: `Elevation: ${fmt(tick.orbit.elevation_deg)} deg`,
        subsystem: 'orbit',
        isRoot: true,
        children: [],
      });
    }

    if (tick.antenna.activeElements < tick.antenna.totalElements * 0.95) {
      antNode.children.push({
        label: `Element Failures: ${tick.antenna.totalElements - tick.antenna.activeElements} elements`,
        value: `${tick.antenna.activeElements}/${tick.antenna.totalElements} active`,
        subsystem: 'faults',
        isRoot: true,
        children: [],
      });
    }

    if (antNode.children.length === 0) {
      antNode.isRoot = true;
    }

    eirpNode.children.push(antNode);
    snrNode.children.push(eirpNode);

    // FSPL branch
    const fsplNode: CausalChainNode = {
      label: `FSPL: ${fmt(tick.linkBudget.fspl_dB)} dB`,
      value: `Range: ${fmt(tick.orbit.slantRange_km)} km`,
      subsystem: 'link_budget',
      isRoot: true,
      children: [],
    };
    snrNode.children.push(fsplNode);

    // EVM branch
    if (tick.rfChain.snrPenalty_dB > 0.5) {
      const evmNode: CausalChainNode = {
        label: `EVM Penalty: ${fmt(tick.rfChain.snrPenalty_dB)} dB`,
        value: `Total EVM: ${fmt(tick.rfChain.totalEVM_percent)}%`,
        subsystem: 'rf_chain',
        isRoot: false,
        children: [],
      };

      if (tick.rfChain.pa.evmContribution_percent > 3) {
        evmNode.children.push({
          label: `PA Distortion: EVM ${fmt(tick.rfChain.pa.evmContribution_percent)}%`,
          value: `Near compression`,
          subsystem: 'rf_chain',
          isRoot: true,
          children: [],
        });
      }

      if (!tick.rfChain.oscillator.locked) {
        evmNode.children.push({
          label: 'Oscillator UNLOCKED',
          value: `Phase noise spike`,
          subsystem: 'rf_chain',
          isRoot: true,
          children: [],
        });
      }

      snrNode.children.push(evmNode);
    }

    root.children.push(snrNode);
  } else if (anomaly.type === 'thermal_throttle') {
    root.children.push({
      label: `PA Junction: ${fmt(tick.thermal.paJunction_C)} C`,
      value: `Threshold: 85 C`,
      subsystem: 'thermal',
      isRoot: false,
      children: [{
        label: `PA Heat: ${fmt(tick.rfChain.pa.heatDissipation_W)} W`,
        value: `Efficiency: ${fmt(tick.rfChain.pa.efficiency_percent)}%`,
        subsystem: 'rf_chain',
        isRoot: true,
        children: [],
      }],
    });
  } else if (anomaly.type === 'snr_drop') {
    root.children.push({
      label: `SNR dropped to ${fmt(tick.linkBudget.effectiveSNR_dB)} dB`,
      value: `From ${fmt(anomaly.previousValue)} dB`,
      subsystem: 'link_budget',
      isRoot: true,
      children: [],
    });
  }

  return root;
}

function TreeNode({ node, depth = 0 }: { node: CausalChainNode; depth?: number }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const subsystemColors: Record<string, string> = {
    orbit: 'border-blue-500',
    antenna: 'border-green-500',
    rf_chain: 'border-amber-500',
    thermal: 'border-red-500',
    power: 'border-purple-500',
    link_budget: 'border-cyan-500',
    faults: 'border-red-700',
  };

  return (
    <div className={`ml-${Math.min(depth * 4, 16)}`} style={{ marginLeft: depth * 16 }}>
      <div
        className={`flex items-start gap-2 py-1 px-2 rounded text-sm cursor-pointer hover:bg-slate-800/50 border-l-2 ${
          subsystemColors[node.subsystem] ?? 'border-slate-600'
        } ${node.isRoot ? 'bg-red-900/20' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        {hasChildren && (
          <span className="text-slate-500 text-xs mt-0.5">{expanded ? 'v' : '>'}</span>
        )}
        <div>
          <div className={node.isRoot ? 'text-red-300 font-bold' : 'text-slate-200'}>
            {node.label}
          </div>
          {node.value && <div className="text-xs text-slate-500">{node.value}</div>}
        </div>
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children.map((child, i) => (
            <TreeNode key={i} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function RootCauseSummary({ tick }: { tick: SimulationTick }) {
  const causes: string[] = [];

  if (tick.thermal.throttling !== 'none') {
    causes.push(`PA thermal throttling (${fmt(tick.thermal.paJunction_C)} C)`);
  }
  if (tick.antenna.steeringAngle_deg > 55) {
    causes.push(`high scan angle (${fmt(tick.antenna.steeringAngle_deg)} deg)`);
  }
  if (tick.power.powerMode >= 2) {
    causes.push(`power conservation mode ${tick.power.powerMode}`);
  }
  if (!tick.rfChain.oscillator.locked) {
    causes.push('oscillator unlocked');
  }
  if (tick.antenna.activeElements < tick.antenna.totalElements * 0.9) {
    const failed = tick.antenna.totalElements - tick.antenna.activeElements;
    causes.push(`${failed} array elements failed`);
  }
  if (tick.linkBudget.rainLoss_dB > 1) {
    causes.push(`rain fade (${fmt(tick.linkBudget.rainLoss_dB)} dB)`);
  }

  if (causes.length === 0) {
    if (tick.linkBudget.margin_dB < 3) {
      causes.push(`low elevation geometry (${fmt(tick.orbit.elevation_deg)} deg)`);
    } else {
      causes.push('nominal operation');
    }
  }

  return (
    <div className="panel text-sm" data-testid="causality-root-cause">
      <span className="text-slate-400">Root cause: </span>
      <span className="text-cyan-300">{causes.join(' + ')}</span>
    </div>
  );
}

export function CausalityView({ tick, allTicks, anomalies, eventLog, currentSecond, onJumpToSecond }: Props) {
  const [selectedAnomaly, setSelectedAnomaly] = useState<Anomaly | null>(null);

  const nearbyAnomalies = useMemo(() =>
    anomalies.filter(a => Math.abs(a.time_s - currentSecond) <= 30)
      .sort((a, b) => Math.abs(a.time_s - currentSecond) - Math.abs(b.time_s - currentSecond)),
  [anomalies, currentSecond]);

  const nearbyEvents = useMemo(() =>
    eventLog.filter(e => Math.abs(e.time_s - currentSecond) <= 10)
      .sort((a, b) => a.time_s - b.time_s),
  [eventLog, currentSecond]);

  const chain = useMemo(() => {
    if (selectedAnomaly) {
      const anomalyTick = allTicks[selectedAnomaly.time_s] ?? tick;
      return buildCausalChain(anomalyTick, selectedAnomaly);
    }
    return null;
  }, [selectedAnomaly, allTicks, tick]);

  return (
    <div className="space-y-3">
      <RootCauseSummary tick={tick} />

      <div className="grid grid-cols-2 gap-3">
        {/* Anomaly list */}
        <div className="panel">
          <h3 className="text-xs text-cyan-400 uppercase tracking-wider mb-2">Anomalies (near T+{currentSecond}s)</h3>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {nearbyAnomalies.map((a) => (
              <div
                key={a.id}
                data-testid={`anomaly-item-${a.id}`}
                className={`text-xs p-2 rounded cursor-pointer transition-colors ${
                  selectedAnomaly?.id === a.id ? 'bg-cyan-900/30 border border-cyan-700' : 'bg-slate-800/50 hover:bg-slate-800'
                }`}
                onClick={() => {
                  setSelectedAnomaly(a);
                  onJumpToSecond(a.time_s);
                }}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${
                    a.severity === 'severe' ? 'bg-red-500' :
                    a.severity === 'moderate' ? 'bg-yellow-500' : 'bg-blue-500'
                  }`} />
                  <span className="text-slate-400">T+{a.time_s}s</span>
                  <span className="text-slate-200">{a.description}</span>
                </div>
              </div>
            ))}
            {nearbyAnomalies.length === 0 && (
              <div className="text-slate-500 text-xs py-4 text-center">No anomalies near current time</div>
            )}
          </div>
        </div>

        {/* Event log */}
        <div className="panel">
          <h3 className="text-xs text-cyan-400 uppercase tracking-wider mb-2">Causal Events</h3>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {nearbyEvents.map((e, i) => (
              <div key={i} className="text-xs p-2 bg-slate-800/50 rounded">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${
                    e.severity === 'critical' ? 'bg-red-500' :
                    e.severity === 'warning' ? 'bg-yellow-500' : 'bg-blue-500'
                  }`} />
                  <span className="text-slate-400">T+{e.time_s}s</span>
                  <span className="text-slate-500">{e.source} -&gt; {e.target}</span>
                </div>
                <div className="ml-4 text-slate-300">{e.description}</div>
              </div>
            ))}
            {nearbyEvents.length === 0 && (
              <div className="text-slate-500 text-xs py-4 text-center">No events near current time</div>
            )}
          </div>
        </div>
      </div>

      {/* Causal chain tree */}
      {chain && (
        <div className="panel" data-testid="causality-tree">
          <h3 className="text-xs text-cyan-400 uppercase tracking-wider mb-2">
            Causal Chain for: {selectedAnomaly?.description}
          </h3>
          <TreeNode node={chain} />
        </div>
      )}
    </div>
  );
}
