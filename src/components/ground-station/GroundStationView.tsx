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
