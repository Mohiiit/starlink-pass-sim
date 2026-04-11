'use client';

import { useMemo, useCallback, useRef } from 'react';
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
  const trackRef = useRef<HTMLDivElement>(null);

  const bars = useMemo(() => {
    if (ticks.length === 0) return [];
    const maxGoodput = Math.max(...ticks.map(t => t.goodput_Mbps), 1);
    return ticks.map(t => ({
      h: (t.goodput_Mbps / maxGoodput) * 100,
      health: t.systemHealth,
    }));
  }, [ticks]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    onSeek(Math.round(x * totalSeconds));
  }, [totalSeconds, onSeek]);

  const pct = totalSeconds > 0 ? (currentSecond / totalSeconds) * 100 : 0;

  return (
    <div className="space-y-1">
      {/* Track */}
      <div ref={trackRef} className="timeline-track" onClick={handleClick}>
        {/* Goodput bars */}
        <div className="absolute inset-0 flex items-end px-px">
          {bars.map((b, i) => (
            <div key={i} className="timeline-bar flex-1"
              style={{
                height: `${b.h}%`,
                background: b.health === 'critical' ? 'var(--danger)'
                  : b.health === 'degraded' ? 'var(--warning)'
                  : 'var(--accent)',
                opacity: Math.abs(i - currentSecond) < 3 ? 0.7 : 0.35,
              }}
            />
          ))}
        </div>

        {/* Anomaly flags */}
        {anomalies.filter(a => a.severity === 'severe').map((a) => (
          <div key={a.id} data-testid={`anomaly-marker-${a.id}`}
            className="absolute top-0 bottom-0 w-px bg-[var(--danger)] opacity-60 z-5"
            style={{ left: `${(a.time_s / totalSeconds) * 100}%` }}
            title={a.description}
          />
        ))}

        {/* Cursor */}
        <div className="timeline-cursor" style={{ left: `${pct}%` }} />

        {/* Time labels */}
        <div className="absolute top-1 left-2 text-[9px] text-[var(--text-dim)] font-mono">{fmtTime(0)}</div>
        <div className="absolute top-1 right-2 text-[9px] text-[var(--text-dim)] font-mono">{fmtTime(totalSeconds)}</div>
      </div>

      {/* Slider (hidden visually, for accessibility & agent-browser) */}
      <input type="range" data-testid="slider-timeline" aria-label="Timeline position"
        min="0" max={totalSeconds} value={currentSecond}
        onChange={(e) => onSeek(parseInt(e.target.value, 10))}
        className="w-full h-1 accent-[var(--accent)] opacity-0 absolute pointer-events-none"
        style={{ marginTop: -10 }}
      />
    </div>
  );
}
