// ============================================================
// Packet Layer — PER, retransmissions, goodput, latency, jitter
// ============================================================
//
// Models the transport-layer behavior on top of the physical layer:
//   1. Packet error rate (PER) derived from coded BER
//   2. ARQ retransmission model with bounded retries
//   3. Goodput calculation accounting for overhead and drops
//   4. Latency model: propagation + processing + retransmission delays
//   5. Per-packet simulation with Monte Carlo sampling
//
// This is the final stage of the downlink chain: the goodput_Mbps
// output is the end-user throughput metric.
// ============================================================

import type { ModCodEntry, PacketRecord, ProtocolState } from '../types';
import {
  SPEED_OF_LIGHT,
  CHANNEL_BANDWIDTH_HZ,
  PACKET_SIZE_BITS,
  PACKET_SIZE_BYTES,
  MAX_RETRANSMISSIONS,
  FRAME_OVERHEAD_FRACTION,
} from '../../lib/constants';
import { selectModCod, getModCodByIndex } from '../modulation/modcod';
import { computeBER } from '../modulation/ber';

// Frame duration approximation (for retransmission timing)
// At 250 MHz bandwidth with QPSK rate-1/2 (1.0 bps/Hz), a 12000-bit
// packet takes 12000 / 250e6 = 48 us. With overhead, ~0.05 ms per packet.
// But MAC scheduling granularity is typically ~1 ms.
const MAC_SCHEDULING_PERIOD_MS = 1.0;

// Maximum representative packets per second (for simulation performance)
const MAX_PACKETS_PER_SECOND = 100;

// Simple seeded PRNG (xorshift32) for deterministic packet simulation
function xorshift32(seed: number): () => number {
  let state = seed | 1; // ensure non-zero
  return () => {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296; // normalize to [0, 1)
  };
}

/**
 * Compute the complete protocol state for one simulation second.
 *
 * @param snr_dB - Effective SNR from link budget.
 * @param modcod - Currently active ModCod entry.
 * @param slantRange_km - Slant range for propagation delay.
 * @param computeLoadFactor - Compute load factor (0-1), affects jitter.
 * @param secondIntoPass - Current second into the pass (for packet IDs and seeding).
 * @param channelBandwidth_Hz - Channel bandwidth in Hz (overrides default constant).
 * @returns Complete ProtocolState with packet trace.
 */
export function computeProtocolState(
  snr_dB: number,
  modcod: ModCodEntry,
  slantRange_km: number,
  computeLoadFactor: number,
  secondIntoPass: number,
  channelBandwidth_Hz: number = CHANNEL_BANDWIDTH_HZ,
): ProtocolState {
  // ---- BER and PER ----
  const { uncoded: berUncoded, coded: berCoded } = computeBER(snr_dB, modcod);

  // PER = 1 - (1 - BER_coded)^packetSizeBits
  // For very small BER, use approximation to avoid floating-point issues:
  // PER ≈ packetSizeBits * BER for BER << 1/packetSizeBits
  let per: number;
  if (berCoded < 1e-15) {
    per = 0;
  } else if (berCoded * PACKET_SIZE_BITS < 0.01) {
    // Approximation for small BER: PER ≈ 1 - exp(-n*BER) ≈ n*BER
    per = PACKET_SIZE_BITS * berCoded;
  } else {
    per = 1 - Math.pow(1 - berCoded, PACKET_SIZE_BITS);
  }
  per = Math.max(0, Math.min(1, per));

  // ---- Retransmission model ----
  // Average number of transmissions needed per packet
  const avgTransmissions = per < 1
    ? Math.min(1 / (1 - per), MAX_RETRANSMISSIONS + 1)
    : MAX_RETRANSMISSIONS + 1;

  // Drop probability: packet fails all (MAX_RETRANSMISSIONS + 1) attempts
  const pDrop = Math.pow(per, MAX_RETRANSMISSIONS + 1);

  // ---- Data rates ----
  // Raw data rate from spectral efficiency and channel bandwidth
  const rawDataRate_bps = modcod.spectralEfficiency * channelBandwidth_Hz;
  const rawDataRate_Mbps = rawDataRate_bps / 1e6;

  // Useful data rate: subtract frame overhead
  const usefulDataRate_bps = rawDataRate_bps * (1 - FRAME_OVERHEAD_FRACTION);
  const usefulDataRate_Mbps = usefulDataRate_bps / 1e6;

  // Goodput: useful rate adjusted for drops and retransmissions
  const goodput_Mbps = usefulDataRate_Mbps * (1 - pDrop) / avgTransmissions;

  // Retransmission rate: fraction of successful packets that needed at least one retry
  const retransmissionRate = per < 1 ? per * (1 - pDrop) : 1;

  // ---- Latency model ----
  // Propagation delay: range / c
  const propagationDelay_ms = (slantRange_km * 1000 / SPEED_OF_LIGHT) * 1000;

  // Processing delay (baseband + MAC scheduling)
  const processingDelay_ms = 1.0;

  // Average retransmission delay
  const avgRetransDelay_ms = (avgTransmissions - 1) * MAC_SCHEDULING_PERIOD_MS;

  // Total average latency
  const avgLatency_ms = propagationDelay_ms + processingDelay_ms + avgRetransDelay_ms;

  // ---- Jitter ----
  // Jitter depends on retransmission variance and compute load
  const baseJitter_ms = (avgTransmissions - 1) * MAC_SCHEDULING_PERIOD_MS;
  const computeJitter_ms = computeLoadFactor * 0.5; // up to 0.5 ms from compute
  const jitter_ms = baseJitter_ms + computeJitter_ms;

  // ---- Per-packet simulation ----
  // Determine how many packets per second at current goodput
  const theoreticalPacketsPerSec = Math.max(
    1,
    Math.floor(goodput_Mbps * 1e6 / (PACKET_SIZE_BYTES * 8)),
  );

  // Sample if too many
  const sampleSize = Math.min(theoreticalPacketsPerSec, MAX_PACKETS_PER_SECOND);
  const sampleRatio = theoreticalPacketsPerSec / sampleSize;

  // Deterministic PRNG seeded by second
  const rng = xorshift32(secondIntoPass * 7919 + 104729);

  const packetsThisSecond: PacketRecord[] = [];

  for (let i = 0; i < sampleSize; i++) {
    const packetId = secondIntoPass * 100000 + i;
    let corrupted = false;
    let retransmitCount = 0;
    let dropped = false;

    // Simulate transmission attempts
    for (let attempt = 0; attempt <= MAX_RETRANSMISSIONS; attempt++) {
      const roll = rng();
      if (roll >= per) {
        // Success on this attempt
        corrupted = false;
        retransmitCount = attempt;
        break;
      } else {
        corrupted = true;
        retransmitCount = attempt + 1;
        if (attempt === MAX_RETRANSMISSIONS) {
          dropped = true;
        }
      }
    }

    // Per-packet latency
    const retransLatency = retransmitCount * MAC_SCHEDULING_PERIOD_MS;
    const packetLatency_ms = propagationDelay_ms + processingDelay_ms + retransLatency;

    // Per-packet jitter: retransmission component + random compute component
    const randomComponent = rng() * computeLoadFactor * 0.5;
    const packetJitter_ms = retransmitCount * MAC_SCHEDULING_PERIOD_MS + randomComponent;

    packetsThisSecond.push({
      id: packetId,
      timestamp_ms: secondIntoPass * 1000 + (i / sampleSize) * 1000,
      secondIntoPass,
      size_bytes: PACKET_SIZE_BYTES,
      modulation: modcod.modulation,
      snr_dB,
      ber: berCoded,
      corrupted: dropped, // only mark corrupted if ultimately dropped
      retransmission: retransmitCount > 0,
      retransmitCount,
      dropped,
      latency_ms: packetLatency_ms,
      jitter_ms: packetJitter_ms,
      // causalChain is populated by the orchestrator with full cross-subsystem data
      causalChain: {
        elevation_deg: 0,
        scanAngle_deg: 0,
        antennaGain_dBi: 0,
        paBackoff_dB: 0,
        paTemp_C: 0,
        txPower_dBm: 0,
        fspl_dB: 0,
        effectiveSNR_dB: snr_dB,
      },
    });
  }

  return {
    currentModCod: modcod.index,
    modulationName: modcod.modulation,
    codeRate: modcod.codeRate,
    spectralEfficiency: modcod.spectralEfficiency,
    rawDataRate_Mbps: rawDataRate_Mbps,
    usefulDataRate_Mbps: usefulDataRate_Mbps,
    ber: berCoded,
    packetErrorRate: per,
    retransmissionRate,
    goodput_Mbps,
    avgLatency_ms,
    jitter_ms,
    packetsThisSecond,
  };
}
