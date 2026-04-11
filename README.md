# Starlink Pass Simulator

A hardware-first, interactive simulation of a single Starlink satellite pass over a ground station. Throughput, modulation, packet loss, and every observable metric **emerge from spacecraft hardware constraints** — not from independent curves.

## Quick Start

```bash
git clone https://github.com/mohiiit/starlink-pass-sim.git
cd starlink-pass-sim
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## What This Does

Simulates a ~8-minute Starlink satellite pass at 1-second resolution. Every second, the simulation computes:

1. **Orbital geometry** — real SGP4 propagation from TLE, elevation, azimuth, slant range, Doppler
2. **Phased array antenna** — element-level gain, scan loss (not just cos(theta)), mutual coupling, pointing jitter
3. **Power amplifier** — Rapp model AM/AM compression, AM/PM distortion, thermal derating, EVM
4. **Oscillator** — TCXO frequency drift, phase noise mask, PLL lock/unlock
5. **Thermal model** — 5-node lumped network, Stefan-Boltzmann radiative cooling, solar loading
6. **Power bus** — solar panel, battery SoC, load management, power-limited modes
7. **Link budget** — EIRP, FSPL, atmospheric attenuation, G/T, effective SNR
8. **Adaptive modulation** — DVB-S2X-style ModCod selection with hysteresis
9. **Protocol stack** — BER, packet error rate, ARQ retransmissions, goodput, jitter
10. **Fault injection** — element failures, PA degradation, oscillator unlock, thermal throttling

### Causal Flow

Nothing is independent. Every value is computed from upstream hardware state:

```
Orbit Position -> Steering Angle -> Scan Loss -> EIRP
  (modified by) PA State <- Thermal <- Power Bus
    -> Free Space Path Loss -> Atmospheric Loss
      -> Received SNR -> BER -> ModCod -> Goodput
```

A throughput collapse at T+247s can be traced to: PA thermal throttling (junction at 85C) + high scan angle (63 deg) = reduced EIRP = SNR below 16QAM threshold = fallback to QPSK.

## Scenarios

| Scenario | What Happens |
|----------|-------------|
| **Clean** | No faults. Baseline behavior. |
| **Degraded** | 5% elements failed, PA aged, battery at 70% |
| **Stressed** | 15% elements failed, compute overload, battery at 50% |
| **Failing** | Oscillator unlock mid-pass, 25% elements failed, thermal runaway |

## Three Views

### Satellite Dashboard
Subsystem-by-subsystem inspection: antenna steering/gain, PA compression curve, thermal nodes, power bus loads, link budget waterfall, protocol metrics. Each with time-series charts.

### Ground Station
Wireshark-style packet inspector. Click any packet to see the hardware state that produced it. Filter by OK/retransmit/dropped. Signal quality metrics, Doppler tracking, lock status.

### Causality Tracer
Click any anomaly (throughput drop, modcod change, thermal throttle) to see an expandable tree showing the causal chain from symptom to hardware root cause.

## Physics Models

| Model | Implementation | Reference |
|-------|---------------|-----------|
| Orbital mechanics | SGP4 via satellite.js | NORAD TLE standard |
| Phased array scan loss | cos^1.2(theta) * (1 - Gamma_active^2) | Antenna theory, mutual coupling model |
| PA nonlinearity | Rapp model, p=2 (GaN MMIC) | Rapp 1991 |
| PA thermal derating | -0.02 dB/C on P1dB | GaN MMIC datasheets |
| Oscillator drift | TCXO model: alpha=0.5 ppm/C | Crystal oscillator theory |
| Thermal | Lumped 5-node ODE, Euler integration | Spacecraft thermal control |
| Link budget | ITU-R standard + Ku-band parameters | ITU-R P.676, FCC Starlink filings |
| BER | Analytical QPSK/M-QAM with erfc | Digital communications theory |
| Adaptive modulation | DVB-S2X-like table with hysteresis | ETSI EN 302 307 |

## Limitations

- **Simplified array model**: Uses analytical scan loss, not full EM simulation
- **Single beam**: Real Starlink serves multiple users with multiple beams
- **No inter-satellite link modeling**: ISL effects on scheduling not simulated
- **Thermal time constants**: 5-node model is coarse; real spacecraft has thousands of nodes
- **No atmospheric scintillation**: Only bulk attenuation modeled
- **Single carrier**: Real system uses OFDM-like waveforms

## Tech Stack

- Next.js 16 + TypeScript
- satellite.js (SGP4 propagation)
- Zustand (state management)
- Tailwind CSS (dark mission-control theme)

## License

MIT
