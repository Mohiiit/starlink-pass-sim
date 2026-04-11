import * as satellite from 'satellite.js';
import type { GroundStationConfig, PassGeometry, PassWindow } from '../types';
import { propagate } from './tle';
import { computeLookAngles, toObserverGd } from './ground-station';
import { ELEVATION_MASK_DEG } from '../../lib/constants';

/**
 * Compute elevation angle at a given time (fast, for searching).
 */
function getElevation(
  satrec: satellite.SatRec,
  gs: GroundStationConfig,
  date: Date,
): number {
  try {
    const { position } = propagate(satrec, date);
    const gmst = satellite.gstime(date);
    const ecf = satellite.eciToEcf(position, gmst);
    const observerGd = toObserverGd(gs);
    const lookAngles = satellite.ecfToLookAngles(observerGd, ecf);
    return satellite.radiansToDegrees(lookAngles.elevation);
  } catch {
    return -90; // propagation failed
  }
}

/**
 * Find the next pass of a satellite over a ground station.
 *
 * Strategy:
 * 1. Coarse scan at 30-second intervals over 2 orbital periods
 * 2. Find when elevation first rises above mask → refine AOS to 1-second
 * 3. Find peak elevation (TCA)
 * 4. Find when elevation drops below mask → refine LOS to 1-second
 * 5. Generate second-by-second geometry for the entire pass
 */
export function findNextPass(
  satrec: satellite.SatRec,
  gs: GroundStationConfig,
  startDate: Date,
  elevationMask: number = ELEVATION_MASK_DEG,
): PassWindow | null {
  // Orbital period ≈ 95 minutes for Starlink at 550km
  const searchDurationMs = 3 * 95 * 60 * 1000; // 3 orbits
  const coarseStepMs = 30 * 1000; // 30-second steps

  // Phase 1: Coarse scan to find when satellite is above elevation mask
  let passStart = -1;
  let passEnd = -1;
  let wasAboveMask = false;

  for (let t = 0; t < searchDurationMs; t += coarseStepMs) {
    const date = new Date(startDate.getTime() + t);
    const elev = getElevation(satrec, gs, date);

    if (elev > elevationMask && !wasAboveMask) {
      // Satellite just rose above mask — refine AOS
      passStart = t;
      wasAboveMask = true;
    } else if (elev <= elevationMask && wasAboveMask) {
      // Satellite just set below mask — refine LOS
      passEnd = t;
      break;
    }
  }

  if (passStart === -1) return null; // no pass found
  if (passEnd === -1) passEnd = passStart + 600000; // fallback: 10 min max

  // Phase 2: Refine AOS to 1-second precision
  let aosMs = passStart;
  for (let t = passStart - coarseStepMs; t <= passStart + coarseStepMs; t += 1000) {
    const date = new Date(startDate.getTime() + t);
    const elev = getElevation(satrec, gs, date);
    if (elev > elevationMask) {
      aosMs = t;
      break;
    }
  }

  // Phase 3: Refine LOS to 1-second precision
  let losMs = passEnd;
  for (let t = passEnd + coarseStepMs; t >= passEnd - coarseStepMs; t -= 1000) {
    const date = new Date(startDate.getTime() + t);
    const elev = getElevation(satrec, gs, date);
    if (elev > elevationMask) {
      losMs = t;
      break;
    }
  }

  const aosDate = new Date(startDate.getTime() + aosMs);
  const losDate = new Date(startDate.getTime() + losMs);
  const durationSeconds = Math.round((losMs - aosMs) / 1000);

  if (durationSeconds < 10) return null; // pass too short

  // Phase 4: Generate second-by-second geometry
  const geometry: PassGeometry[] = [];
  let maxElev = 0;
  let tcaDate = aosDate;

  for (let s = 0; s <= durationSeconds; s++) {
    const date = new Date(aosDate.getTime() + s * 1000);
    try {
      const { position, velocity } = propagate(satrec, date);
      const geo = computeLookAngles(gs, position, velocity, date, s);
      geometry.push(geo);

      if (geo.elevation_deg > maxElev) {
        maxElev = geo.elevation_deg;
        tcaDate = date;
      }
    } catch {
      // Skip propagation failures (shouldn't happen within pass)
      continue;
    }
  }

  if (geometry.length === 0) return null;

  return {
    aos: aosDate,
    tca: tcaDate,
    los: losDate,
    maxElevation_deg: maxElev,
    durationSeconds,
    geometry,
  };
}

/**
 * Generate a synthetic high-elevation pass for demo purposes.
 * This creates realistic pass geometry without depending on finding a real pass
 * from a TLE at the current time (which may not produce a high pass).
 *
 * Uses the TLE for orbital parameters but shifts the ground station to force
 * a near-overhead pass.
 */
export function generateDemoPass(
  _satrec: satellite.SatRec,
  gs: GroundStationConfig,
  targetMaxElevation_deg: number = 78,
  targetDuration_s: number = 480,
): PassWindow {
  // Always use analytical synthetic pass centered on the ground station.
  // The default TLE has a fabricated epoch (2024) which makes SGP4
  // propagation unreliable years later. The synthetic pass guarantees
  // the satellite passes directly over the chosen ground station with
  // correct geometry, regardless of TLE validity.
  return generateSyntheticPass(gs, targetMaxElevation_deg, targetDuration_s);
}

/**
 * Analytical synthetic pass with full orbital approach → pass → departure.
 *
 * Generates ~900 seconds of geometry:
 * - Approach: satellite orbits toward ground station (below elevation mask)
 * - Pass: satellite overhead, link active (above mask)
 * - Departure: satellite orbits away (below mask again)
 *
 * The satellite traces a great-circle arc across the globe, giving
 * a realistic orbiting visualization — not just the pass window.
 */
function generateSyntheticPass(
  gs: GroundStationConfig,
  maxElevation_deg: number,
  _passDuration_s: number,
): PassWindow {
  const now = new Date();
  const aosDate = now;
  const geometry: PassGeometry[] = [];

  // Total timeline: approach + pass + departure
  const totalDuration = 900; // 15 minutes of orbital arc
  const halfTotal = totalDuration / 2;
  const altKm = 550;
  const Re = 6371;
  const hOverR = altKm / Re;

  // Elevation curve: bell shape from -15° at edges to maxElev at center.
  // The pass (elevation > mask) occupies the middle ~480 seconds.
  const approachDepth = 15; // degrees below horizon at timeline edges
  const elevRange = maxElevation_deg + approachDepth;

  // Orbital parameters for sub-satellite track
  // Starlink at 53° inclination — satellite sweeps across latitude
  const orbitHeading_deg = 40; // ground track heading (NE to SW)
  const headingRad = orbitHeading_deg * Math.PI / 180;
  // Angular rate: ~0.065 deg/s for LEO at 550km (orbital velocity / Earth radius)
  const angularRate_degPerSec = 0.065;

  for (let s = 0; s <= totalDuration; s++) {
    const t = (s - halfTotal) / halfTotal; // -1 to +1

    // ── Elevation: smooth bell curve ──
    const elevFraction = Math.cos((t * Math.PI) / 2) ** 2; // 1 at center, 0 at edges
    const elevation_deg = -approachDepth + elevRange * elevFraction;
    const elevRad = Math.max(elevation_deg, -20) * Math.PI / 180;

    // ── Slant range from elevation ──
    const sinEl = Math.sin(Math.max(elevRad, 0.01));
    const cosEl = Math.cos(Math.max(elevRad, 0.01));
    const slantRange_km = Re * (Math.sqrt((hOverR + 1) ** 2 - cosEl ** 2) - sinEl);

    // ── Sub-satellite point: trace a great-circle arc ──
    // At t=0 the satellite is directly over the ground station.
    // It moves along the orbit heading at the orbital angular rate.
    const arcDistance_deg = (s - halfTotal) * angularRate_degPerSec;
    const subSatLat_deg = gs.lat + arcDistance_deg * Math.cos(headingRad);
    const subSatLon_deg = gs.lon + arcDistance_deg * Math.sin(headingRad) / Math.cos(gs.lat * Math.PI / 180);

    // ── Azimuth: sweep through ~180° as satellite crosses overhead ──
    const azimuth_deg = (orbitHeading_deg + 180 + 180 * (s / totalDuration)) % 360;

    // ── Range rate: approaching (negative) then receding (positive) ──
    const rangeRate_km_s = 7.5 * Math.sin((t * Math.PI) / 2);

    const date = new Date(aosDate.getTime() + s * 1000);

    geometry.push({
      timestamp: date,
      secondIntoPass: s,
      elevation_deg,
      azimuth_deg,
      slantRange_km: Math.max(slantRange_km, altKm), // floor at orbital altitude
      rangeRate_km_s,
      altitude_km: altKm,
      subSatLat_deg,
      subSatLon_deg,
    });
  }

  const tcaIndex = halfTotal;

  return {
    aos: aosDate,
    tca: geometry[tcaIndex].timestamp,
    los: new Date(aosDate.getTime() + totalDuration * 1000),
    maxElevation_deg,
    durationSeconds: totalDuration,
    geometry,
  };
}
