'use client';

import { useEffect, useRef } from 'react';
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
  orbitPath: [number, number][]; // [lon, lat] pairs
  currentIndex: number;
  systemHealth: 'nominal' | 'degraded' | 'critical';
}

// Precompute star field
const STARS: { x: number; y: number; r: number; b: number }[] = [];
for (let i = 0; i < 800; i++) {
  STARS.push({
    x: Math.random(),
    y: Math.random(),
    r: Math.random() * 1.2 + 0.2,
    b: Math.random() * 0.5 + 0.2,
  });
}

export function GlobeCanvas(props: GlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const rotRef = useRef({ lon: 0, lat: 0 });

  useEffect(() => {
    let animId: number;
    let prevW = 0;
    let prevH = 0;

    function render() {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) { animId = requestAnimationFrame(render); return; }

      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (w !== prevW || h !== prevH) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        prevW = w; prevH = h;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const p = propsRef.current;
      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.min(w, h) * 0.38;
      const now = Date.now();

      // Smooth rotation to track satellite
      const tLon = -p.satelliteLon;
      const tLat = -p.satelliteLat * 0.5; // Slight tilt — don't go fully polar
      rotRef.current.lon += (tLon - rotRef.current.lon) * 0.06;
      rotRef.current.lat += (tLat - rotRef.current.lat) * 0.06;

      const projection = d3.geoOrthographic()
        .translate([cx, cy])
        .scale(radius)
        .rotate([rotRef.current.lon, rotRef.current.lat])
        .clipAngle(90);

      const pathGen = d3.geoPath(projection, ctx);

      // ---- Layer 0: Background ----
      ctx.clearRect(0, 0, w, h);

      // ---- Layer 1: Stars ----
      for (const s of STARS) {
        const sx = s.x * w;
        const sy = s.y * h;
        const d = Math.sqrt((sx - cx) ** 2 + (sy - cy) ** 2);
        if (d < radius + 4) continue; // Behind globe
        const flicker = s.b + 0.1 * Math.sin(now * 0.001 + s.x * 100);
        ctx.fillStyle = `rgba(180, 200, 240, ${flicker})`;
        ctx.beginPath();
        ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // ---- Layer 2: Atmospheric glow ----
      const glow = ctx.createRadialGradient(cx, cy, radius * 0.94, cx, cy, radius * 1.15);
      glow.addColorStop(0, 'rgba(0, 180, 255, 0.07)');
      glow.addColorStop(0.4, 'rgba(0, 140, 255, 0.04)');
      glow.addColorStop(1, 'rgba(0, 100, 255, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 1.15, 0, Math.PI * 2);
      ctx.fill();

      // ---- Layer 3: Earth sphere ----
      const earth = ctx.createRadialGradient(
        cx - radius * 0.2, cy - radius * 0.2, radius * 0.05,
        cx + radius * 0.1, cy + radius * 0.1, radius
      );
      earth.addColorStop(0, '#14233a');
      earth.addColorStop(0.5, '#0e1a2e');
      earth.addColorStop(1, '#070d1a');
      ctx.fillStyle = earth;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      // Rim highlight
      ctx.strokeStyle = 'rgba(60, 160, 255, 0.12)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();

      // ---- Layer 4: Graticule ----
      const graticule = d3.geoGraticule().step([30, 30])();
      ctx.beginPath();
      pathGen(graticule as any);
      ctx.strokeStyle = 'rgba(60, 160, 255, 0.05)';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // Equator slightly brighter
      const eq: GeoJSON.LineString = {
        type: 'LineString',
        coordinates: Array.from({ length: 73 }, (_, i) => [i * 5 - 180, 0]),
      };
      ctx.beginPath();
      pathGen(eq as any);
      ctx.strokeStyle = 'rgba(60, 160, 255, 0.1)';
      ctx.lineWidth = 0.7;
      ctx.stroke();

      // ---- Layer 5: Orbit path ----
      if (p.orbitPath.length > 2) {
        // Future path (dashed, dim)
        if (p.currentIndex < p.orbitPath.length - 1) {
          const future: GeoJSON.LineString = {
            type: 'LineString',
            coordinates: p.orbitPath.slice(p.currentIndex),
          };
          ctx.beginPath();
          pathGen(future as any);
          ctx.setLineDash([3, 5]);
          ctx.strokeStyle = 'rgba(0, 229, 255, 0.12)';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Past path (solid, bright)
        if (p.currentIndex > 0) {
          const past: GeoJSON.LineString = {
            type: 'LineString',
            coordinates: p.orbitPath.slice(0, p.currentIndex + 1),
          };
          ctx.beginPath();
          pathGen(past as any);
          ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      // ---- Layer 6: Beam footprint ----
      if (p.elevation_deg > 5) {
        const footR = Math.max(0.5, 2.5 / Math.sin(Math.max(0.1, p.elevation_deg * Math.PI / 180)));
        const footprint = d3.geoCircle()
          .center([p.groundStationLon, p.groundStationLat])
          .radius(Math.min(footR, 15))();
        ctx.beginPath();
        pathGen(footprint as any);
        ctx.fillStyle = 'rgba(0, 229, 255, 0.03)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.1)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      // ---- Layer 7: Ground station ----
      const gsP = projection([p.groundStationLon, p.groundStationLat]);
      if (gsP) {
        const [gx, gy] = gsP;

        // Pulse ring
        const pr = 1 + 0.4 * Math.sin(now * 0.002);
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(gx, gy, 10 * pr, 0, Math.PI * 2);
        ctx.stroke();

        // Crosshair
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(gx - 7, gy); ctx.lineTo(gx + 7, gy);
        ctx.moveTo(gx, gy - 7); ctx.lineTo(gx, gy + 7);
        ctx.stroke();

        // Center dot
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.arc(gx, gy, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // ---- Layer 8: Satellite + beam ----
      const satP = projection([p.satelliteLon, p.satelliteLat]);
      if (satP) {
        const [sx, sy] = satP;

        // Beam line
        if (gsP && p.elevation_deg > 0) {
          const bg = ctx.createLinearGradient(sx, sy, gsP[0], gsP[1]);
          bg.addColorStop(0, 'rgba(0, 229, 255, 0.35)');
          bg.addColorStop(0.5, 'rgba(0, 229, 255, 0.15)');
          bg.addColorStop(1, 'rgba(34, 197, 94, 0.2)');
          ctx.strokeStyle = bg;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(gsP[0], gsP[1]);
          ctx.stroke();
        }

        // Health color
        const hc = p.systemHealth === 'critical' ? [239, 68, 68]
          : p.systemHealth === 'degraded' ? [245, 158, 11]
          : [0, 229, 255];

        // Outer glow
        const gs = 20 + 4 * Math.sin(now * 0.004);
        const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, gs);
        sg.addColorStop(0, `rgba(${hc[0]},${hc[1]},${hc[2]},0.5)`);
        sg.addColorStop(0.3, `rgba(${hc[0]},${hc[1]},${hc[2]},0.12)`);
        sg.addColorStop(1, `rgba(${hc[0]},${hc[1]},${hc[2]},0)`);
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.arc(sx, sy, gs, 0, Math.PI * 2);
        ctx.fill();

        // Inner dot
        ctx.fillStyle = `rgb(${hc[0]},${hc[1]},${hc[2]})`;
        ctx.shadowColor = `rgb(${hc[0]},${hc[1]},${hc[2]})`;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // ---- Layer 9: Info overlay (rendered on canvas) ----
      ctx.fillStyle = 'rgba(100, 140, 180, 0.5)';
      ctx.font = '10px monospace';
      const infoY = h - 16;
      ctx.fillText(
        `EL ${fmt(p.elevation_deg, 1)}°   RNG ${fmt(p.slantRange_km, 0)} km   AZ ${fmt(p.azimuth_deg, 1)}°`,
        14, infoY,
      );

      animId = requestAnimationFrame(render);
    }

    render();
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div ref={containerRef} className="globe-container w-full h-full">
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
}
