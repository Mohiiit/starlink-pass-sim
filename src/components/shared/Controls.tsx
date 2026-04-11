'use client';

import type { FaultScenario } from '../../simulation/types';

interface ControlsProps {
  scenario: FaultScenario;
  onScenarioChange: (s: FaultScenario) => void;
  rainAttenuation: number;
  onRainChange: (dB: number) => void;
  isPlaying: boolean;
  playbackSpeed: number;
  onPlay: () => void;
  onPause: () => void;
  onReset: () => void;
  onStep: () => void;
  onSpeedChange: (speed: number) => void;
}

const SCENARIOS: { value: FaultScenario; label: string }[] = [
  { value: 'clean', label: 'Clean Pass' },
  { value: 'degraded', label: 'Degraded' },
  { value: 'stressed', label: 'Stressed' },
  { value: 'failing', label: 'Failing' },
];

export function Controls(props: ControlsProps) {
  return (
    <div className="flex items-center gap-4 flex-wrap panel py-2 px-4">
      {/* Playback controls */}
      <div className="flex items-center gap-2">
        {props.isPlaying ? (
          <button
            data-testid="btn-pause"
            aria-label="Pause simulation"
            onClick={props.onPause}
            className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 rounded text-sm transition-colors"
          >
            Pause
          </button>
        ) : (
          <button
            data-testid="btn-play"
            aria-label="Play simulation"
            onClick={props.onPlay}
            className="px-3 py-1.5 bg-cyan-700 hover:bg-cyan-600 rounded text-sm transition-colors"
          >
            Play
          </button>
        )}
        <button
          data-testid="btn-step"
          aria-label="Step one second"
          onClick={props.onStep}
          className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 rounded text-sm transition-colors"
        >
          Step
        </button>
        <button
          data-testid="btn-reset"
          aria-label="Reset simulation"
          onClick={props.onReset}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm transition-colors"
        >
          Reset
        </button>
      </div>

      {/* Speed selector */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-slate-500">Speed:</span>
        {[1, 2, 5, 10].map((s) => (
          <button
            key={s}
            data-testid={`btn-speed-${s}x`}
            aria-label={`Playback speed ${s}x`}
            onClick={() => props.onSpeedChange(s)}
            className={`px-2 py-1 rounded text-xs transition-colors ${
              props.playbackSpeed === s
                ? 'bg-cyan-700 text-white'
                : 'bg-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            {s}x
          </button>
        ))}
      </div>

      <div className="w-px h-6 bg-slate-600" />

      {/* Scenario selector */}
      <div className="flex items-center gap-2 text-sm">
        <label htmlFor="scenario-select" className="text-slate-500">Scenario:</label>
        <select
          id="scenario-select"
          data-testid="select-scenario"
          aria-label="Fault scenario"
          value={props.scenario}
          onChange={(e) => props.onScenarioChange(e.target.value as FaultScenario)}
          className="bg-slate-700 text-slate-200 rounded px-2 py-1 text-sm border border-slate-600"
        >
          {SCENARIOS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Rain slider */}
      <div className="flex items-center gap-2 text-sm">
        <label htmlFor="rain-slider" className="text-slate-500">Rain:</label>
        <input
          id="rain-slider"
          type="range"
          data-testid="slider-rain"
          aria-label="Rain attenuation"
          min="0"
          max="5"
          step="0.5"
          value={props.rainAttenuation}
          onChange={(e) => props.onRainChange(parseFloat(e.target.value))}
          className="w-20 accent-cyan-500"
        />
        <span className="text-slate-400 w-12">{props.rainAttenuation.toFixed(1)} dB</span>
      </div>
    </div>
  );
}
