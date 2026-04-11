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
  // Simulation state
  status: 'idle' | 'running' | 'complete' | 'error';
  result: SimulationResult | null;
  error: string | null;

  // Playback state
  currentSecond: number;
  isPlaying: boolean;
  playbackSpeed: number;

  // View state
  activeView: 'satellite' | 'ground-station' | 'causality';
  activeSubsystemTab: 'antenna' | 'rf-chain' | 'thermal' | 'power' | 'link-budget' | 'protocol';

  // Config
  scenario: FaultScenario;
  rainAttenuation_dB: number;
  config: SimConfig;
  showConfig: boolean;

  // Derived state helpers
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
  rainAttenuation_dB: 0,
  showConfig: false,
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
    set({ status: 'running', error: null, scenario: sc, rainAttenuation_dB: cfg.rainAttenuation_dB });

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
    set({ rainAttenuation_dB: dB });
    set((s) => ({ config: { ...s.config, rainAttenuation_dB: dB } }));
  },
  toggleConfig: () => set((s) => ({ showConfig: !s.showConfig })),
  updateConfig: (updates) => set((s) => ({ config: { ...s.config, ...updates } })),
}),
  {
    name: 'starlink-sim-config',
    // Only persist user config and preferences — NOT the simulation result
    partialize: (state) => ({
      scenario: state.scenario,
      rainAttenuation_dB: state.rainAttenuation_dB,
      config: state.config,
      playbackSpeed: state.playbackSpeed,
      activeView: state.activeView,
    }),
  },
));
