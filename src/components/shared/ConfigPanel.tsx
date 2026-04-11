'use client';

import { useCallback, useState } from 'react';
import { useSimulationStore, type SimConfig } from '../../lib/store';
import type { FaultScenario, FaultEvent } from '../../simulation/types';

const GROUND_STATIONS = [
  { name: 'Redmond, WA', lat: 47.674, lon: -122.121 },
  { name: 'Mumbai, India', lat: 19.076, lon: 72.878 },
  { name: 'London, UK', lat: 51.507, lon: -0.128 },
  { name: 'Tokyo, Japan', lat: 35.682, lon: 139.762 },
  { name: 'Sydney, AU', lat: -33.868, lon: 151.209 },
  { name: 'São Paulo, BR', lat: -23.550, lon: -46.633 },
  { name: 'Cape Town, ZA', lat: -33.925, lon: 18.424 },
  { name: 'Reykjavik, IS', lat: 64.147, lon: -21.943 },
];

const FAULT_DEFS = [
  { type: 'element_failure' as const, label: 'Element Failures', desc: 'Disable % of phased array elements' },
  { type: 'pa_degradation' as const, label: 'PA Degradation', desc: 'Reduce P1dB and gain' },
  { type: 'oscillator_unlock' as const, label: 'Oscillator Unlock', desc: 'PLL loses lock temporarily' },
  { type: 'pa_thermal_runaway' as const, label: 'Thermal Runaway', desc: 'PA heat generation spike' },
  { type: 'compute_overload' as const, label: 'Compute Overload', desc: 'Scheduling jitter increase' },
  { type: 'solar_panel_damage' as const, label: 'Solar Panel Damage', desc: 'Reduce solar output' },
  { type: 'battery_degradation' as const, label: 'Battery Degradation', desc: 'Reduce battery capacity' },
  { type: 'attitude_glitch' as const, label: 'Attitude Glitch', desc: 'Pointing error spike' },
];

function Slider({ label, value, min, max, step, unit, onChange, testId }: {
  label: string; value: number; min: number; max: number; step: number; unit: string;
  onChange: (v: number) => void; testId?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px]">
        <span className="text-[var(--text-muted)]">{label}</span>
        <span className="metric-value text-[var(--text-secondary)]">{value}{unit}</span>
      </div>
      <input type="range" data-testid={testId} min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 accent-[var(--accent)] cursor-pointer"
      />
    </div>
  );
}

export function ConfigPanel() {
  const store = useSimulationStore();
  const cfg = store.config;

  const [faultStates, setFaultStates] = useState<Record<string, { enabled: boolean; severity: number; time: number }>>({});

  const updateGS = useCallback((gs: typeof GROUND_STATIONS[0]) => {
    store.updateConfig({ groundStation: gs });
  }, []);

  const buildFaults = useCallback((): FaultEvent[] => {
    return Object.entries(faultStates)
      .filter(([, v]) => v.enabled)
      .map(([type, v], i) => ({
        id: `custom-${type}`,
        name: type.replace(/_/g, ' '),
        type: type as FaultEvent['type'],
        triggerTime_s: v.time,
        duration_s: type === 'oscillator_unlock' ? 15 : -1,
        severity: v.severity,
        parameters: {},
        active: false,
      }));
  }, [faultStates]);

  const handleRun = useCallback(() => {
    const faults = buildFaults();
    store.updateConfig({ customFaults: faults });
    store.reset();
    // Small delay to let the reset propagate
    setTimeout(() => {
      store.runSimulation(faults.length > 0 ? 'custom' : store.scenario);
    }, 50);
  }, [buildFaults, store.scenario]);

  const toggleFault = (type: string) => {
    setFaultStates(prev => ({
      ...prev,
      [type]: prev[type]
        ? { ...prev[type], enabled: !prev[type].enabled }
        : { enabled: true, severity: 0.3, time: 120 },
    }));
  };

  const updateFaultSeverity = (type: string, severity: number) => {
    setFaultStates(prev => ({
      ...prev,
      [type]: { ...prev[type], severity },
    }));
  };

  const updateFaultTime = (type: string, time: number) => {
    setFaultStates(prev => ({
      ...prev,
      [type]: { ...prev[type], time },
    }));
  };

  return (
    <div className="h-full flex flex-col overflow-hidden" data-testid="config-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]">
        <h2 className="text-[13px] font-semibold text-[var(--accent)] tracking-wider"
          style={{ fontFamily: 'var(--font-jura)' }}>
          SIMULATION CONFIG
        </h2>
        <button onClick={store.toggleConfig}
          className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-sm transition-colors">
          ✕
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
        {/* Ground Station */}
        <section>
          <h3 className="metric-label mb-2">Ground Station</h3>
          <div className="grid grid-cols-2 gap-1.5">
            {GROUND_STATIONS.map((gs) => (
              <button key={gs.name} onClick={() => updateGS(gs)}
                className={`text-left text-[10px] px-2 py-1.5 rounded border transition-all ${
                  cfg.groundStation.name === gs.name
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--border-active)]'
                    : 'text-[var(--text-muted)] border-[var(--border-subtle)] hover:text-[var(--text-secondary)] hover:border-[var(--border-active)]'
                }`}
              >
                {gs.name}
              </button>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <div className="flex-1">
              <label className="text-[9px] text-[var(--text-dim)]">LAT</label>
              <input type="number" value={cfg.groundStation.lat.toFixed(2)}
                onChange={(e) => store.updateConfig({ groundStation: { ...cfg.groundStation, lat: parseFloat(e.target.value) || 0 } })}
                className="w-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[11px] text-[var(--text-secondary)] metric-value focus:border-[var(--border-active)] outline-none"
              />
            </div>
            <div className="flex-1">
              <label className="text-[9px] text-[var(--text-dim)]">LON</label>
              <input type="number" value={cfg.groundStation.lon.toFixed(2)}
                onChange={(e) => store.updateConfig({ groundStation: { ...cfg.groundStation, lon: parseFloat(e.target.value) || 0 } })}
                className="w-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[11px] text-[var(--text-secondary)] metric-value focus:border-[var(--border-active)] outline-none"
              />
            </div>
          </div>
        </section>

        {/* System parameters */}
        <section>
          <h3 className="metric-label mb-2">System Parameters</h3>
          <div className="space-y-3">
            <Slider label="Initial Battery SoC" value={cfg.initialBatterySoC} min={10} max={100} step={5} unit="%"
              onChange={(v) => store.updateConfig({ initialBatterySoC: v })} testId="config-battery" />
            <Slider label="Elevation Mask" value={cfg.elevationMask_deg} min={10} max={40} step={1} unit="°"
              onChange={(v) => store.updateConfig({ elevationMask_deg: v })} testId="config-elevation-mask" />
            <Slider label="Rain Attenuation" value={cfg.rainAttenuation_dB} min={0} max={5} step={0.5} unit=" dB"
              onChange={(v) => store.updateConfig({ rainAttenuation_dB: v })} testId="config-rain" />
          </div>
        </section>

        {/* Scenario preset */}
        <section>
          <h3 className="metric-label mb-2">Scenario Preset</h3>
          <div className="flex gap-1.5">
            {(['clean', 'degraded', 'stressed', 'failing'] as FaultScenario[]).map((sc) => (
              <button key={sc} onClick={() => { store.setScenario(sc); setFaultStates({}); }}
                className={`flex-1 text-[10px] py-1.5 rounded border transition-all capitalize ${
                  store.scenario === sc && Object.values(faultStates).every(f => !f.enabled)
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--border-active)]'
                    : 'text-[var(--text-muted)] border-[var(--border-subtle)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {sc}
              </button>
            ))}
          </div>
        </section>

        {/* Custom fault injection */}
        <section>
          <h3 className="metric-label mb-2">Custom Fault Injection</h3>
          <div className="space-y-2">
            {FAULT_DEFS.map((fd) => {
              const state = faultStates[fd.type];
              const enabled = state?.enabled ?? false;
              return (
                <div key={fd.type} className={`rounded border p-2 transition-all ${
                  enabled ? 'border-[var(--border-active)] bg-[var(--accent-soft)]' : 'border-[var(--border-subtle)]'
                }`}>
                  <div className="flex items-center gap-2">
                    <button onClick={() => toggleFault(fd.type)}
                      className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] transition-all ${
                        enabled
                          ? 'bg-[var(--accent)] border-[var(--accent)] text-black'
                          : 'border-[var(--text-dim)] text-transparent'
                      }`}
                    >
                      ✓
                    </button>
                    <div className="flex-1">
                      <div className="text-[11px] text-[var(--text-secondary)]">{fd.label}</div>
                      <div className="text-[9px] text-[var(--text-dim)]">{fd.desc}</div>
                    </div>
                  </div>
                  {enabled && (
                    <div className="mt-2 pl-6 space-y-2">
                      <Slider label="Severity" value={state?.severity ?? 0.3} min={0.1} max={1.0} step={0.1} unit=""
                        onChange={(v) => updateFaultSeverity(fd.type, v)} />
                      <Slider label="Trigger (sec)" value={state?.time ?? 120} min={0} max={400} step={10} unit="s"
                        onChange={(v) => updateFaultTime(fd.type, v)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Run button */}
      <div className="px-4 py-3 border-t border-[var(--border-subtle)]">
        <button onClick={handleRun}
          className="w-full py-2.5 rounded-lg font-semibold text-[12px] tracking-wider transition-all
            bg-[var(--accent)] text-black hover:brightness-110 active:scale-[0.98]"
          style={{ fontFamily: 'var(--font-jura)' }}
        >
          ▶ RUN SIMULATION
        </button>
      </div>
    </div>
  );
}
