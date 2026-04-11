'use client';

import { useMemo } from 'react';
import type { SimulationTick } from '../../simulation/types';
import { fmt } from '../../lib/utils';

interface Props {
  tick: SimulationTick;
  allTicks: SimulationTick[];
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const TABS = [
  { id: 'antenna', label: 'Antenna' },
  { id: 'rf-chain', label: 'RF Chain' },
  { id: 'thermal', label: 'Thermal' },
  { id: 'power', label: 'Power' },
  { id: 'link-budget', label: 'Link Budget' },
  { id: 'protocol', label: 'Protocol' },
];

function Gauge({ label, value, max, unit, testId, color = 'bg-cyan-500' }: {
  label: string; value: number; max: number; unit: string; testId: string; color?: string;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span data-testid={testId} data-value={value} data-unit={unit} className="metric-value text-slate-200">
          {fmt(value)} {unit}
        </span>
      </div>
      <div className="gauge-bar">
        <div className={`gauge-fill ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Row({ label, value, unit, testId }: { label: string; value: string | number; unit?: string; testId?: string }) {
  return (
    <div className="flex justify-between text-sm py-0.5">
      <span className="text-slate-400">{label}</span>
      <span data-testid={testId} data-value={value} data-unit={unit ?? ''} className="metric-value text-slate-200">
        {typeof value === 'number' ? fmt(value) : value} {unit ?? ''}
      </span>
    </div>
  );
}

function MiniChart({ data, currentIndex, color = '#06b6d4' }: { data: number[]; currentIndex: number; color?: string }) {
  if (data.length === 0) return null;
  const max = Math.max(...data, 0.001);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 300;
  const h = 60;
  const points = data.map((v, i) => `${(i / data.length) * w},${h - ((v - min) / range) * h}`).join(' ');
  const cursorX = (currentIndex / data.length) * w;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16 mt-1">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" opacity="0.8" />
      <line x1={cursorX} y1={0} x2={cursorX} y2={h} stroke="white" strokeWidth="0.5" opacity="0.5" />
    </svg>
  );
}

function AntennaPanel({ tick, allTicks }: { tick: SimulationTick; allTicks: SimulationTick[] }) {
  const gainHistory = useMemo(() => allTicks.map(t => t.antenna.effectiveGain_dBi), [allTicks]);

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-3">
        <Gauge label="Steering Angle" value={tick.antenna.steeringAngle_deg} max={70} unit="deg" testId="metric-steering-angle-detail" />
        <Gauge label="Effective Gain" value={tick.antenna.effectiveGain_dBi} max={40} unit="dBi" testId="metric-antenna-gain-detail" />
        <Gauge label="Scan Loss" value={Math.abs(tick.antenna.scanLoss_dB)} max={10} unit="dB" testId="metric-scan-loss" color="bg-amber-500" />
        <Row label="Active Elements" value={`${tick.antenna.activeElements} / ${tick.antenna.totalElements}`} testId="metric-active-elements" />
        <Row label="Element Gain" value={tick.antenna.elementGain_dBi} unit="dBi" />
        <Row label="Beamwidth" value={tick.antenna.beamwidth_deg} unit="deg" />
        <Row label="Pointing Error" value={tick.antenna.pointingError_deg} unit="deg" />
        <Row label="Pointing Loss" value={tick.antenna.pointingLoss_dB} unit="dB" />
      </div>
      <div>
        <p className="text-xs text-slate-500 mb-1">Effective Gain over Pass</p>
        <MiniChart data={gainHistory} currentIndex={tick.second} />
      </div>
    </div>
  );
}

function RFChainPanel({ tick, allTicks }: { tick: SimulationTick; allTicks: SimulationTick[] }) {
  const evmHistory = useMemo(() => allTicks.map(t => t.rfChain.totalEVM_percent), [allTicks]);

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-3">
        <h3 className="text-xs text-cyan-400 uppercase tracking-wider">Power Amplifier</h3>
        <Gauge label="Output Power" value={tick.rfChain.pa.outputPower_dBm} max={35} unit="dBm" testId="metric-pa-output-detail" />
        <Gauge label="Backoff" value={tick.rfChain.pa.backoff_dB} max={10} unit="dB" testId="metric-pa-backoff" color="bg-amber-500" />
        <Row label="Gain" value={tick.rfChain.pa.gain_dB} unit="dB" />
        <Row label="Compression" value={tick.rfChain.pa.compressionLevel_dB} unit="dB" />
        <Row label="Efficiency" value={tick.rfChain.pa.efficiency_percent} unit="%" />
        <Row label="DC Draw" value={tick.rfChain.pa.dcPowerDraw_W} unit="W" />
        <Row label="Heat Dissipation" value={tick.rfChain.pa.heatDissipation_W} unit="W" />
        <Row label="EVM (PA)" value={tick.rfChain.pa.evmContribution_percent} unit="%" />
        <Row label="P1dB Derated" value={tick.rfChain.pa.p1dB_derated_dBm} unit="dBm" />

        <h3 className="text-xs text-cyan-400 uppercase tracking-wider mt-4">Oscillator</h3>
        <Row label="Freq Offset" value={tick.rfChain.oscillator.frequencyOffset_Hz} unit="Hz" testId="metric-osc-drift" />
        <Row label="Locked" value={tick.rfChain.oscillator.locked ? 'YES' : 'NO'} testId="metric-osc-locked" />
        <Row label="EVM (Osc)" value={tick.rfChain.oscillator.evmContribution_percent} unit="%" />
        <Row label="Temperature" value={tick.rfChain.oscillator.temperature_C} unit="C" testId="metric-osc-temp" />

        <h3 className="text-xs text-cyan-400 uppercase tracking-wider mt-4">Combined</h3>
        <Row label="Total EVM" value={tick.rfChain.totalEVM_percent} unit="%" testId="metric-total-evm" />
        <Row label="SNR Penalty" value={tick.rfChain.snrPenalty_dB} unit="dB" />
      </div>
      <div>
        <p className="text-xs text-slate-500 mb-1">Total EVM over Pass</p>
        <MiniChart data={evmHistory} currentIndex={tick.second} color="#f59e0b" />
      </div>
    </div>
  );
}

function ThermalPanel({ tick, allTicks }: { tick: SimulationTick; allTicks: SimulationTick[] }) {
  const tempHistory = useMemo(() => allTicks.map(t => t.thermal.paJunction_C), [allTicks]);

  function tempColor(v: number) {
    if (v > 85) return 'bg-red-500';
    if (v > 70) return 'bg-amber-500';
    return 'bg-cyan-500';
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-3">
        <Gauge label="PA Junction" value={tick.thermal.paJunction_C} max={100} unit="C" testId="metric-pa-temp-detail" color={tempColor(tick.thermal.paJunction_C)} />
        <Gauge label="Array Panel" value={tick.thermal.arrayPanel_C} max={80} unit="C" testId="metric-array-temp" color={tempColor(tick.thermal.arrayPanel_C)} />
        <Gauge label="Digital Board" value={tick.thermal.digitalBoard_C} max={80} unit="C" testId="metric-digital-temp" />
        <Gauge label="Oscillator" value={tick.thermal.oscillator_C} max={80} unit="C" testId="metric-osc-temp-detail" />
        <Gauge label="Radiator" value={tick.thermal.radiator_C} max={60} unit="C" testId="metric-radiator-temp" />
        <Row label="Solar Loading" value={tick.thermal.solarLoading_W} unit="W" />
        <Row label="Throttling" value={tick.thermal.throttling.toUpperCase()} testId="metric-thermal-throttle" />
      </div>
      <div>
        <p className="text-xs text-slate-500 mb-1">PA Junction Temperature over Pass</p>
        <MiniChart data={tempHistory} currentIndex={tick.second} color="#ef4444" />
      </div>
    </div>
  );
}

function PowerPanel({ tick, allTicks }: { tick: SimulationTick; allTicks: SimulationTick[] }) {
  const socHistory = useMemo(() => allTicks.map(t => t.power.batterySoC_percent), [allTicks]);

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-3">
        <Gauge label="Solar Output" value={tick.power.solarPanelOutput_W} max={5000} unit="W" testId="metric-solar-power" />
        <Gauge label="Battery SoC" value={tick.power.batterySoC_percent} max={100} unit="%" testId="metric-battery-soc-detail" color={tick.power.batterySoC_percent < 30 ? 'bg-red-500' : 'bg-green-500'} />
        <Row label="Power Mode" value={tick.power.powerMode} testId="metric-power-mode" />
        <Row label="Total Load" value={tick.power.totalLoadActual_W} unit="W" />
        <Row label="PA Allowed" value={tick.power.paAllowedPower_W} unit="W" />
        <h3 className="text-xs text-cyan-400 uppercase tracking-wider mt-3">Load Breakdown</h3>
        <Row label="PA" value={tick.power.loads.pa_W} unit="W" />
        <Row label="Array Electronics" value={tick.power.loads.arrayElectronics_W} unit="W" />
        <Row label="Digital" value={tick.power.loads.digital_W} unit="W" />
        <Row label="Thermal Mgmt" value={tick.power.loads.thermal_W} unit="W" />
        <Row label="Attitude Control" value={tick.power.loads.attitudeControl_W} unit="W" />
        <Row label="Housekeeping" value={tick.power.loads.housekeeping_W} unit="W" />
        <Row label="ISL" value={tick.power.loads.isl_W} unit="W" />
      </div>
      <div>
        <p className="text-xs text-slate-500 mb-1">Battery SoC over Pass</p>
        <MiniChart data={socHistory} currentIndex={tick.second} color="#22c55e" />
      </div>
    </div>
  );
}

function LinkBudgetPanel({ tick }: { tick: SimulationTick }) {
  const lb = tick.linkBudget;
  // Waterfall items: each step in the link budget
  const items = [
    { label: 'TX Power', value: lb.txPower_dBW, unit: 'dBW', delta: false },
    { label: '+ Antenna Gain', value: lb.antennaGain_dBi, unit: 'dBi', delta: true },
    { label: '- Feed Loss', value: -lb.feedLoss_dB, unit: 'dB', delta: true },
    { label: '= EIRP', value: lb.eirp_dBW, unit: 'dBW', delta: false },
    { label: '- FSPL', value: -lb.fspl_dB, unit: 'dB', delta: true },
    { label: '- Atmos Loss', value: -lb.atmosphericLoss_dB, unit: 'dB', delta: true },
    { label: '- Rain Loss', value: -lb.rainLoss_dB, unit: 'dB', delta: true },
    { label: '+ Rx G/T', value: lb.gOverT_dBK, unit: 'dB/K', delta: true },
    { label: '- kB', value: 228.6, unit: 'dB', delta: true },
    { label: '- 10log(BW)', value: -10 * Math.log10(lb.noiseBandwidth_Hz), unit: 'dB', delta: true },
    { label: '= C/N', value: lb.cnr_dB, unit: 'dB', delta: false },
    { label: '- EVM Penalty', value: -lb.evmPenalty_dB, unit: 'dB', delta: true },
    { label: '- Impl Loss', value: -lb.implementationLoss_dB, unit: 'dB', delta: true },
    { label: '= Effective SNR', value: lb.effectiveSNR_dB, unit: 'dB', delta: false },
  ];

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-1">
        <h3 className="text-xs text-cyan-400 uppercase tracking-wider mb-2">Link Budget Waterfall</h3>
        {items.map((item, i) => (
          <div key={i} className={`flex justify-between text-sm py-0.5 ${!item.delta ? 'font-bold text-cyan-300 border-t border-slate-700 pt-1' : ''}`}>
            <span className="text-slate-400">{item.label}</span>
            <span className="metric-value text-slate-200">{fmt(item.value)} {item.unit}</span>
          </div>
        ))}
        <div className="border-t border-slate-700 pt-1 mt-2">
          <div className="flex justify-between text-sm font-bold">
            <span className="text-slate-400">Required SNR</span>
            <span className="metric-value text-slate-200" data-testid="metric-required-snr">{fmt(lb.requiredSNR_dB)} dB</span>
          </div>
          <div className="flex justify-between text-sm font-bold">
            <span className="text-slate-400">Margin</span>
            <span className={`metric-value ${lb.margin_dB < 0 ? 'text-red-400' : lb.margin_dB < 3 ? 'text-yellow-400' : 'text-green-400'}`}
                  data-testid="metric-margin-detail">{fmt(lb.margin_dB)} dB</span>
          </div>
        </div>
      </div>
      <div className="space-y-3">
        <h3 className="text-xs text-cyan-400 uppercase tracking-wider">Doppler</h3>
        <Row label="Doppler Shift" value={lb.dopplerShift_Hz} unit="Hz" />
        <Row label="Doppler Rate" value={lb.dopplerRate_HzPerSec} unit="Hz/s" />
        <Row label="Doppler Penalty" value={lb.dopplerPenalty_dB} unit="dB" />
        <h3 className="text-xs text-cyan-400 uppercase tracking-wider mt-4">Path</h3>
        <Row label="Slant Range" value={lb.slantRange_km} unit="km" />
        <Row label="FSPL" value={lb.fspl_dB} unit="dB" testId="metric-fspl" />
        <Row label="EIRP" value={lb.eirp_dBW} unit="dBW" testId="metric-eirp" />
      </div>
    </div>
  );
}

function ProtocolPanel({ tick, allTicks }: { tick: SimulationTick; allTicks: SimulationTick[] }) {
  const goodputHistory = useMemo(() => allTicks.map(t => t.goodput_Mbps), [allTicks]);

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-3">
        <Row label="Modulation" value={`${tick.protocol.modulationName} ${tick.protocol.codeRate}`} testId="metric-modcod-detail" />
        <Row label="Spectral Efficiency" value={tick.protocol.spectralEfficiency} unit="bps/Hz" />
        <Row label="Raw Data Rate" value={tick.protocol.rawDataRate_Mbps} unit="Mbps" testId="metric-raw-rate" />
        <Row label="Useful Data Rate" value={tick.protocol.usefulDataRate_Mbps} unit="Mbps" />
        <Gauge label="Goodput" value={tick.protocol.goodput_Mbps} max={Math.max(tick.protocol.rawDataRate_Mbps, 1)} unit="Mbps" testId="metric-goodput-detail" />
        <Row label="BER (coded)" value={tick.protocol.ber.toExponential(1)} testId="metric-ber-detail" />
        <Row label="Packet Error Rate" value={`${(tick.protocol.packetErrorRate * 100).toFixed(3)}%`} testId="metric-per" />
        <Row label="Retransmission Rate" value={`${(tick.protocol.retransmissionRate * 100).toFixed(1)}%`} />
        <Row label="Avg Latency" value={tick.protocol.avgLatency_ms} unit="ms" />
        <Row label="Jitter" value={tick.protocol.jitter_ms} unit="ms" testId="metric-jitter" />
        <Row label="Packets this second" value={tick.protocol.packetsThisSecond.length} testId="metric-packets-total" />
        <Row label="Packets dropped" value={tick.protocol.packetsThisSecond.filter(p => p.dropped).length} testId="metric-packets-dropped" />
      </div>
      <div>
        <p className="text-xs text-slate-500 mb-1">Goodput over Pass</p>
        <MiniChart data={goodputHistory} currentIndex={tick.second} />
      </div>
    </div>
  );
}

export function SatelliteDashboard({ tick, allTicks, activeTab, onTabChange }: Props) {
  return (
    <div className="space-y-3">
      {/* Subsystem tabs */}
      <div className="flex gap-1" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            data-testid={`tab-${tab.id}`}
            aria-label={`${tab.label} subsystem`}
            aria-selected={activeTab === tab.id}
            className={`px-3 py-1.5 text-xs rounded transition-colors ${
              activeTab === tab.id
                ? 'bg-cyan-900/50 text-cyan-400 border border-cyan-700'
                : 'bg-slate-800 text-slate-500 hover:text-slate-300 border border-transparent'
            }`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Active panel */}
      <div className="panel">
        {activeTab === 'antenna' && <AntennaPanel tick={tick} allTicks={allTicks} />}
        {activeTab === 'rf-chain' && <RFChainPanel tick={tick} allTicks={allTicks} />}
        {activeTab === 'thermal' && <ThermalPanel tick={tick} allTicks={allTicks} />}
        {activeTab === 'power' && <PowerPanel tick={tick} allTicks={allTicks} />}
        {activeTab === 'link-budget' && <LinkBudgetPanel tick={tick} />}
        {activeTab === 'protocol' && <ProtocolPanel tick={tick} allTicks={allTicks} />}
      </div>
    </div>
  );
}
