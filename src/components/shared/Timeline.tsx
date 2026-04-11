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

  const passMarkers = useMemo(() => {
    if (ticks.length === 0) return null;
    let aos = -1, los = -1, tca = -1;
    let maxGoodput = 0;
    for (let i = 0; i < ticks.length; i++) {
      if (ticks[i].goodput_Mbps > 0) {
        if (aos === -1) aos = i;
        los = i;
        if (ticks[i].goodput_Mbps > maxGoodput) {
          maxGoodput = ticks[i].goodput_Mbps;
          tca = i;
        }
      }
    }
    if (aos === -1) return null;
    return { aos, tca, los };
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

        {/* AOS / TCA / LOS markers */}
        {passMarkers && (
          <>
            <div className="absolute top-0 bottom-0 w-px z-10" style={{ left: `${(passMarkers.aos / totalSeconds) * 100}%`, background: '#22c55e' }}>
              <span className="absolute -top-0.5 -translate-x-1/2 text-[8px] font-mono font-semibold" style={{ color: '#22c55e' }}>AOS</span>
            </div>
            <div className="absolute top-0 bottom-0 w-px z-10" style={{ left: `${(passMarkers.tca / totalSeconds) * 100}%`, background: '#00e5ff' }}>
              <span className="absolute -top-0.5 -translate-x-1/2 text-[8px] font-mono font-semibold" style={{ color: '#00e5ff' }}>TCA</span>
            </div>
            <div className="absolute top-0 bottom-0 w-px z-10" style={{ left: `${(passMarkers.los / totalSeconds) * 100}%`, background: '#f97316' }}>
              <span className="absolute -top-0.5 -translate-x-1/2 text-[8px] font-mono font-semibold" style={{ color: '#f97316' }}>LOS</span>
            </div>
          </>
        )}

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
        className="w-full h-1.5 accent-[var(--accent)] cursor-pointer"
      />
    </div>
  );
}
