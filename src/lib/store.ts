import { create } from 'zustand';
import type { SimulationResult, SimulationTick, FaultScenario, PacketRecord } from '../simulation/types';

interface SimulationStore {
  // Simulation state
  status: 'idle' | 'running' | 'complete' | 'error';
  result: SimulationResult | null;
  error: string | null;

  // Playback state
  currentSecond: number;
  isPlaying: boolean;
  playbackSpeed: number; // 1x, 2x, 5x, 10x

  // View state
  activeView: 'satellite' | 'ground-station' | 'causality';
  activeSubsystemTab: 'antenna' | 'rf-chain' | 'thermal' | 'power' | 'link-budget' | 'protocol';

  // Config
  scenario: FaultScenario;
  rainAttenuation_dB: number;

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
}

export const useSimulationStore = create<SimulationStore>((set, get) => ({
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
    set({ status: 'running', error: null, scenario: sc });

    try {
      // Dynamic import to avoid SSR issues with satellite.js
      const { runSimulation } = await import('../simulation/engine');
      const result = runSimulation({
        faultScenario: sc,
        rainAttenuation_dB: get().rainAttenuation_dB,
      });
      set({ status: 'complete', result, currentSecond: 0 });
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },

  setCurrentSecond: (s: number) => {
    const { result } = get();
    if (!result) return;
    const clamped = Math.max(0, Math.min(s, result.ticks.length - 1));
    set({ currentSecond: clamped });
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

  setRainAttenuation: (dB) => set({ rainAttenuation_dB: dB }),
}));
