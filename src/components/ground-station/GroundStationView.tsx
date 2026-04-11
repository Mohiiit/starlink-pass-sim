'use client';

import { useMemo, useState } from 'react';
import type { SimulationTick, PacketRecord } from '../../simulation/types';
import { fmt, fmtSci, fmtTime } from '../../lib/utils';

interface Props {
  tick: SimulationTick;
  allTicks: SimulationTick[];
  packets: PacketRecord[];
  currentSecond: number;
}

type PacketFilter = 'all' | 'ok' | 'retransmit' | 'dropped';

function PacketRow({ pkt, onClick }: { pkt: PacketRecord; onClick: () => void }) {
  const statusColor = pkt.dropped ? 'text-red-400' : pkt.retransmission ? 'text-yellow-400' : 'text-green-400';
  const statusText = pkt.dropped ? 'DROP' : pkt.corrupted ? 'CRC ERR' : pkt.retransmission ? `RETX ${pkt.retransmitCount}` : 'OK';
  const statusIcon = pkt.dropped ? 'X' : pkt.retransmission ? '~' : '.';

  return (
    <tr
      data-testid={`packet-row-${pkt.id}`}
      className="border-b border-slate-800 hover:bg-slate-800/50 cursor-pointer text-xs"
      onClick={onClick}
    >
      <td className="py-1 px-2 text-slate-500">{pkt.id}</td>
      <td className="py-1 px-2">{fmtTime(pkt.secondIntoPass)}.{(pkt.timestamp_ms % 1000).toFixed(0).padStart(1, '0')}</td>
      <td className="py-1 px-2">{pkt.size_bytes}</td>
      <td className="py-1 px-2 text-cyan-400">{pkt.modulation}</td>
      <td className="py-1 px-2">{fmt(pkt.snr_dB)}</td>
      <td className="py-1 px-2">{fmtSci(pkt.ber)}</td>
      <td className={`py-1 px-2 ${statusColor}`}>{statusIcon} {statusText}</td>
      <td className="py-1 px-2">{pkt.dropped ? '—' : `${fmt(pkt.latency_ms)} ms`}</td>
    </tr>
  );
}

function PacketDetail({ pkt }: { pkt: PacketRecord }) {
  return (
    <div className="panel mt-2 text-sm" data-testid="packet-detail">
      <h3 className="text-cyan-400 font-bold mb-2">Packet #{pkt.id} — {pkt.dropped ? 'DROPPED' : pkt.corrupted ? 'CRC Error' : pkt.retransmission ? `Retransmit #${pkt.retransmitCount}` : 'OK'}</h3>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        <div className="text-slate-400">Time</div><div>{fmtTime(pkt.secondIntoPass)} (second {pkt.secondIntoPass})</div>
        <div className="text-slate-400">Size</div><div>{pkt.size_bytes} bytes ({pkt.size_bytes * 8} bits)</div>
        <div className="text-slate-400">Modulation</div><div>{pkt.modulation}</div>
        <div className="text-slate-400">SNR</div><div>{fmt(pkt.snr_dB)} dB</div>
        <div className="text-slate-400">BER (post-FEC)</div><div>{fmtSci(pkt.ber)}</div>
        <div className="text-slate-400">Latency</div><div>{pkt.dropped ? '—' : `${fmt(pkt.latency_ms)} ms`}</div>
        <div className="text-slate-400">Jitter</div><div>{fmt(pkt.jitter_ms)} ms</div>
      </div>

      <h4 className="text-cyan-400 text-xs uppercase tracking-wider mt-4 mb-2">Hardware State at t={pkt.secondIntoPass}s</h4>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs bg-slate-900/50 p-2 rounded">
        <div className="text-slate-400">Elevation</div><div>{fmt(pkt.causalChain.elevation_deg)} deg</div>
        <div className="text-slate-400">Scan Angle</div><div>{fmt(pkt.causalChain.scanAngle_deg)} deg</div>
        <div className="text-slate-400">Antenna Gain</div><div>{fmt(pkt.causalChain.antennaGain_dBi)} dBi</div>
        <div className="text-slate-400">PA Backoff</div><div>{fmt(pkt.causalChain.paBackoff_dB)} dB</div>
        <div className="text-slate-400">PA Temperature</div><div>{fmt(pkt.causalChain.paTemp_C)} C</div>
        <div className="text-slate-400">TX Power</div><div>{fmt(pkt.causalChain.txPower_dBm)} dBm</div>
        <div className="text-slate-400">FSPL</div><div>{fmt(pkt.causalChain.fspl_dB)} dB</div>
        <div className="text-slate-400">Effective SNR</div><div>{fmt(pkt.causalChain.effectiveSNR_dB)} dB</div>
      </div>
    </div>
  );
}

function ConstellationDiagram({ modulation, snr_dB }: { modulation: string; snr_dB: number }) {
  const size = 140;
  const cx = size / 2;
  const cy = size / 2;
  const scale = size / 2 - 16; // margin for labels

  // Determine ideal symbol positions based on modulation
  const idealPoints: [number, number][] = useMemo(() => {
    const mod = modulation.toUpperCase();
    if (mod.includes('QPSK') || mod.includes('4PSK')) {
      // QPSK: 4 points at (+-1, +-1) normalized
      const s = 1 / Math.SQRT2;
      return [[s, s], [s, -s], [-s, s], [-s, -s]];
    }
    if (mod.includes('8PSK')) {
      return Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI * 2) / 8;
        return [Math.cos(a), Math.sin(a)] as [number, number];
      });
    }
    if (mod.includes('16APSK') || mod.includes('16QAM') || mod.includes('16-')) {
      // 4x4 QAM grid at +-1, +-3 normalized
      const pts: [number, number][] = [];
      for (const i of [-3, -1, 1, 3]) {
        for (const q of [-3, -1, 1, 3]) {
          pts.push([i / 3, q / 3]);
        }
      }
      return pts;
    }
    if (mod.includes('32APSK') || mod.includes('32QAM')) {
      // Cross-shaped 32QAM
      const pts: [number, number][] = [];
      for (const i of [-5, -3, -1, 1, 3, 5]) {
        for (const q of [-5, -3, -1, 1, 3, 5]) {
          if (Math.abs(i) + Math.abs(q) <= 8) {
            pts.push([i / 5, q / 5]);
          }
        }
      }
      return pts.length > 0 ? pts : [[1, 0], [-1, 0], [0, 1], [0, -1]];
    }
    if (mod.includes('64APSK') || mod.includes('64QAM')) {
      // 8x8 QAM grid
      const pts: [number, number][] = [];
      for (const i of [-7, -5, -3, -1, 1, 3, 5, 7]) {
        for (const q of [-7, -5, -3, -1, 1, 3, 5, 7]) {
          pts.push([i / 7, q / 7]);
        }
      }
      return pts;
    }
    // Fallback: BPSK-like
    return [[1, 0], [-1, 0]];
  }, [modulation]);

  // Generate scattered points with seeded pseudo-random noise
  const scatteredPoints = useMemo(() => {
    const snrLin = Math.pow(10, snr_dB / 10);
    const noiseStd = 1 / Math.sqrt(Math.max(snrLin, 1));
    const pointsPerSymbol = Math.max(2, Math.floor(50 / idealPoints.length));
    const result: [number, number][] = [];

    // Simple seeded PRNG (mulberry32)
    let seed = 42;
    const rand = () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // Box-Muller for Gaussian
    const gaussRand = () => {
      const u1 = Math.max(1e-10, rand());
      const u2 = rand();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    };

    for (const [si, sq] of idealPoints) {
      for (let j = 0; j < pointsPerSymbol; j++) {
        result.push([
          si + gaussRand() * noiseStd * 0.5,
          sq + gaussRand() * noiseStd * 0.5,
        ]);
      }
    }
    return result;
  }, [idealPoints, snr_dB]);

  // Map I/Q coordinates to SVG pixel positions
  const toX = (i: number) => cx + i * (scale * 0.7);
  const toY = (q: number) => cy - q * (scale * 0.7);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="block bg-slate-950 rounded"
      data-testid="constellation-diagram"
    >
      {/* Grid */}
      <line x1={cx} y1={4} x2={cx} y2={size - 4} stroke="#334155" strokeWidth="0.5" />
      <line x1={4} y1={cy} x2={size - 4} y2={cy} stroke="#334155" strokeWidth="0.5" />
      {/* Quadrant lines */}
      <line x1={4} y1={4} x2={size - 4} y2={size - 4} stroke="#1e293b" strokeWidth="0.3" />
      <line x1={size - 4} y1={4} x2={4} y2={size - 4} stroke="#1e293b" strokeWidth="0.3" />

      {/* Scattered received symbols */}
      {scatteredPoints.map(([i, q], idx) => (
        <circle key={idx} cx={toX(i)} cy={toY(q)} r="1.2" fill="#06b6d4" opacity="0.6" />
      ))}

      {/* Ideal positions */}
      {idealPoints.map(([i, q], idx) => (
        <circle key={`ideal-${idx}`} cx={toX(i)} cy={toY(q)} r="2.5" fill="none" stroke="#06b6d4" strokeWidth="0.8" opacity="0.5" />
      ))}

      {/* Axis labels */}
      <text x={size - 6} y={cy - 3} textAnchor="end" fill="#64748b" fontSize="7">I</text>
      <text x={cx + 4} y={8} textAnchor="start" fill="#64748b" fontSize="7">Q</text>

      {/* Modulation label */}
      <text x={4} y={size - 4} fill="#94a3b8" fontSize="6">{modulation}</text>
    </svg>
  );
}

export function GroundStationView({ tick, allTicks, packets, currentSecond }: Props) {
  const [filter, setFilter] = useState<PacketFilter>('all');
  const [selectedPacket, setSelectedPacket] = useState<PacketRecord | null>(null);

  // Get packets near current time (±2 seconds for context)
  const visiblePackets = useMemo(() => {
    let filtered = packets.filter(
      p => p.secondIntoPass >= currentSecond - 2 && p.secondIntoPass <= currentSecond + 2
    );
    if (filter === 'ok') filtered = filtered.filter(p => !p.dropped && !p.retransmission);
    if (filter === 'retransmit') filtered = filtered.filter(p => p.retransmission);
    if (filter === 'dropped') filtered = filtered.filter(p => p.dropped);
    return filtered.slice(0, 200); // cap for performance
  }, [packets, currentSecond, filter]);

  // Stats
  const allCurrentPackets = useMemo(() =>
    packets.filter(p => p.secondIntoPass === currentSecond),
  [packets, currentSecond]);

  const stats = useMemo(() => ({
    total: allCurrentPackets.length,
    ok: allCurrentPackets.filter(p => !p.dropped && !p.retransmission).length,
    retransmit: allCurrentPackets.filter(p => p.retransmission).length,
    dropped: allCurrentPackets.filter(p => p.dropped).length,
  }), [allCurrentPackets]);

  return (
    <div className="space-y-3">
      {/* Signal metrics */}
      <div className="panel grid grid-cols-4 gap-4 text-center">
        <div>
          <div className="text-[10px] text-slate-500 uppercase">Received Power</div>
          <div className="metric-value text-lg" data-testid="metric-rx-power">{fmt(tick.linkBudget.carrierPower_dBW + 30)} dBm</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500 uppercase">SNR</div>
          <div className={`metric-value text-lg ${tick.linkBudget.effectiveSNR_dB < 5 ? 'text-red-400' : tick.linkBudget.effectiveSNR_dB < 10 ? 'text-yellow-400' : 'text-green-400'}`}>
            {fmt(tick.linkBudget.effectiveSNR_dB)} dB
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500 uppercase">Doppler</div>
          <div className="metric-value text-lg">{fmt(tick.linkBudget.dopplerShift_Hz / 1000, 1)} kHz</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500 uppercase">Lock</div>
          <div className={`metric-value text-lg ${tick.rfChain.oscillator.locked ? 'text-green-400' : 'text-red-400'}`}>
            {tick.rfChain.oscillator.locked ? 'LOCKED' : 'UNLOCKED'}
          </div>
        </div>
      </div>

      {/* Constellation Diagram */}
      <div className="flex items-center gap-4">
        <ConstellationDiagram modulation={tick.protocol.modulationName} snr_dB={tick.linkBudget.effectiveSNR_dB} />
        <div className="text-xs text-slate-500 space-y-1">
          <div>Modulation: <span className="text-cyan-400">{tick.protocol.modulationName}</span></div>
          <div>SNR: <span className="text-slate-300">{fmt(tick.linkBudget.effectiveSNR_dB)} dB</span></div>
        </div>
      </div>

      {/* Packet stats bar */}
      <div className="flex items-center gap-4 text-sm">
        <span className="text-slate-400">Packets at T+{currentSecond}s:</span>
        <span className="text-green-400">{stats.ok} OK</span>
        <span className="text-yellow-400">{stats.retransmit} Retx</span>
        <span className="text-red-400">{stats.dropped} Drop</span>
        <div className="flex-1" />
        <div className="flex gap-1">
          {(['all', 'ok', 'retransmit', 'dropped'] as const).map((f) => (
            <button
              key={f}
              data-testid={`btn-filter-${f}`}
              aria-label={`Filter ${f} packets`}
              onClick={() => setFilter(f)}
              className={`px-2 py-0.5 text-xs rounded ${
                filter === f ? 'bg-cyan-700 text-white' : 'bg-slate-700 text-slate-400'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Packet table */}
      <div className="panel max-h-80 overflow-y-auto" data-testid="packet-list">
        <table className="w-full text-left">
          <thead className="text-xs text-slate-500 uppercase sticky top-0 bg-slate-800">
            <tr>
              <th className="py-1 px-2">#</th>
              <th className="py-1 px-2">Time</th>
              <th className="py-1 px-2">Size</th>
              <th className="py-1 px-2">ModCod</th>
              <th className="py-1 px-2">SNR</th>
              <th className="py-1 px-2">BER</th>
              <th className="py-1 px-2">Status</th>
              <th className="py-1 px-2">Latency</th>
            </tr>
          </thead>
          <tbody>
            {visiblePackets.map((pkt) => (
              <PacketRow key={pkt.id} pkt={pkt} onClick={() => setSelectedPacket(pkt)} />
            ))}
            {visiblePackets.length === 0 && (
              <tr><td colSpan={8} className="text-center py-4 text-slate-500">No packets match filter</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Packet detail */}
      {selectedPacket && <PacketDetail pkt={selectedPacket} />}
    </div>
  );
}
