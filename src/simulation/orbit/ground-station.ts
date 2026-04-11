import * as satellite from 'satellite.js';
import type { GroundStationConfig, PassGeometry } from '../types';

/**
 * Geodetic position for satellite.js lookAngle calculations.
 * Latitude/longitude in radians, altitude in km.
 */
export function toObserverGd(gs: GroundStationConfig) {
  return {
    longitude: satellite.degreesToRadians(gs.lon),
    latitude: satellite.degreesToRadians(gs.lat),
    height: gs.alt, // km
  };
}

/**
 * Compute look angles (elevation, azimuth) and range from ground station to satellite.
 *
 * @param gs      Ground station config
 * @param eciPos  Satellite ECI position (km)
 * @param eciVel  Satellite ECI velocity (km/s) — used for range rate
 * @param date    Current time
 * @returns PassGeometry for this instant
 */
export function computeLookAngles(
  gs: GroundStationConfig,
  eciPos: satellite.EciVec3<number>,
  eciVel: satellite.EciVec3<number>,
  date: Date,
  secondIntoPass: number,
): PassGeometry {
  const gmst = satellite.gstime(date);
  const observerGd = toObserverGd(gs);

  // Satellite position in ECEF (for sub-satellite point)
  const ecf = satellite.eciToEcf(eciPos, gmst);

  // Look angles from ground station
  const lookAngles = satellite.ecfToLookAngles(observerGd, ecf);

  // Compute satellite geodetic position (for sub-satellite lat/lon)
  const satGeodetic = satellite.eciToGeodetic(eciPos, gmst);

  // Range rate: project relative velocity onto line-of-sight
  // Convert observer to ECI
  const observerEcf = satellite.geodeticToEcf(observerGd);
  const observerEci = satellite.ecfToEci(observerEcf, gmst);

  // Relative position and velocity
  const relPos = {
    x: eciPos.x - observerEci.x,
    y: eciPos.y - observerEci.y,
    z: eciPos.z - observerEci.z,
  };
  const range = Math.sqrt(relPos.x ** 2 + relPos.y ** 2 + relPos.z ** 2);

  // Unit vector along line of sight
  const unitR = { x: relPos.x / range, y: relPos.y / range, z: relPos.z / range };

  // Range rate = dot(relativeVelocity, unitRangeVector)
  // Observer velocity in ECI (Earth rotation)
  const earthRotRate = 7.2921159e-5; // rad/s
  const obsVelEci = {
    x: -earthRotRate * observerEci.y,
    y: earthRotRate * observerEci.x,
    z: 0,
  };

  const relVel = {
    x: eciVel.x - obsVelEci.x,
    y: eciVel.y - obsVelEci.y,
    z: eciVel.z - obsVelEci.z,
  };

  const rangeRate = relVel.x * unitR.x + relVel.y * unitR.y + relVel.z * unitR.z;

  // Satellite altitude
  const altitude = satGeodetic.height; // km

  return {
    timestamp: date,
    secondIntoPass,
    elevation_deg: satellite.radiansToDegrees(lookAngles.elevation),
    azimuth_deg: satellite.radiansToDegrees(lookAngles.azimuth),
    slantRange_km: lookAngles.rangeSat, // km
    rangeRate_km_s: rangeRate, // km/s
    altitude_km: altitude,
    subSatLat_deg: satellite.radiansToDegrees(satGeodetic.latitude),
    subSatLon_deg: satellite.radiansToDegrees(satGeodetic.longitude),
  };
}
