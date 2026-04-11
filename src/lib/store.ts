import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SimulationResult, SimulationTick, FaultScenario, FaultEvent, PacketRecord } from '../simulation/types';
import { DEFAULT_GROUND_STATION, ELEVATION_MASK_DEG } from './constants';

export interface SimConfig {
  groundStation: { name: string; lat: number; lon: number };
  initialBatterySoC: number;
  elevationMask_deg: number;
  rainAttenuation_dB: number;
  customFaults: FaultEvent[];
}

interface SimulationStore {
  status: 'idle' | 'running' | 'complete' | 'error';
  result: SimulationResult | null;
  error: string | null;
  currentSecond: number;
  isPlaying: boolean;
  playbackSpeed: number;
  activeView: 'satellite' | 'ground-station' | 'causality';
  activeSubsystemTab: 'antenna' | 'rf-chain' | 'thermal' | 'power' | 'link-budget' | 'protocol';
  scenario: FaultScenario;
  config: SimConfig;
  showConfig: boolean;
  _hydrated: boolean;

  // Derived
  currentTick: () => SimulationTick | null;
  packetsForCurrentSecond: () => PacketRecord[];

  // Actions
  runSimulation: (scenario?: FaultScenario) => void;
  setCurrentSecond: (s: number) => void;
  play: () => void;
  pause: () => void;
  reset: () => void;
  step: () => void;
  setPlaybackSpeed: (speed: number) => void;
  setActiveView: (view: 'satellite' | 'ground-station' | 'causality') => void;
  setActiveSubsystemTab: (tab: string) => void;
  setScenario: (scenario: FaultScenario) => void;
  setRainAttenuation: (dB: number) => void;
  toggleConfig: () => void;
  updateConfig: (updates: Partial<SimConfig>) => void;
}

export const useSimulationStore = create<SimulationStore>()(
  persist(
    (set, get) => ({
      status: 'idle',
      result: null,
      error: null,
      currentSecond: 0,
      isPlaying: false,
      playbackSpeed: 1,
      activeView: 'satellite',
      activeSubsystemTab: 'antenna',
      scenario: 'clean',
      showConfig: false,
      _hydrated: false,
      config: {
        groundStation: { ...DEFAULT_GROUND_STATION },
        initialBatterySoC: 80,
        elevationMask_deg: ELEVATION_MASK_DEG,
        rainAttenuation_dB: 0,
        customFaults: [],
      },

      currentTick: () => {
        const { result, currentSecond } = get();
        if (!result) return null;
        return result.ticks[currentSecond] ?? null;
      },

      packetsForCurrentSecond: () => {
        const { result, currentSecond } = get();
        if (!result) return [];
        return result.packetTrace.filter(p => p.secondIntoPass === currentSecond);
      },

      runSimulation: async (scenario?: FaultScenario) => {
        const sc = scenario ?? get().scenario;
        const cfg = get().config;
        set({ status: 'running', error: null, scenario: sc });

        // Yield to let React render 'running' status before the heavy compute
        await new Promise(r => setTimeout(r, 10));

        try {
          const { runSimulation } = await import('../simulation/engine');
          const result = runSimulation({
            faultScenario: sc,
            rainAttenuation_dB: cfg.rainAttenuation_dB,
            groundStation: { ...cfg.groundStation, alt: 0.01 },
            initialBatterySoC: cfg.initialBatterySoC,
            elevationMask_deg: cfg.elevationMask_deg,
            customFaults: cfg.customFaults.length > 0 ? cfg.customFaults : undefined,
          });
          set({ status: 'complete', result, currentSecond: 0 });
        } catch (e) {
          set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
        }
      },

      setCurrentSecond: (s: number) => {
        const { result } = get();
        if (!result) return;
        set({ currentSecond: Math.max(0, Math.min(s, result.ticks.length - 1)) });
      },

      play: () => set({ isPlaying: true }),
      pause: () => set({ isPlaying: false }),

      reset: () => set({
        currentSecond: 0,
        isPlaying: false,
        status: 'idle',
        result: null,
        error: null,
      }),

      step: () => {
        const { currentSecond, result } = get();
        if (!result) return;
        if (currentSecond < result.ticks.length - 1) {
          set({ currentSecond: currentSecond + 1 });
        } else {
          set({ isPlaying: false });
        }
      },

      setPlaybackSpeed: (speed: number) => set({ playbackSpeed: speed }),
      setActiveView: (view) => set({ activeView: view }),
      setActiveSubsystemTab: (tab) =>
        set({ activeSubsystemTab: tab as SimulationStore['activeSubsystemTab'] }),
      setScenario: (scenario) => set({ scenario }),
      setRainAttenuation: (dB) => {
        // Single source of truth: config.rainAttenuation_dB
        set((s) => ({ config: { ...s.config, rainAttenuation_dB: dB } }));
      },
      toggleConfig: () => set((s) => ({ showConfig: !s.showConfig })),
      updateConfig: (updates) => set((s) => ({ config: { ...s.config, ...updates } })),
    }),
    {
      name: 'starlink-sim-config',
      partialize: (state) => ({
        scenario: state.scenario,
        config: state.config,
        playbackSpeed: state.playbackSpeed,
        activeView: state.activeView,
      }),
      onRehydrateStorage: () => {
        return () => {
          // Mark hydration complete — page.tsx waits for this before auto-running
          useSimulationStore.setState({ _hydrated: true });
        };
      },
    },
  ),
);
