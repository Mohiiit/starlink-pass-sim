'use client';

import { useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSimulationStore } from '../lib/store';
import type { FaultScenario } from '../simulation/types';
import { Controls } from '../components/shared/Controls';
import { Timeline } from '../components/shared/Timeline';
import { MetricCards } from '../components/shared/MetricCards';
import dynamic from 'next/dynamic';
import { ConfigPanel } from '../components/shared/ConfigPanel';

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

function SimulatorContent() {
  const searchParams = useSearchParams();
  const store = useSimulationStore();
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // URL params for agent-browser
  useEffect(() => {
    const view = searchParams.get('view');
    const scenario = searchParams.get('scenario');
    const t = searchParams.get('t');
    if (view === 'satellite' || view === 'ground-station' || view === 'causality') store.setActiveView(view);
    if (scenario) store.setScenario(scenario as FaultScenario);
    if (t) store.setCurrentSecond(parseInt(t, 10));
  }, [searchParams]);

  useEffect(() => { if (store.status === 'idle') store.runSimulation(); }, []);

  useEffect(() => {
    if (store.isPlaying && store.result) {
      playIntervalRef.current = setInterval(() => store.step(), 1000 / store.playbackSpeed);
    }
    return () => { if (playIntervalRef.current) clearInterval(playIntervalRef.current); };
  }, [store.isPlaying, store.playbackSpeed, store.result]);

  const handleScenarioChange = useCallback((scenario: FaultScenario) => {
    store.setScenario(scenario);
    store.runSimulation(scenario);
  }, []);

  const tick = store.currentTick();

  const orbitPath = useMemo(() => {
    if (!store.result) return [];
    return store.result.ticks.map(t => [t.orbit.subSatLon_deg, t.orbit.subSatLat_deg] as [number, number]);
  }, [store.result]);

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
          rainAttenuation={store.rainAttenuation_dB}
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

        <button onClick={store.toggleConfig} data-testid="btn-config" aria-label="Simulation config"
          className={`text-[10px] px-2.5 py-1 rounded border transition-all ${
            store.showConfig
              ? 'bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--border-active)]'
              : 'text-[var(--text-muted)] border-[var(--border-subtle)] hover:text-[var(--text-secondary)] hover:border-[var(--border-active)]'
          }`}
          style={{ fontFamily: 'var(--font-jura)' }}>
          ⚙ CONFIG
        </button>

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
          {tick && <MetricCards tick={tick} />}

          {/* View tabs */}
          <div className="flex gap-1" role="tablist">
            {(['satellite', 'ground-station', 'causality'] as const).map((view) => (
              <button key={view} role="tab"
                data-testid={`tab-${view}`}
                aria-label={`${view} view`}
                aria-selected={store.activeView === view}
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
                  <GroundStationView tick={tick} allTicks={store.result!.ticks}
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
