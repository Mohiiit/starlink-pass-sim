// ============================================================
// Link Budget — Complete Ku-band downlink budget computation
// ============================================================
//
// Computes the full link budget from transmitter to receiver:
//   EIRP -> free-space path loss -> atmospheric/rain losses ->
//   receiver G/T -> C/N -> effective SNR (after impairments)
//
// The link budget is the central "truth" of whether communication
// is possible. Everything upstream (antenna, PA, thermal, power)
// feeds into the tx parameters; everything downstream (modcod,
// protocol, packets) depends on the effective SNR output.
// ============================================================

import type { LinkBudgetState } from '../types';
import {
  SPEED_OF_LIGHT,
  DOWNLINK_FREQ_HZ,
  CHANNEL_BANDWIDTH_HZ,
  BOLTZMANN_K_DBW,
  FEED_LOSS_DB,
  IMPLEMENTATION_LOSS_DB,
  ATMOSPHERIC_LOSS_ZENITH_DB,
  GS_ANTENNA_GAIN_DBI,
  GS_LNA_NOISE_TEMP_K,
  GS_CABLE_NOISE_TEMP_K,
  GS_ANTENNA_NOISE_TEMP_ZENITH_K,
  GS_ANTENNA_NOISE_TEMP_HORIZON_K,
} from '../../lib/constants';
import {
  dopplerShift_Hz,
  dopplerRate_HzPerSec,
  dopplerPenalty_dB,
} from './doppler';

// Minimum elevation to avoid division by near-zero in atmospheric model
const MIN_ELEVATION_FOR_ATMO_DEG = 5;

/**
 * Compute the antenna noise temperature as a function of elevation.
 * At zenith (90 deg), the antenna sees cold sky; at the horizon, it
 * picks up warm Earth noise through sidelobes.
 *
 * @param elevation_deg - Elevation angle in degrees.
 * @returns Antenna noise temperature in Kelvin.
 */
function antennaNoiseTemp_K(elevation_deg: number): number {
  const elevation_rad = (elevation_deg * Math.PI) / 180;
  const sinElev = Math.sin(elevation_rad);
  // Interpolate between zenith and horizon noise temperatures
  // T_ant = T_zenith + (T_horizon - T_zenith) * (1 - sin(elev))
  return (
    GS_ANTENNA_NOISE_TEMP_ZENITH_K +
    (GS_ANTENNA_NOISE_TEMP_HORIZON_K - GS_ANTENNA_NOISE_TEMP_ZENITH_K) *
      (1 - sinElev)
  );
}

/**
 * Compute the complete link budget for a single simulation instant.
 *
 * @param txPower_dBm - Transmitter output power in dBm (from PA).
 * @param antennaGain_dBi - Satellite antenna effective gain in dBi.
 * @param slantRange_km - Slant range from satellite to ground station in km.
 * @param elevation_deg - Elevation angle of the satellite as seen from the ground station.
 * @param rangeRate_km_s - Range rate in km/s (negative = approaching).
 * @param evmPenalty_dB - SNR penalty from EVM impairments (PA, oscillator).
 * @param rainLoss_dB - Additional rain attenuation in dB.
 * @param prevRangeRate_km_s - Previous tick's range rate for Doppler rate computation.
 * @returns Complete LinkBudgetState.
 */
export function computeLinkBudget(
  txPower_dBm: number,
  antennaGain_dBi: number,
  slantRange_km: number,
  elevation_deg: number,
  rangeRate_km_s: number,
  evmPenalty_dB: number,
  rainLoss_dB: number,
  prevRangeRate_km_s: number = rangeRate_km_s,
): LinkBudgetState {
  // ---- Transmitter side ----
  // Convert tx power from dBm to dBW (subtract 30)
  const txPower_dBW = txPower_dBm - 30;

  // EIRP = tx power (dBW) + antenna gain (dBi) - feed loss (dB)
  const eirp_dBW = txPower_dBW + antennaGain_dBi - FEED_LOSS_DB;

  // ---- Free-space path loss ----
  // FSPL = 20*log10(4*pi*d*f/c) where d in meters, f in Hz
  const d_m = slantRange_km * 1000;
  const fspl_dB =
    20 * Math.log10((4 * Math.PI * d_m * DOWNLINK_FREQ_HZ) / SPEED_OF_LIGHT);

  // ---- Atmospheric loss ----
  // L_atmo = L_zenith / sin(elevation)
  // Clamp elevation to minimum to avoid extreme path lengths
  const effectiveElev_deg = Math.max(MIN_ELEVATION_FOR_ATMO_DEG, elevation_deg);
  const effectiveElev_rad = (effectiveElev_deg * Math.PI) / 180;
  const atmosphericLoss_dB =
    ATMOSPHERIC_LOSS_ZENITH_DB / Math.sin(effectiveElev_rad);

  // ---- Receiver side ----
  // System noise temperature: T_sys = T_ant(elev) + T_lna + T_cable
  const tAnt = antennaNoiseTemp_K(elevation_deg);
  const systemNoiseTemp_K = tAnt + GS_LNA_NOISE_TEMP_K + GS_CABLE_NOISE_TEMP_K;

  // G/T = rx antenna gain (dBi) - 10*log10(T_sys)
  const gOverT_dBK = GS_ANTENNA_GAIN_DBI - 10 * Math.log10(systemNoiseTemp_K);

  // ---- Carrier-to-noise ratio ----
  // C/N = EIRP - FSPL - L_atmo - L_rain + G/T - k_B(dBW) - 10*log10(BW)
  const cnr_dB =
    eirp_dBW -
    fspl_dB -
    atmosphericLoss_dB -
    rainLoss_dB +
    gOverT_dBK -
    BOLTZMANN_K_DBW -
    10 * Math.log10(CHANNEL_BANDWIDTH_HZ);

  // ---- Carrier and noise powers (for reporting) ----
  // C = EIRP - FSPL - L_atmo - L_rain + G_rx
  const carrierPower_dBW =
    eirp_dBW - fspl_dB - atmosphericLoss_dB - rainLoss_dB + GS_ANTENNA_GAIN_DBI;

  // N = k_B(dBW) + 10*log10(T_sys) + 10*log10(BW)
  const noisePower_dBW =
    BOLTZMANN_K_DBW +
    10 * Math.log10(systemNoiseTemp_K) +
    10 * Math.log10(CHANNEL_BANDWIDTH_HZ);

  // ---- Doppler ----
  const dopShift = dopplerShift_Hz(rangeRate_km_s);
  const dopRate = dopplerRate_HzPerSec(rangeRate_km_s, prevRangeRate_km_s, 1.0);
  const dopPenalty = dopplerPenalty_dB(dopRate);

  // ---- Effective SNR ----
  // Subtract all impairment penalties from raw C/N
  const effectiveSNR_dB =
    cnr_dB - evmPenalty_dB - dopPenalty - IMPLEMENTATION_LOSS_DB;

  // ---- Required SNR and margin (populated by modcod layer, use placeholder) ----
  // These are set to 0 here; the orchestrator should fill them from modcod selection.
  const requiredSNR_dB = 0;
  const margin_dB = effectiveSNR_dB - requiredSNR_dB;

  return {
    txPower_dBW,
    antennaGain_dBi,
    feedLoss_dB: FEED_LOSS_DB,
    eirp_dBW,
    slantRange_km,
    fspl_dB,
    atmosphericLoss_dB,
    rainLoss_dB,
    rxAntennaGain_dBi: GS_ANTENNA_GAIN_DBI,
    systemNoiseTemp_K,
    gOverT_dBK,
    noiseBandwidth_Hz: CHANNEL_BANDWIDTH_HZ,
    carrierPower_dBW,
    noisePower_dBW,
    cnr_dB,
    evmPenalty_dB,
    dopplerPenalty_dB: dopPenalty,
    implementationLoss_dB: IMPLEMENTATION_LOSS_DB,
    effectiveSNR_dB,
    dopplerShift_Hz: dopShift,
    dopplerRate_HzPerSec: dopRate,
    requiredSNR_dB,
    margin_dB,
  };
}
