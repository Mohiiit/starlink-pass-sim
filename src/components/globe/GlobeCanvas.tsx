'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import * as d3 from 'd3';
import { fmt } from '../../lib/utils';

interface GlobeProps {
  satelliteLat: number;
  satelliteLon: number;
  groundStationLat: number;
  groundStationLon: number;
  elevation_deg: number;
  azimuth_deg: number;
  slantRange_km: number;
  orbitPath: [number, number][];
  currentIndex: number;
  systemHealth: 'nominal' | 'degraded' | 'critical';
  goodput_Mbps: number;
}

// Static stars
const STARS: { x: number; y: number; r: number; b: number }[] = [];
for (let i = 0; i < 800; i++) STARS.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.2 + 0.2, b: Math.random() * 0.5 + 0.2 });

// Data transfer particle
interface Particle { progress: number; speed: number; size: number; }

export function GlobeCanvas(props: GlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // Interaction state
  const interactionRef = useRef({
    autoTrack: true,
    isDragging: false,
    lastMouse: { x: 0, y: 0 },
    userRot: { lon: 0, lat: 0 },
    targetRot: { lon: 0, lat: 0 },
    zoom: 1.0,
    particles: [] as Particle[],
  });

  const [autoTrack, setAutoTrack] = useState(true);

  // Mouse handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const ir = interactionRef.current;
    ir.isDragging = true;
    ir.lastMouse = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const ir = interactionRef.current;
    if (!ir.isDragging) return;
    const dx = e.clientX - ir.lastMouse.x;
    const dy = e.clientY - ir.lastMouse.y;
    ir.lastMouse = { x: e.clientX, y: e.clientY };
    ir.userRot.lon -= dx * 0.4;
    ir.userRot.lat += dy * 0.4;
    ir.userRot.lat = Math.max(-80, Math.min(80, ir.userRot.lat));
    if (ir.autoTrack) {
      ir.autoTrack = false;
      setAutoTrack(false);
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    interactionRef.current.isDragging = false;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const ir = interactionRef.current;
    ir.zoom = Math.max(0.5, Math.min(3.0, ir.zoom * (1 - e.deltaY * 0.001)));
  }, []);

  const toggleAutoTrack = useCallback(() => {
    const ir = interactionRef.current;
    ir.autoTrack = !ir.autoTrack;
    setAutoTrack(ir.autoTrack);
  }, []);

  // Animation loop
  useEffect(() => {
    let animId: number;
    let prevW = 0, prevH = 0;

    function render() {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) { animId = requestAnimationFrame(render); return; }

      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      const w = rect.width, h = rect.height;
      if (w < 10 || h < 10) { animId = requestAnimationFrame(render); return; }
      if (w !== prevW || h !== prevH) {
        canvas.width = w * dpr; canvas.height = h * dpr;
        canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
        prevW = w; prevH = h;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const p = propsRef.current;
      const ir = interactionRef.current;
      const cx = w / 2, cy = h / 2;
      const baseRadius = Math.min(w, h) * 0.38;
      const radius = baseRadius * ir.zoom;
      const now = Date.now();

      // ---- Rotation ----
      if (ir.autoTrack) {
        ir.targetRot.lon = -p.satelliteLon;
        ir.targetRot.lat = -p.satelliteLat * 0.5;
        ir.userRot.lon += (ir.targetRot.lon - ir.userRot.lon) * 0.06;
        ir.userRot.lat += (ir.targetRot.lat - ir.userRot.lat) * 0.06;
      }

      const projection = d3.geoOrthographic()
        .translate([cx, cy])
        .scale(radius)
        .rotate([ir.userRot.lon, ir.userRot.lat])
        .clipAngle(90);

      const pathGen = d3.geoPath(projection, ctx);

      // ---- Clear ----
      ctx.clearRect(0, 0, w, h);

      // ---- Stars ----
      for (const s of STARS) {
        const sx = s.x * w, sy = s.y * h;
        if (Math.sqrt((sx - cx) ** 2 + (sy - cy) ** 2) < radius + 4) continue;
        const flicker = s.b + 0.08 * Math.sin(now * 0.001 + s.x * 100);
        ctx.fillStyle = `rgba(180,200,240,${flicker})`;
        ctx.beginPath(); ctx.arc(sx, sy, s.r, 0, Math.PI * 2); ctx.fill();
      }

      // ---- Atmosphere glow ----
      const aGlow = ctx.createRadialGradient(cx, cy, radius * 0.94, cx, cy, radius * 1.15);
      aGlow.addColorStop(0, 'rgba(0,180,255,0.07)');
      aGlow.addColorStop(0.5, 'rgba(0,140,255,0.03)');
      aGlow.addColorStop(1, 'rgba(0,100,255,0)');
      ctx.fillStyle = aGlow;
      ctx.beginPath(); ctx.arc(cx, cy, radius * 1.15, 0, Math.PI * 2); ctx.fill();

      // ---- Earth ----
      const eGrad = ctx.createRadialGradient(cx - radius * 0.2, cy - radius * 0.2, radius * 0.05, cx + radius * 0.1, cy + radius * 0.1, radius);
      eGrad.addColorStop(0, '#14233a'); eGrad.addColorStop(0.5, '#0e1a2e'); eGrad.addColorStop(1, '#070d1a');
      ctx.fillStyle = eGrad;
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();

      // Rim
      ctx.strokeStyle = 'rgba(60,160,255,0.12)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();

      // ---- Graticule ----
      const graticule = d3.geoGraticule().step([30, 30])();
      ctx.beginPath(); pathGen(graticule as any);
      ctx.strokeStyle = 'rgba(60,160,255,0.05)'; ctx.lineWidth = 0.5; ctx.stroke();

      // Equator
      const eq: any = { type: 'LineString', coordinates: Array.from({ length: 73 }, (_, i) => [i * 5 - 180, 0]) };
      ctx.beginPath(); pathGen(eq);
      ctx.strokeStyle = 'rgba(60,160,255,0.1)'; ctx.lineWidth = 0.7; ctx.stroke();

      // ---- Orbit path ----
      if (p.orbitPath.length > 2) {
        if (p.currentIndex < p.orbitPath.length - 1) {
          ctx.beginPath();
          pathGen({ type: 'LineString', coordinates: p.orbitPath.slice(p.currentIndex) } as any);
          ctx.setLineDash([3, 5]); ctx.strokeStyle = 'rgba(0,229,255,0.12)'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
        }
        if (p.currentIndex > 0) {
          ctx.beginPath();
          pathGen({ type: 'LineString', coordinates: p.orbitPath.slice(Math.max(0, p.currentIndex - 60), p.currentIndex + 1) } as any);
          ctx.strokeStyle = 'rgba(0,229,255,0.35)'; ctx.lineWidth = 2; ctx.stroke();
        }
      }

      // ---- Beam footprint ----
      if (p.elevation_deg > 5) {
        const footR = Math.min(15, Math.max(0.5, 2.5 / Math.sin(Math.max(0.1, p.elevation_deg * Math.PI / 180))));
        const fp = d3.geoCircle().center([p.groundStationLon, p.groundStationLat]).radius(footR)();
        ctx.beginPath(); pathGen(fp as any);
        ctx.fillStyle = 'rgba(0,229,255,0.03)'; ctx.fill();
        ctx.strokeStyle = 'rgba(0,229,255,0.1)'; ctx.lineWidth = 0.5; ctx.stroke();
      }

      // ---- Ground station ----
      const gsP = projection([p.groundStationLon, p.groundStationLat]);
      if (gsP) {
        const [gx, gy] = gsP;
        const pr = 1 + 0.4 * Math.sin(now * 0.002);
        ctx.strokeStyle = 'rgba(34,197,94,0.25)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(gx, gy, 10 * pr, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(34,197,94,0.7)'; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(gx - 7, gy); ctx.lineTo(gx + 7, gy);
        ctx.moveTo(gx, gy - 7); ctx.lineTo(gx, gy + 7);
        ctx.stroke();
        ctx.fillStyle = '#22c55e';
        ctx.beginPath(); ctx.arc(gx, gy, 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(34,197,94,0.5)'; ctx.font = '9px monospace';
        ctx.fillText('GND', gx + 11, gy + 3);
      }

      // ---- Satellite ----
      const satP = projection([p.satelliteLon, p.satelliteLat]);
      if (satP) {
        const [sx, sy] = satP;
        const hc = p.systemHealth === 'critical' ? [239, 68, 68]
          : p.systemHealth === 'degraded' ? [245, 158, 11]
          : [0, 229, 255];

        // ---- DATA TRANSFER PARTICLES ----
        if (gsP && p.elevation_deg > 0 && p.goodput_Mbps > 0) {
          // Spawn particles proportional to goodput
          const spawnRate = Math.min(2.5, p.goodput_Mbps / 120);
          for (let i = 0; i < Math.floor(spawnRate); i++) {
            ir.particles.push({ progress: 0, speed: 0.012 + Math.random() * 0.008, size: 1 + Math.random() * 1.5 });
          }
          if (Math.random() < (spawnRate % 1)) {
            ir.particles.push({ progress: 0, speed: 0.012 + Math.random() * 0.008, size: 1 + Math.random() * 1.5 });
          }

          // Advance & render particles
          const [gx, gy] = gsP;
          ir.particles = ir.particles.filter(pt => {
            pt.progress += pt.speed;
            if (pt.progress >= 1) return false;
            const px = sx + (gx - sx) * pt.progress;
            const py = sy + (gy - sy) * pt.progress;
            const alpha = pt.progress < 0.1 ? pt.progress * 10 : pt.progress > 0.85 ? (1 - pt.progress) * 6.67 : 1;
            ctx.fillStyle = `rgba(${hc[0]},${hc[1]},${hc[2]},${alpha * 0.6})`;
            ctx.beginPath(); ctx.arc(px, py, pt.size, 0, Math.PI * 2); ctx.fill();
            return true;
          });

          // Beam line (behind particles)
          const bg = ctx.createLinearGradient(sx, sy, gx, gy);
          bg.addColorStop(0, `rgba(${hc[0]},${hc[1]},${hc[2]},0.2)`);
          bg.addColorStop(0.5, `rgba(${hc[0]},${hc[1]},${hc[2]},0.08)`);
          bg.addColorStop(1, 'rgba(34,197,94,0.15)');
          ctx.strokeStyle = bg; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(gx, gy); ctx.stroke();
        } else {
          ir.particles = [];
        }

        // Satellite glow
        const gs = 20 + 4 * Math.sin(now * 0.004);
        const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, gs);
        sg.addColorStop(0, `rgba(${hc[0]},${hc[1]},${hc[2]},0.5)`);
        sg.addColorStop(0.3, `rgba(${hc[0]},${hc[1]},${hc[2]},0.12)`);
        sg.addColorStop(1, `rgba(${hc[0]},${hc[1]},${hc[2]},0)`);
        ctx.fillStyle = sg;
        ctx.beginPath(); ctx.arc(sx, sy, gs, 0, Math.PI * 2); ctx.fill();

        // Satellite dot
        ctx.fillStyle = `rgb(${hc[0]},${hc[1]},${hc[2]})`;
        ctx.shadowColor = `rgb(${hc[0]},${hc[1]},${hc[2]})`; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(sx, sy, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;

        ctx.fillStyle = `rgba(${hc[0]},${hc[1]},${hc[2]},0.5)`; ctx.font = '9px monospace';
        ctx.fillText('SAT', sx + 10, sy - 10);
      }

      // ---- Info overlay ----
      ctx.fillStyle = 'rgba(100,140,180,0.45)'; ctx.font = '10px monospace';
      ctx.fillText(`EL ${fmt(p.elevation_deg, 1)}°   RNG ${fmt(p.slantRange_km, 0)} km   AZ ${fmt(p.azimuth_deg, 1)}°`, 14, h - 14);

      // Goodput indicator
      if (p.goodput_Mbps > 0) {
        ctx.fillStyle = 'rgba(0,229,255,0.4)'; ctx.font = '11px monospace';
        ctx.fillText(`↓ ${fmt(p.goodput_Mbps, 0)} Mbps`, 14, h - 30);
      }

      animId = requestAnimationFrame(render);
    }

    render();
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div ref={containerRef} className="globe-container w-full h-full relative select-none"
      onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp} onWheel={handleWheel}
      style={{ cursor: interactionRef.current.isDragging ? 'grabbing' : 'grab' }}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
      {/* Auto-track toggle */}
      <button onClick={toggleAutoTrack}
        className={`absolute top-3 right-3 text-[10px] px-2 py-1 rounded border transition-all ${
          autoTrack
            ? 'bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--border-active)]'
            : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] border-[var(--border-subtle)] hover:text-[var(--text-secondary)]'
        }`}
        title={autoTrack ? 'Auto-tracking satellite (click to disable)' : 'Manual mode (click to auto-track)'}
      >
        {autoTrack ? '◉ TRACKING' : '○ MANUAL'}
      </button>
      {/* Zoom indicator */}
      <div className="absolute bottom-3 right-3 text-[9px] text-[var(--text-dim)] font-mono">
        {interactionRef.current.zoom !== 1 ? `${(interactionRef.current.zoom * 100).toFixed(0)}%` : ''}
      </div>
    </div>
  );
}
