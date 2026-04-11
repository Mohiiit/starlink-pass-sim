import * as satellite from 'satellite.js';

export interface SatelliteRecord {
  satrec: satellite.SatRec;
  name: string;
  noradId: string;
}

/**
 * Parse a Two-Line Element set into a satellite.js satrec object.
 * TLE format: https://celestrak.org/NORAD/documentation/tle-fmt.php
 */
export function parseTLE(line1: string, line2: string, name = 'STARLINK'): SatelliteRecord {
  const satrec = satellite.twoline2satrec(line1, line2);

  if (satrec.error !== 0) {
    throw new Error(`TLE parse error: code ${satrec.error}. Check TLE validity.`);
  }

  const noradId = line1.substring(2, 7).trim();

  return { satrec, name, noradId };
}

/**
 * Propagate satellite position at a given time.
 * Returns ECI position (km) and velocity (km/s).
 */
export function propagate(satrec: satellite.SatRec, date: Date) {
  const posVel = satellite.propagate(satrec, date);

  if (typeof posVel.position === 'boolean' || typeof posVel.velocity === 'boolean') {
    throw new Error(`Propagation failed at ${date.toISOString()}`);
  }

  return {
    position: posVel.position as satellite.EciVec3<number>, // km
    velocity: posVel.velocity as satellite.EciVec3<number>, // km/s
  };
}

/**
 * Get the orbital period in minutes from the TLE mean motion.
 * Mean motion is in revolutions per day.
 */
export function getOrbitalPeriodMinutes(satrec: satellite.SatRec): number {
  // satrec.no is mean motion in radians/minute (satellite.js internal)
  // Convert: period = 2π / no (minutes)
  return (2 * Math.PI) / satrec.no;
}
