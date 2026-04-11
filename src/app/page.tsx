'use client';

import { useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSimulationStore } from '../lib/store';
import type { FaultScenario } from '../simulation/types';
import { Controls } from '../components/shared/Controls';
import { Timeline } from '../components/shared/Timeline';
import { MetricStrip } from '../components/shared/MetricStrip';
import { SatelliteDashboard } from '../components/satellite/SatelliteDashboard';
import { GroundStationView } from '../components/ground-station/GroundStationView';
import { CausalityView } from '../components/causality/CausalityView';

function SimulatorContent() {
  const searchParams = useSearchParams();
  const store = useSimulationStore();
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Read URL params for agent-browser navigation
  useEffect(() => {
    const view = searchParams.get('view');
    const scenario = searchParams.get('scenario');
    const t = searchParams.get('t');

    if (view === 'satellite' || view === 'ground-station' || view === 'causality') {
      store.setActiveView(view);
    }
    if (scenario) {
      store.setScenario(scenario as FaultScenario);
    }
    if (t) {
      store.setCurrentSecond(parseInt(t, 10));
    }
  }, [searchParams]);

  // Auto-run simulation on first load
  useEffect(() => {
    if (store.status === 'idle') {
      store.runSimulation();
    }
  }, []);

  // Playback timer
  useEffect(() => {
    if (store.isPlaying && store.result) {
      playIntervalRef.current = setInterval(() => {
        store.step();
      }, 1000 / store.playbackSpeed);
    }
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, [store.isPlaying, store.playbackSpeed, store.result]);

  const handleScenarioChange = useCallback((scenario: FaultScenario) => {
    store.setScenario(scenario);
    store.runSimulation(scenario);
  }, []);

  const tick = store.currentTick();

  return (
    <main className="min-h-screen p-4 flex flex-col gap-3" data-testid="app-root">
      {/* Header */}
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-cyan-400">
          STARLINK PASS SIMULATOR
        </h1>
        <div className="flex items-center gap-4">
          <span
            data-testid="sim-status"
            className={`text-sm px-2 py-1 rounded ${
              store.status === 'complete' ? 'bg-green-900/50 text-green-400' :
              store.status === 'running' ? 'bg-yellow-900/50 text-yellow-400' :
              store.status === 'error' ? 'bg-red-900/50 text-red-400' :
              'bg-slate-700/50 text-slate-400'
            }`}
          >
            {store.status}
          </span>
          <span data-testid="display-current-second" data-value={store.currentSecond} className="text-sm text-slate-400 font-mono">
            T+{store.currentSecond}s
          </span>
        </div>
      </header>

      {/* Controls bar */}
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

      {/* View tabs */}
      <div className="flex gap-1 border-b border-slate-700 pb-1" role="tablist">
        {(['satellite', 'ground-station', 'causality'] as const).map((view) => (
          <button
            key={view}
            role="tab"
            data-testid={`tab-${view}`}
            aria-label={`${view} view`}
            aria-selected={store.activeView === view}
            className={`px-4 py-2 text-sm rounded-t transition-colors ${
              store.activeView === view
                ? 'tab-active bg-slate-800 text-cyan-400'
                : 'text-slate-500 hover:text-slate-300'
            }`}
            onClick={() => store.setActiveView(view)}
          >
            {view === 'satellite' ? 'Satellite' :
             view === 'ground-station' ? 'Ground Station' :
             'Causality'}
          </button>
        ))}
      </div>

      {/* Metric strip - key values always visible */}
      {tick && <MetricStrip tick={tick} />}

      {/* Main content area */}
      <div className="flex-1 min-h-0" data-testid={`panel-${store.activeView}`}>
        {store.status === 'running' && (
          <div className="flex items-center justify-center h-64 text-slate-500">
            Running simulation...
          </div>
        )}
        {store.status === 'error' && (
          <div className="flex items-center justify-center h-64 text-red-400">
            Error: {store.error}
          </div>
        )}
        {store.status === 'complete' && tick && (
          <>
            {store.activeView === 'satellite' && (
              <SatelliteDashboard
                tick={tick}
                allTicks={store.result!.ticks}
                activeTab={store.activeSubsystemTab}
                onTabChange={store.setActiveSubsystemTab}
              />
            )}
            {store.activeView === 'ground-station' && (
              <GroundStationView
                tick={tick}
                allTicks={store.result!.ticks}
                packets={store.result!.packetTrace}
                currentSecond={store.currentSecond}
              />
            )}
            {store.activeView === 'causality' && (
              <CausalityView
                tick={tick}
                allTicks={store.result!.ticks}
                anomalies={store.result!.anomalies}
                eventLog={store.result!.eventLog}
                currentSecond={store.currentSecond}
                onJumpToSecond={store.setCurrentSecond}
              />
            )}
          </>
        )}
      </div>

      {/* Timeline scrubber */}
      {store.result && (
        <Timeline
          totalSeconds={store.result.passWindow.durationSeconds}
          currentSecond={store.currentSecond}
          ticks={store.result.ticks}
          anomalies={store.result.anomalies}
          onSeek={store.setCurrentSecond}
        />
      )}

      {/* Summary bar */}
      {store.result && (
        <footer className="text-xs text-slate-500 flex gap-6">
          <span>Peak: {store.result.summary.peakGoodput_Mbps.toFixed(0)} Mbps</span>
          <span>Avg: {store.result.summary.avgGoodput_Mbps.toFixed(0)} Mbps</span>
          <span>Data: {store.result.summary.totalDataTransferred_MB.toFixed(1)} MB</span>
          <span>Packets: {store.result.summary.packetsTotal}</span>
          <span>Dropped: {store.result.summary.packetsDropped} ({(store.result.summary.packetDropRate * 100).toFixed(2)}%)</span>
        </footer>
      )}
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen text-slate-500">Loading...</div>}>
      <SimulatorContent />
    </Suspense>
  );
}
