'use client';

import type { SimulationTick } from '../../simulation/types';
import { fmt, fmtSci } from '../../lib/utils';

interface Props {
  tick: SimulationTick;
  cumulativeMB?: number;
}

function cardStatus(value: number, warnThreshold: number, critThreshold: number, invert = false): string {
  if (invert) {
    return value > critThreshold ? 'critical' : value > warnThreshold ? 'warning' : 'nominal';
  }
  return value < critThreshold ? 'critical' : value < warnThreshold ? 'warning' : 'nominal';
}

function GaugeBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="gauge-bar mt-auto">
      <div className="gauge-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function Card({
  testId, label, value, unit, decimals = 1, status, gauge,
}: {
  testId: string; label: string; value: number; unit: string;
  decimals?: number; status: string;
  gauge?: { value: number; max: number; color: string };
}) {
  const statusColors: Record<string, string> = {
    nominal: 'var(--text-primary)',
    warning: 'var(--warning)',
    critical: 'var(--danger)',
  };
  return (
    <div className="metric-card" data-status={status}>
      <span className="metric-label">{label}</span>
      <span
        data-testid={testId}
        data-value={value}
        data-unit={unit}
        className="metric-value text-xl leading-none"
        style={{ color: statusColors[status] || 'var(--text-primary)' }}
      >
        {fmt(value, decimals)}
      </span>
      <span className="text-[10px] text-[var(--text-muted)]">{unit}</span>
      {gauge && <GaugeBar {...gauge} />}
    </div>
  );
}

export function MetricCards({ tick, cumulativeMB = 0 }: Props) {
  return (
    <div className="space-y-2">
      {/* Primary metric cards */}
      <div className="grid grid-cols-3 gap-2">
        <Card
          testId="metric-goodput"
          label="Goodput"
          value={tick.goodput_Mbps}
          unit="Mbps"
          decimals={0}
          status={cardStatus(tick.goodput_Mbps, 50, 10)}
          gauge={{ value: tick.goodput_Mbps, max: 500, color: 'var(--accent)' }}
        />
        <Card
          testId="metric-snr"
          label="SNR"
          value={tick.linkBudget.effectiveSNR_dB}
          unit="dB"
          status={cardStatus(tick.linkBudget.effectiveSNR_dB, 10, 5)}
          gauge={{ value: tick.linkBudget.effectiveSNR_dB, max: 25, color: tick.linkBudget.effectiveSNR_dB < 5 ? 'var(--danger)' : tick.linkBudget.effectiveSNR_dB < 10 ? 'var(--warning)' : 'var(--success)' }}
        />
        <Card
          testId="metric-elevation"
          label="Elevation"
          value={tick.orbit.elevation_deg}
          unit="deg"
          status="nominal"
          gauge={{ value: tick.orbit.elevation_deg, max: 90, color: 'var(--accent)' }}
        />
        <Card
          testId="metric-pa-temp"
          label="PA Temp"
          value={tick.thermal.paJunction_C}
          unit="°C"
          status={cardStatus(tick.thermal.paJunction_C, 70, 85, true)}
          gauge={{ value: tick.thermal.paJunction_C, max: 100, color: tick.thermal.paJunction_C > 85 ? 'var(--danger)' : tick.thermal.paJunction_C > 70 ? 'var(--warning)' : 'var(--accent)' }}
        />
        <Card
          testId="metric-battery-soc"
          label="Battery"
          value={tick.power.batterySoC_percent}
          unit="%"
          decimals={0}
          status={cardStatus(tick.power.batterySoC_percent, 40, 20)}
          gauge={{ value: tick.power.batterySoC_percent, max: 100, color: tick.power.batterySoC_percent < 20 ? 'var(--danger)' : tick.power.batterySoC_percent < 40 ? 'var(--warning)' : 'var(--success)' }}
        />
        <Card
          testId="metric-link-margin"
          label="Margin"
          value={tick.linkMargin_dB}
          unit="dB"
          status={cardStatus(tick.linkMargin_dB, 3, 0)}
          gauge={{ value: Math.max(0, tick.linkMargin_dB), max: 15, color: tick.linkMargin_dB < 0 ? 'var(--danger)' : tick.linkMargin_dB < 3 ? 'var(--warning)' : 'var(--success)' }}
        />
      </div>

      {/* Secondary metrics strip — compact, ensures all data-testid attrs exist */}
      <div className="flex items-center gap-3 flex-wrap px-1 text-[10px]">
        <Compact testId="metric-modcod" label="MOD" value={`${tick.protocol.modulationName} ${tick.protocol.codeRate}`} dataValue={tick.protocol.currentModCod} accent />
        <Compact testId="metric-ber" label="BER" value={fmtSci(tick.protocol.ber)} dataValue={tick.protocol.ber} />
        <Compact testId="metric-range" label="RNG" value={`${fmt(tick.orbit.slantRange_km, 0)} km`} dataValue={tick.orbit.slantRange_km} />
        <Compact testId="metric-steering-angle" label="STR" value={`${fmt(tick.antenna.steeringAngle_deg)}°`} dataValue={tick.antenna.steeringAngle_deg} />
        <Compact testId="metric-antenna-gain" label="GAIN" value={`${fmt(tick.antenna.effectiveGain_dBi)} dBi`} dataValue={tick.antenna.effectiveGain_dBi} />
        <Compact testId="metric-pa-output" label="PA" value={`${fmt(tick.rfChain.pa.outputPower_dBm)} dBm`} dataValue={tick.rfChain.pa.outputPower_dBm} />
        <Compact testId="metric-scan-loss" label="SCAN" value={`${fmt(Math.abs(tick.antenna.scanLoss_dB))} dB`} dataValue={Math.abs(tick.antenna.scanLoss_dB)} />
        <Compact testId="metric-data-transferred" label="DATA" value={`${cumulativeMB.toFixed(1)} MB`} dataValue={cumulativeMB} accent />
        <div className="flex-1" />
        <span
          data-testid="metric-system-health"
          data-value={tick.systemHealth}
          className="status-badge"
          data-health={tick.systemHealth}
        >
          {tick.systemHealth}
        </span>
      </div>
    </div>
  );
}

function Compact({ testId, label, value, dataValue, accent }: {
  testId: string; label: string; value: string; dataValue: number | string; accent?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[var(--text-dim)]">{label}</span>
      <span
        data-testid={testId}
        data-value={dataValue}
        className={`metric-value ${accent ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}
      >
        {value}
      </span>
    </div>
  );
}
