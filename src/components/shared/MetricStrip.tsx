'use client';

import type { SimulationTick } from '../../simulation/types';
import { fmt, fmtSci } from '../../lib/utils';

interface MetricStripProps {
  tick: SimulationTick;
}

interface MetricBadgeProps {
  testId: string;
  label: string;
  value: number;
  unit: string;
  decimals?: number;
  colorFn?: (v: number) => string;
}

function MetricBadge({ testId, label, value, unit, decimals = 1, colorFn }: MetricBadgeProps) {
  const color = colorFn ? colorFn(value) : 'text-slate-200';
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</span>
      <span
        data-testid={testId}
        data-value={value}
        data-unit={unit}
        className={`metric-value text-sm ${color}`}
      >
        {fmt(value, decimals)} {unit}
      </span>
    </div>
  );
}

function snrColor(v: number): string {
  if (v < 5) return 'text-red-400';
  if (v < 10) return 'text-yellow-400';
  return 'text-green-400';
}

function marginColor(v: number): string {
  if (v < 0) return 'text-red-400';
  if (v < 3) return 'text-yellow-400';
  return 'text-green-400';
}

function tempColor(v: number): string {
  if (v > 85) return 'text-red-400';
  if (v > 70) return 'text-yellow-400';
  return 'text-slate-200';
}

export function MetricStrip({ tick }: MetricStripProps) {
  return (
    <div className="flex items-center gap-5 flex-wrap panel py-2 px-4 text-xs">
      <MetricBadge testId="metric-elevation" label="Elev" value={tick.orbit.elevation_deg} unit="deg" />
      <MetricBadge testId="metric-range" label="Range" value={tick.orbit.slantRange_km} unit="km" decimals={0} />
      <MetricBadge testId="metric-steering-angle" label="Steer" value={tick.antenna.steeringAngle_deg} unit="deg" />
      <MetricBadge testId="metric-antenna-gain" label="Gain" value={tick.antenna.effectiveGain_dBi} unit="dBi" />
      <MetricBadge testId="metric-pa-output" label="PA Out" value={tick.rfChain.pa.outputPower_dBm} unit="dBm" />
      <MetricBadge testId="metric-pa-temp" label="PA Temp" value={tick.thermal.paJunction_C} unit="C" colorFn={tempColor} />
      <MetricBadge testId="metric-snr" label="SNR" value={tick.linkBudget.effectiveSNR_dB} unit="dB" colorFn={snrColor} />
      <MetricBadge testId="metric-link-margin" label="Margin" value={tick.linkMargin_dB} unit="dB" colorFn={marginColor} />
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[10px] text-slate-500 uppercase tracking-wider">ModCod</span>
        <span data-testid="metric-modcod" data-value={tick.protocol.currentModCod} data-unit="" className="metric-value text-sm text-cyan-400">
          {tick.protocol.modulationName} {tick.protocol.codeRate}
        </span>
      </div>
      <MetricBadge testId="metric-goodput" label="Goodput" value={tick.goodput_Mbps} unit="Mbps" decimals={0} />
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[10px] text-slate-500 uppercase tracking-wider">BER</span>
        <span data-testid="metric-ber" data-value={tick.protocol.ber} data-unit="" className="metric-value text-sm text-slate-200">
          {fmtSci(tick.protocol.ber)}
        </span>
      </div>
      <MetricBadge testId="metric-battery-soc" label="Battery" value={tick.power.batterySoC_percent} unit="%" decimals={0} />
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[10px] text-slate-500 uppercase tracking-wider">Health</span>
        <span
          data-testid="metric-system-health"
          data-value={tick.systemHealth}
          className={`metric-value text-sm ${
            tick.systemHealth === 'critical' ? 'text-red-400' :
            tick.systemHealth === 'degraded' ? 'text-yellow-400' :
            'text-green-400'
          }`}
        >
          {tick.systemHealth.toUpperCase()}
        </span>
      </div>
    </div>
  );
}
