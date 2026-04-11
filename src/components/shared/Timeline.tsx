'use client';

import { useMemo } from 'react';
import type { SimulationTick, Anomaly } from '../../simulation/types';
import { fmtTime } from '../../lib/utils';

interface TimelineProps {
  totalSeconds: number;
  currentSecond: number;
  ticks: SimulationTick[];
  anomalies: Anomaly[];
  onSeek: (second: number) => void;
}

export function Timeline({ totalSeconds, currentSecond, ticks, anomalies, onSeek }: TimelineProps) {
  // Mini goodput sparkline data
  const sparkline = useMemo(() => {
    if (ticks.length === 0) return [];
    const max = Math.max(...ticks.map(t => t.goodput_Mbps), 1);
    return ticks.map(t => ({
      second: t.second,
      height: (t.goodput_Mbps / max) * 100,
      health: t.systemHealth,
    }));
  }, [ticks]);

  return (
    <div className="panel py-2 px-4">
      {/* Sparkline minimap */}
      <div className="relative h-12 mb-1 bg-slate-800 rounded overflow-hidden">
        {/* Goodput bars */}
        <div className="absolute inset-0 flex items-end">
          {sparkline.map((s) => (
            <div
              key={s.second}
              className="flex-1 min-w-0"
              style={{
                height: `${s.height}%`,
                backgroundColor:
                  s.health === 'critical' ? 'var(--danger)' :
                  s.health === 'degraded' ? 'var(--warning)' :
                  'var(--accent)',
                opacity: s.second === currentSecond ? 1 : 0.6,
              }}
            />
          ))}
        </div>

        {/* Anomaly markers */}
        {anomalies.filter(a => a.severity === 'severe').map((a) => (
          <div
            key={a.id}
            data-testid={`anomaly-marker-${a.id}`}
            className="absolute top-0 w-0.5 h-full bg-red-500 opacity-80 cursor-pointer"
            style={{ left: `${(a.time_s / totalSeconds) * 100}%` }}
            title={a.description}
            onClick={() => onSeek(a.time_s)}
          />
        ))}

        {/* Current position indicator */}
        <div
          className="absolute top-0 w-0.5 h-full bg-white z-10"
          style={{ left: `${(currentSecond / totalSeconds) * 100}%` }}
        />
      </div>

      {/* Slider */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-500 w-12">{fmtTime(0)}</span>
        <input
          type="range"
          data-testid="slider-timeline"
          aria-label="Timeline position"
          min="0"
          max={totalSeconds}
          value={currentSecond}
          onChange={(e) => onSeek(parseInt(e.target.value, 10))}
          className="flex-1 accent-cyan-500"
        />
        <span className="text-xs text-slate-500 w-12 text-right">{fmtTime(totalSeconds)}</span>
      </div>
    </div>
  );
}
