'use client';

import { useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSimulationStore } from '../lib/store';
import type { FaultScenario, Anomaly, SimulationTick } from '../simulation/types';
import { Controls } from '../components/shared/Controls';
import { Timeline } from '../components/shared/Timeline';
import { MetricCards } from '../components/shared/MetricCards';
import dynamic from 'next/dynamic';
import { ConfigPanel } from '../components/shared/ConfigPanel';
import { Tooltip } from '../components/shared/Tooltip';
import { GuidedTour, TourTrigger } from '../components/shared/GuidedTour';

const GlobeScene = dynamic(() => import('../components/globe/GlobeScene'), {
  ssr: false,
  loading: () => (
    <div className="globe-container w-full h-full flex items-center justify-center">
      <span className="text-[var(--text-dim)] text-sm">Loading 3D globe...</span>
    </div>
  ),
});
import { SatelliteDashboard } from '../components/satellite/SatelliteDashboard';
import { GroundStationView } from '../components/ground-station/GroundStationView';
import { CausalityView } from '../components/causality/CausalityView';
import { fmtTime } from '../lib/utils';

function anomalyLabel(anomaly: Anomaly): string {
  switch (anomaly.type) {
    case 'tracking_loss':
      return 'Tracking Loss';
    case 'thermal_throttle':
      return 'Thermal Throttle';
    case 'scheduler_backlog':
      return 'Scheduler Backlog';
    case 'packet_burst_loss':
      return 'Burst Loss';
    case 'power_mode_change':
      return 'Power Mode';
    case 'goodput_drop':
      return 'Goodput Drop';
    default:
      return anomaly.type.replaceAll('_', ' ');
  }
}

function describeTickIssue(tick: SimulationTick): string {
  if (!tick.linkBudget.trackingLocked) {
    return `Carrier reacquisition in progress with ${tick.linkBudget.trackingError_Hz.toFixed(0)} Hz residual error`;
  }
  if (tick.thermal.throttling !== 'none') {
    return `PA is thermally throttled at ${tick.thermal.paJunction_C.toFixed(1)} C and backing off transmit power`;
  }
  if (tick.protocol.queueDepth_packets > 5000) {
    return `Compute-limited scheduler backlog is holding ${tick.protocol.queueDepth_packets.toLocaleString()} packets`;
  }
  if (tick.power.powerMode >= 1) {
    return `EPS is constraining discretionary loads in power mode ${tick.power.powerMode}`;
  }
  if (tick.antenna.degradedSubarrays > 0) {
    return `${tick.antenna.degradedSubarrays} degraded subarrays are widening and weakening the beam`;
  }
  if (tick.orbit.elevation_deg < 30) {
    return `Pass-edge geometry is driving scan loss at ${tick.orbit.elevation_deg.toFixed(1)} degrees elevation`;
  }
  return 'Nominal locked downlink with hardware margins intact';
}

function SimulatorContent() {
  const searchParams = useSearchParams();
  const store = useSimulationStore();
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // URL params for agent-browser
  useEffect(() => {
    if (!store.result) return;
    const view = searchParams.get('view');
    const scenario = searchParams.get('scenario');
    const t = searchParams.get('t');
    if (view === 'satellite' || view === 'ground-station' || view === 'causality') store.setActiveView(view);
    if (scenario) store.setScenario(scenario as FaultScenario);
    if (t) store.setCurrentSecond(parseInt(t, 10));
  }, [searchParams, store, store.result]);

  // Auto-run simulation after localStorage hydration (small delay to ensure config is loaded)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (useSimulationStore.getState().status === 'idle') {
        useSimulationStore.getState().runSimulation();
      }
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (store.isPlaying && store.result) {
      playIntervalRef.current = setInterval(() => store.step(), 1000 / store.playbackSpeed);
    }
    return () => { if (playIntervalRef.current) clearInterval(playIntervalRef.current); };
  }, [store]);

  const handleScenarioChange = useCallback((scenario: FaultScenario) => {
    store.setScenario(scenario);
    store.runSimulation(scenario);
  }, [store]);

  const tick = store.currentTick();

  const orbitPath = useMemo(() => {
    if (!store.result) return [];
    return store.result.ticks.map(t => [t.orbit.subSatLon_deg, t.orbit.subSatLat_deg] as [number, number]);
  }, [store.result]);

  const cumulativeMB = useMemo(() => {
    if (!store.result) return 0;
    return store.result.ticks
      .slice(0, store.currentSecond + 1)
      .reduce((sum, t) => sum + t.goodput_Mbps / 8, 0);
  }, [store.result, store.currentSecond]);
  const focusAnomalies = useMemo(() => {
    if (!store.result) return [];
    const interesting = new Set([
      'tracking_loss',
      'thermal_throttle',
      'scheduler_backlog',
      'packet_burst_loss',
      'power_mode_change',
      'goodput_drop',
    ]);
    const severityRank: Record<Anomaly['severity'], number> = {
      severe: 0,
      moderate: 1,
      minor: 2,
    };
    const seenTimes = new Set<number>();
    return store.result.anomalies
      .filter((anomaly) => interesting.has(anomaly.type))
      .sort((a, b) => (
        severityRank[a.severity] - severityRank[b.severity]
        || a.time_s - b.time_s
      ))
      .filter((anomaly) => {
        if (seenTimes.has(anomaly.time_s)) return false;
        seenTimes.add(anomaly.time_s);
        return true;
      })
      .slice(0, 6);
  }, [store.result]);
  const statusSummary = useMemo(() => (tick ? describeTickIssue(tick) : ''), [tick]);
  const activeFaultLabels = useMemo(() => (
    tick?.faults.activeFaults.map((fault) => fault.name) ?? []
  ), [tick]);
  const handleFocusAnomaly = useCallback((anomaly: Anomaly) => {
    store.pause();
    store.setCurrentSecond(anomaly.time_s);
    store.setActiveView(
      anomaly.type === 'packet_burst_loss' || anomaly.type === 'scheduler_backlog'
        ? 'ground-station'
        : 'causality',
    );
  }, [store]);

  const gs = store.result?.groundStation;

  return (
    <main className="h-screen flex flex-col overflow-hidden" style={{ background: 'var(--bg-deep)' }} data-testid="app-root">
      {/* ═══ HEADER ═══ */}
      <header className="flex items-center gap-4 px-4 py-2 border-b border-[var(--border-subtle)]" style={{ background: 'var(--bg-surface)' }}>
        <h1 className="text-sm font-semibold tracking-wider text-[var(--accent)]" style={{ fontFamily: 'var(--font-jura), sans-serif' }}>
          STARLINK PASS SIM
        </h1>

        <Controls
          scenario={store.scenario}
          onScenarioChange={handleScenarioChange}
          rainAttenuation={store.config.rainAttenuation_dB}
          onRainChange={store.setRainAttenuation}
          isPlaying={store.isPlaying}
          playbackSpeed={store.playbackSpeed}
          onPlay={store.play}
          onPause={store.pause}
          onReset={() => { store.reset(); store.runSimulation(); }}
          onStep={store.step}
          onSpeedChange={store.setPlaybackSpeed}
        />

        <div className="flex-1" />

        <span data-testid="display-current-second" data-value={store.currentSecond}
          className="metric-value text-sm text-[var(--text-secondary)]">
          T+{fmtTime(store.currentSecond)}
        </span>



        <Tooltip content="Open the simulation drawer for station, weather, and custom fault settings.">
          <button onClick={store.toggleConfig} data-testid="btn-config" aria-label="Simulation config" title="Open simulation configuration"
            className={`text-[10px] px-2.5 py-1 rounded border transition-all ${
              store.showConfig
                ? 'bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--border-active)]'
                : 'text-[var(--text-muted)] border-[var(--border-subtle)] hover:text-[var(--text-secondary)] hover:border-[var(--border-active)]'
            }`}
            style={{ fontFamily: 'var(--font-jura)' }}>
            ⚙ CONFIG
          </button>
        </Tooltip>

        <TourTrigger />

        <span data-testid="sim-status"
          className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
            store.status === 'complete' ? 'bg-[var(--success-soft)] text-[var(--success)]'
            : store.status === 'running' ? 'bg-[var(--warning-soft)] text-[var(--warning)]'
            : store.status === 'error' ? 'bg-[var(--danger-soft)] text-[var(--danger)]'
            : 'bg-[var(--bg-elevated)] text-[var(--text-dim)]'
          }`}>
          {store.status}
        </span>
      </header>

      {/* ═══ MAIN CONTENT ═══ */}
      <div className="flex-1 flex min-h-0 relative">
        {store.status === 'complete' && store.error && (
          <div
            className="absolute top-3 left-1/2 z-40 -translate-x-1/2 rounded border border-[var(--border-active)] bg-[var(--warning-soft)] px-3 py-2 text-[11px] text-[var(--warning)] shadow-lg"
            data-testid="warning-banner"
          >
            {store.error}
          </div>
        )}

        {/* Config Panel (slide-over) */}
        {store.showConfig && (
          <div className="absolute inset-y-0 left-0 w-[340px] z-30 border-r border-[var(--border-active)]"
            style={{ background: 'var(--bg-surface)' }}>
            <ConfigPanel />
          </div>
        )}

        {/* LEFT: Globe */}
        <div className={`${store.showConfig ? 'ml-[340px]' : ''} w-[55%] min-w-[400px] p-3 flex flex-col transition-all duration-300`}>
          <div className="flex-1 min-h-0">
            {tick && gs ? (
              <GlobeScene
                satelliteLat={tick.orbit.subSatLat_deg}
                satelliteLon={tick.orbit.subSatLon_deg}
                groundStationLat={gs.lat}
                groundStationLon={gs.lon}
                elevation_deg={tick.orbit.elevation_deg}
                azimuth_deg={tick.orbit.azimuth_deg}
                slantRange_km={tick.orbit.slantRange_km}
                orbitPath={orbitPath}
                currentIndex={store.currentSecond}
                systemHealth={tick.systemHealth}
                goodput_Mbps={tick.goodput_Mbps}
                beamQuality_percent={tick.antenna.beamQuality_percent}
                retransmissionRate={tick.protocol.retransmissionRate}
                packetErrorRate={tick.protocol.packetErrorRate}
                queueDepth_packets={tick.protocol.queueDepth_packets}
                trackingLocked={tick.linkBudget.trackingLocked}
                trackingError_Hz={tick.linkBudget.trackingError_Hz}
                powerMode={tick.power.powerMode}
                degradedSubarrays={tick.antenna.degradedSubarrays}
                statusSummary={statusSummary}
                activeFaultLabels={activeFaultLabels}
              />
            ) : (
              <div className="globe-container w-full h-full flex items-center justify-center">
                <span className="text-[var(--text-dim)] text-sm">
                  {store.status === 'running' ? 'Computing pass...' : 'Initializing...'}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Metrics + Detail */}
        <div className="flex-1 min-w-[380px] flex flex-col p-3 pl-0 gap-2 overflow-hidden">
          {/* Metric cards */}
          {tick && <MetricCards tick={tick} cumulativeMB={cumulativeMB} />}

          {focusAnomalies.length > 0 && (
            <div className="panel flex flex-wrap items-center gap-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-dim)]">
                Jump To Failure Mode
              </div>
              {focusAnomalies.map((anomaly) => {
                const isActive = Math.abs(store.currentSecond - anomaly.time_s) <= 1;
                return (
              <button
                    key={anomaly.id}
                    type="button"
                    onClick={() => handleFocusAnomaly(anomaly)}
                    title={`Jump to ${anomalyLabel(anomaly)} at T+${fmtTime(anomaly.time_s)}`}
                    className={`rounded-full border px-3 py-1 text-[11px] transition-colors ${
                      isActive
                        ? 'border-cyan-500 bg-cyan-950/70 text-cyan-200'
                        : anomaly.severity === 'severe'
                          ? 'border-red-900/80 bg-red-950/40 text-red-200 hover:border-red-500'
                          : 'border-slate-700 bg-slate-900/70 text-slate-300 hover:border-cyan-700'
                    }`}
                  >
                    {anomalyLabel(anomaly)} <span className="text-slate-500">T+{fmtTime(anomaly.time_s)}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* View tabs */}
          <div className="flex gap-1" role="tablist">
            {(['satellite', 'ground-station', 'causality'] as const).map((view) => (
              <Tooltip
                key={view}
                content={
                  view === 'satellite'
                    ? 'Inspect onboard subsystem state and beam hardware.'
                    : view === 'ground-station'
                      ? 'Inspect packets, retransmissions, and received-link metrics.'
                      : 'Trace anomalies back to hardware and scheduler causes.'
                }
                widthClassName="max-w-[240px]"
              >
                <button role="tab"
                  data-testid={`tab-${view}`}
                  aria-label={`${view} view`}
                  aria-selected={store.activeView === view}
                  title={`Open the ${view} view`}
                  className={`px-3 py-1.5 text-[11px] rounded-md border transition-all ${
                    store.activeView === view
                      ? 'tab-active'
                      : 'text-[var(--text-muted)] bg-transparent border-transparent hover:text-[var(--text-secondary)] hover:border-[var(--border-subtle)]'
                  }`}
                  style={{ fontFamily: 'var(--font-jura), sans-serif', fontWeight: 500, letterSpacing: '0.04em' }}
                  onClick={() => store.setActiveView(view)}
                >
                  {view === 'satellite' ? 'SATELLITE' : view === 'ground-station' ? 'GROUND STN' : 'CAUSALITY'}
                </button>
              </Tooltip>
            ))}
          </div>

          {/* Detail panel */}
          <div className="flex-1 min-h-0 overflow-y-auto" data-testid={`panel-${store.activeView}`}>
            {store.status === 'running' && (
              <div className="flex items-center justify-center h-32 text-[var(--text-dim)]">Computing...</div>
            )}
            {store.status === 'error' && (
              <div className="flex items-center justify-center h-32 text-[var(--danger)]">Error: {store.error}</div>
            )}
            {store.status === 'complete' && tick && (
              <div className="view-panel">
                {store.activeView === 'satellite' && (
                  <SatelliteDashboard tick={tick} allTicks={store.result!.ticks}
                    activeTab={store.activeSubsystemTab} onTabChange={store.setActiveSubsystemTab} />
                )}
                {store.activeView === 'ground-station' && (
                  <GroundStationView tick={tick}
                    packets={store.result!.packetTrace} currentSecond={store.currentSecond} />
                )}
                {store.activeView === 'causality' && (
                  <CausalityView tick={tick} allTicks={store.result!.ticks}
                    anomalies={store.result!.anomalies} eventLog={store.result!.eventLog}
                    currentSecond={store.currentSecond} onJumpToSecond={store.setCurrentSecond} />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ TIMELINE ═══ */}
      {store.result && (
        <div className="px-4 pb-3">
          <Timeline
            totalSeconds={store.result.passWindow.durationSeconds}
            currentSecond={store.currentSecond}
            ticks={store.result.ticks}
            anomalies={store.result.anomalies}
            onSeek={store.setCurrentSecond}
          />
        </div>
      )}

      {/* Summary footer */}
      {store.result && (
        <div className="flex items-center gap-6 px-4 pb-2 text-[10px] text-[var(--text-dim)] border-t border-[var(--border-subtle)] pt-1.5">
          <span>Peak <span className="text-[var(--text-muted)] metric-value">{store.result.summary.peakGoodput_Mbps.toFixed(0)}</span> Mbps</span>
          <span>Avg <span className="text-[var(--text-muted)] metric-value">{store.result.summary.avgGoodput_Mbps.toFixed(0)}</span> Mbps</span>
          <span>Data <span className="text-[var(--text-muted)] metric-value">{store.result.summary.totalDataTransferred_MB.toFixed(1)}</span> MB</span>
          <span>Pkts <span className="text-[var(--text-muted)] metric-value">{store.result.summary.packetsTotal}</span></span>
          <span>Drop <span className={`metric-value ${store.result.summary.packetDropRate > 0.01 ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}`}>{(store.result.summary.packetDropRate * 100).toFixed(2)}%</span></span>
        </div>
      )}
      {/* Guided onboarding tour (shows on first visit) */}
      <GuidedTour />
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen text-[var(--text-dim)]" style={{ background: 'var(--bg-deep)' }}>Initializing...</div>}>
      <SimulatorContent />
    </Suspense>
  );
}
