'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface TourStep {
  target: string | null;         // data-testid or CSS selector, null = centered modal
  title: string;
  description: string;
  position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  action?: string;               // hint text like "Try clicking this!"
}

const TOUR_STEPS: TourStep[] = [
  {
    target: null,
    title: 'Welcome to the Starlink Pass Simulator',
    description: 'This tool simulates a real satellite passing over a ground station — with every subsystem modeled from hardware up. Throughput, modulation, and packet loss all emerge from the spacecraft\'s internal state. Let\'s walk through the interface.',
    position: 'center',
  },
  {
    target: '.globe-container, [class*="globe"], canvas',
    title: '3D Orbital View',
    description: 'The satellite (cyan glow) orbits above the Earth while transmitting to the ground station (green dot). The beam cone shows the active downlink. Data particles stream along the beam proportional to throughput.',
    action: 'Drag to rotate the globe, scroll to zoom in/out.',
    position: 'right',
  },
  {
    target: '[data-testid="btn-play"]',
    title: 'Playback Controls',
    description: 'Play animates the pass in real-time. Step (+1) advances one second. Speed pills (1x–10x) control playback rate. Reset re-runs the simulation from scratch.',
    action: 'Try clicking Play to watch the satellite fly over!',
    position: 'bottom',
  },
  {
    target: '[data-testid="select-scenario"]',
    title: 'Fault Scenarios',
    description: 'Each scenario models a different satellite health state:\n\n• Clean — perfect hardware\n• Degraded — aging components, mild drift\n• Stressed — multiple faults, solar damage\n• Failing — thermal runaway, PLL unlock, element failures\n\nThe throughput impact emerges from actual hardware degradation.',
    action: 'Switch to "Failing" to see a dramatic throughput collapse.',
    position: 'bottom',
  },
  {
    target: '[data-testid="metric-goodput"]',
    title: 'Key Metrics',
    description: 'Six cards show the most important values: Goodput (actual throughput), SNR (signal quality), Elevation (angle above horizon), PA Temperature, Battery SoC, and Link Margin. Colors change with status — green is nominal, amber is degraded, red is critical.',
    position: 'left',
  },
  {
    target: '[data-testid="tab-satellite"]',
    title: 'Subsystem Inspection',
    description: 'Three views into the simulation:\n\n• Satellite — hardware subsystem gauges (antenna, RF chain, thermal, power, link budget, protocol)\n• Ground Station — Wireshark-style packet inspector with per-packet hardware traces\n• Causality — click any anomaly to see the full causal chain from symptom to hardware root cause',
    action: 'Try the Causality tab during a Failing scenario.',
    position: 'bottom',
  },
  {
    target: '.timeline-track',
    title: 'Pass Timeline',
    description: 'The sparkline shows throughput over the entire pass. The satellite approaches (left), reaches peak elevation (center), then departs (right). Colored markers show AOS (green), TCA (cyan), and LOS (orange). Red flags mark severe anomalies.',
    action: 'Click anywhere on the timeline to jump to that second.',
    position: 'top',
  },
  {
    target: '[data-testid="btn-config"]',
    title: 'Configuration Panel',
    description: 'Change the ground station location (8 presets worldwide), adjust initial battery charge, elevation mask, rain attenuation, or inject custom faults with individual severity and timing controls.',
    action: 'Try switching to Mumbai or Tokyo and re-running!',
    position: 'bottom',
  },
  {
    target: null,
    title: 'You\'re Ready!',
    description: 'Start with the Failing scenario — watch the throughput collapse, then switch to the Causality tab to trace exactly which hardware subsystem caused it. Every packet, every dB, every degree traces back to the satellite\'s internal state.\n\nThis is hardware-first satellite communications.',
    position: 'center',
    action: 'Happy exploring!',
  },
];

const STORAGE_KEY = 'starlink-sim-tour-done';

export function GuidedTour() {
  const [step, setStep] = useState(-1);       // -1 = tour not started
  const [rect, setRect] = useState<DOMRect | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Show tour on first visit
  useEffect(() => {
    const done = localStorage.getItem(STORAGE_KEY);
    if (!done) {
      // Small delay so the page renders first
      const t = setTimeout(() => setStep(0), 1500);
      return () => clearTimeout(t);
    }
  }, []);

  // Find and measure the target element for current step
  useEffect(() => {
    if (step < 0 || step >= TOUR_STEPS.length) { setRect(null); return; }
    const s = TOUR_STEPS[step];
    if (!s.target) { setRect(null); return; }

    // Try multiple selectors (comma-separated)
    const selectors = s.target.split(',').map(s => s.trim());
    let el: Element | null = null;
    for (const sel of selectors) {
      el = document.querySelector(sel);
      if (el) break;
    }

    if (el) {
      const r = el.getBoundingClientRect();
      setRect(r);
    } else {
      setRect(null);
    }
  }, [step]);

  const next = useCallback(() => {
    if (step < TOUR_STEPS.length - 1) setStep(step + 1);
    else finish();
  }, [step]);

  const prev = useCallback(() => {
    if (step > 0) setStep(step - 1);
  }, [step]);

  const finish = useCallback(() => {
    setStep(-1);
    localStorage.setItem(STORAGE_KEY, 'true');
  }, []);

  // Public: re-trigger tour
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__restartTour = () => {
      localStorage.removeItem(STORAGE_KEY);
      setStep(0);
    };
  }, []);

  if (step < 0 || step >= TOUR_STEPS.length) return null;

  const s = TOUR_STEPS[step];
  const isCenter = !s.target || !rect;
  const pad = 12; // padding around spotlight

  // Position the tooltip near the target
  let tooltipStyle: React.CSSProperties = {};
  if (isCenter) {
    tooltipStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  } else if (rect) {
    const pos = s.position || 'bottom';
    if (pos === 'bottom') {
      tooltipStyle = { top: rect.bottom + 16, left: Math.max(16, rect.left), maxWidth: 380 };
    } else if (pos === 'top') {
      tooltipStyle = { bottom: window.innerHeight - rect.top + 16, left: Math.max(16, rect.left), maxWidth: 380 };
    } else if (pos === 'right') {
      tooltipStyle = { top: Math.max(16, rect.top), left: rect.right + 16, maxWidth: 360 };
    } else if (pos === 'left') {
      tooltipStyle = { top: Math.max(16, rect.top), right: window.innerWidth - rect.left + 16, maxWidth: 360 };
    }
  }

  return (
    <div ref={overlayRef} className="fixed inset-0 z-[9999]" data-testid="guided-tour">
      {/* Dark overlay with spotlight cutout */}
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
        <defs>
          <mask id="tour-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {rect && (
              <rect
                x={rect.left - pad} y={rect.top - pad}
                width={rect.width + pad * 2} height={rect.height + pad * 2}
                rx="10" fill="black"
              />
            )}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,0.7)" mask="url(#tour-mask)" />
      </svg>

      {/* Spotlight border glow */}
      {rect && (
        <div className="absolute rounded-xl border-2 border-[var(--accent)] pointer-events-none"
          style={{
            top: rect.top - pad, left: rect.left - pad,
            width: rect.width + pad * 2, height: rect.height + pad * 2,
            boxShadow: '0 0 20px rgba(0, 229, 255, 0.3), inset 0 0 20px rgba(0, 229, 255, 0.1)',
          }}
        />
      )}

      {/* Tooltip card */}
      <div className="absolute" style={{ ...tooltipStyle, zIndex: 10000 }}
        onClick={(e) => e.stopPropagation()}>
        <div className="rounded-xl border border-[var(--border-bright)] p-5 shadow-2xl"
          style={{
            background: 'linear-gradient(135deg, #0c1420 0%, #111b2a 100%)',
            maxWidth: isCenter ? 460 : tooltipStyle.maxWidth || 380,
            width: isCenter ? 460 : undefined,
          }}>
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-3">
            <div className="flex gap-1">
              {TOUR_STEPS.map((_, i) => (
                <div key={i} className="h-1 rounded-full transition-all duration-300"
                  style={{
                    width: i === step ? 20 : 6,
                    background: i === step ? 'var(--accent)' : i < step ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
                    opacity: i <= step ? 1 : 0.4,
                  }}
                />
              ))}
            </div>
            <span className="text-[10px] text-[var(--text-dim)] ml-auto">{step + 1} / {TOUR_STEPS.length}</span>
          </div>

          {/* Content */}
          <h3 className="text-[15px] font-semibold text-white mb-2" style={{ fontFamily: 'var(--font-jura)' }}>
            {s.title}
          </h3>
          <p className="text-[13px] text-[var(--text-dim)] leading-relaxed whitespace-pre-line">
            {s.description}
          </p>
          {s.action && (
            <p className="text-[12px] text-[var(--accent)] mt-2 flex items-center gap-1.5">
              <span className="inline-block w-4 h-4 rounded-full border border-[var(--accent)] flex items-center justify-center text-[10px]">!</span>
              {s.action}
            </p>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-[var(--border-subtle)]">
            <button onClick={finish}
              className="text-[11px] text-[var(--text-dim)] hover:text-[var(--text-secondary)] transition-colors">
              Skip tour
            </button>
            <div className="flex gap-2">
              {step > 0 && (
                <button onClick={prev}
                  className="px-3 py-1.5 text-[11px] text-[var(--text-secondary)] border border-[var(--border-subtle)] rounded-lg hover:border-[var(--border-bright)] transition-all">
                  Back
                </button>
              )}
              <button onClick={next}
                className="px-4 py-1.5 text-[11px] font-semibold rounded-lg transition-all"
                style={{
                  background: step === TOUR_STEPS.length - 1 ? 'var(--accent)' : 'var(--accent-soft)',
                  color: step === TOUR_STEPS.length - 1 ? '#000' : 'var(--accent)',
                  border: `1px solid ${step === TOUR_STEPS.length - 1 ? 'var(--accent)' : 'var(--border-active)'}`,
                }}>
                {step === TOUR_STEPS.length - 1 ? 'Start Exploring' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Button to restart the tour from the header */
export function TourTrigger() {
  return (
    <button
      data-testid="btn-tour"
      aria-label="Start guided tour"
      onClick={() => {
        localStorage.removeItem(STORAGE_KEY);
        const w = window as unknown as Record<string, unknown>;
        if (typeof w.__restartTour === 'function') {
          (w.__restartTour as () => void)();
        } else {
          window.location.reload();
        }
      }}
      className="text-[10px] px-2 py-1 rounded border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--border-active)] transition-all"
      style={{ fontFamily: 'var(--font-jura)' }}
      title="Restart the guided onboarding tour"
    >
      ? HELP
    </button>
  );
}
