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
  { value: 'clean', label: 'Clean' },
  { value: 'degraded', label: 'Degraded' },
  { value: 'stressed', label: 'Stressed' },
  { value: 'failing', label: 'Failing' },
];

export function Controls(props: ControlsProps) {
  return (
    <div className="flex items-center gap-3">
      {/* Playback */}
      <div className="flex items-center gap-1">
        {props.isPlaying ? (
          <button data-testid="btn-pause" aria-label="Pause simulation" onClick={props.onPause}
            className="w-7 h-7 flex items-center justify-center rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white hover:border-[var(--border-active)] transition-all text-xs">
            ||
          </button>
        ) : (
          <button data-testid="btn-play" aria-label="Play simulation" onClick={props.onPlay}
            className="w-7 h-7 flex items-center justify-center rounded bg-[var(--accent-soft)] border border-[var(--border-active)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-black transition-all text-xs">
            &#9654;
          </button>
        )}
        <button data-testid="btn-step" aria-label="Step one second" onClick={props.onStep}
          className="w-7 h-7 flex items-center justify-center rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-white hover:border-[var(--border-active)] transition-all text-[10px]">
          +1
        </button>
        <button data-testid="btn-reset" aria-label="Reset simulation" onClick={props.onReset}
          className="w-7 h-7 flex items-center justify-center rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-white hover:border-[var(--border-active)] transition-all text-[9px]">
          RST
        </button>
      </div>

      {/* Speed pills */}
      <div className="flex items-center gap-0.5">
        {[1, 2, 5, 10].map((s) => (
          <button key={s} data-testid={`btn-speed-${s}x`} aria-label={`${s}x speed`}
            onClick={() => props.onSpeedChange(s)}
            className={`px-1.5 py-0.5 text-[10px] rounded transition-all ${
              props.playbackSpeed === s
                ? 'bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--border-active)]'
                : 'text-[var(--text-dim)] hover:text-[var(--text-secondary)] border border-transparent'
            }`}>
            {s}x
          </button>
        ))}
      </div>

      <div className="w-px h-4 bg-[var(--border-subtle)]" />

      {/* Scenario segments */}
      <div className="flex items-center gap-0.5" role="radiogroup">
        <select
          data-testid="select-scenario"
          aria-label="Fault scenario"
          value={props.scenario}
          onChange={(e) => props.onScenarioChange(e.target.value as FaultScenario)}
          className="bg-[var(--bg-elevated)] text-[var(--text-secondary)] rounded px-2 py-1 text-[11px] border border-[var(--border-subtle)] focus:border-[var(--border-active)] outline-none appearance-none cursor-pointer"
          style={{ backgroundImage: 'none' }}
        >
          {SCENARIOS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Rain */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-[var(--text-dim)]">RAIN</span>
        <input type="range" data-testid="slider-rain" aria-label="Rain attenuation"
          min="0" max="5" step="0.5" value={props.rainAttenuation}
          onChange={(e) => props.onRainChange(parseFloat(e.target.value))}
          className="w-14 h-1 accent-[var(--accent)]" />
        <span className="text-[10px] text-[var(--text-muted)] w-7 metric-value">{props.rainAttenuation.toFixed(1)}</span>
      </div>
    </div>
  );
}
