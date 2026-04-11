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
  satrec: satellite.SatRec,
  gs: GroundStationConfig,
  targetMaxElevation_deg: number = 78,
  targetDuration_s: number = 480,
): PassWindow {
  // Strategy: search for a time when the satellite's sub-satellite point
  // is near the ground station (guarantees high elevation pass)
  const startSearch = new Date();
  const searchMs = 24 * 60 * 60 * 1000; // search 24 hours
  const stepMs = 60 * 1000; // 1-minute steps

  let bestTime = startSearch;
  let bestDistance = Infinity;

  for (let t = 0; t < searchMs; t += stepMs) {
    const date = new Date(startSearch.getTime() + t);
    try {
      const elev = getElevation(satrec, gs, date);
      if (elev > 0) {
        // Check how close to target max elevation
        const diff = Math.abs(elev - targetMaxElevation_deg);
        if (diff < bestDistance) {
          bestDistance = diff;
          bestTime = date;
        }
      }
    } catch {
      continue;
    }
  }

  // If we found a real pass near target elevation, use it
  if (bestDistance < 15) {
    // Back up to find the AOS
    let aosTime = bestTime;
    for (let t = 0; t < 600; t++) {
      const date = new Date(bestTime.getTime() - t * 1000);
      const elev = getElevation(satrec, gs, date);
      if (elev < ELEVATION_MASK_DEG) {
        aosTime = new Date(date.getTime() + 1000);
        break;
      }
    }

    // Forward to find LOS
    let losTime = bestTime;
    for (let t = 0; t < 600; t++) {
      const date = new Date(bestTime.getTime() + t * 1000);
      const elev = getElevation(satrec, gs, date);
      if (elev < ELEVATION_MASK_DEG) {
        losTime = new Date(date.getTime() - 1000);
        break;
      }
    }

    const durationSeconds = Math.round((losTime.getTime() - aosTime.getTime()) / 1000);

    // Generate geometry
    const geometry: PassGeometry[] = [];
    let maxElev = 0;
    let tcaDate = aosTime;

    for (let s = 0; s <= durationSeconds; s++) {
      const date = new Date(aosTime.getTime() + s * 1000);
      try {
        const { position, velocity } = propagate(satrec, date);
        const geo = computeLookAngles(gs, position, velocity, date, s);
        geometry.push(geo);
        if (geo.elevation_deg > maxElev) {
          maxElev = geo.elevation_deg;
          tcaDate = date;
        }
      } catch {
        continue;
      }
    }

    if (geometry.length > 30) {
      return {
        aos: aosTime,
        tca: tcaDate,
        los: losTime,
        maxElevation_deg: maxElev,
        durationSeconds,
        geometry,
      };
    }
  }

  // Fallback: generate synthetic pass geometry analytically
  return generateSyntheticPass(gs, targetMaxElevation_deg, targetDuration_s);
}

/**
 * Purely analytical synthetic pass — guarantees realistic geometry
 * without depending on TLE propagation finding a convenient pass.
 */
function generateSyntheticPass(
  gs: GroundStationConfig,
  maxElevation_deg: number,
  duration_s: number,
): PassWindow {
  const now = new Date();
  const aosDate = now;
  const geometry: PassGeometry[] = [];

  const halfDuration = duration_s / 2;
  const maxElevRad = (maxElevation_deg * Math.PI) / 180;
  const maskRad = (ELEVATION_MASK_DEG * Math.PI) / 180;
  const altKm = 550;

  for (let s = 0; s <= duration_s; s++) {
    // Elevation follows a smooth curve: peak at midpoint
    // Use a modified cosine to approximate real pass geometry
    const t = (s - halfDuration) / halfDuration; // -1 to +1
    const elevRad = maskRad + (maxElevRad - maskRad) * Math.cos((t * Math.PI) / 2) ** 2;
    const elevation_deg = (elevRad * 180) / Math.PI;

    // Slant range from elevation and altitude
    // range = R_earth * (sqrt((h/R + 1)^2 - cos^2(el)) - sin(el))
    const Re = 6371;
    const sinEl = Math.sin(elevRad);
    const cosEl = Math.cos(elevRad);
    const hOverR = altKm / Re;
    const slantRange_km = Re * (Math.sqrt((hOverR + 1) ** 2 - cosEl ** 2) - sinEl);

    // Azimuth: sweep from ~NE to SE (typical high pass)
    const azimuth_deg = 45 + 90 * (s / duration_s);

    // Range rate: negative (approaching) before TCA, positive after
    // Approximate from geometry
    const rangeRate_km_s = -7.5 * Math.sin((t * Math.PI) / 2);

    const date = new Date(aosDate.getTime() + s * 1000);

    geometry.push({
      timestamp: date,
      secondIntoPass: s,
      elevation_deg,
      azimuth_deg,
      slantRange_km,
      rangeRate_km_s,
      altitude_km: altKm,
      subSatLat_deg: gs.lat + 3 * t, // satellite moves ~6° latitude
      subSatLon_deg: gs.lon + 2 * t,
    });
  }

  const tcaIndex = Math.floor(halfDuration);

  return {
    aos: aosDate,
    tca: geometry[tcaIndex].timestamp,
    los: new Date(aosDate.getTime() + duration_s * 1000),
    maxElevation_deg: maxElevation_deg,
    durationSeconds: duration_s,
    geometry,
  };
}
