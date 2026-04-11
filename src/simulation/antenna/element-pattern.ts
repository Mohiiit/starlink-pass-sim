// ============================================================
// Individual Patch Element Radiation Pattern
// ============================================================
//
// Each element in the phased array is a microstrip patch antenna.
// The far-field radiation pattern of a patch is well-approximated
// by a cos^q(theta) envelope, where q controls the beamwidth.
//
// For a typical Ku-band patch on a ground plane:
//   G_element(theta) = G_max * cos^q(theta)
//
// In dBi:
//   G_element_dBi(theta) = G_max_dBi + q * 10*log10(cos(theta))
//
// Physical motivation:
//   - cos(theta) arises from the projected aperture area shrinking
//     as you move off boresight.
//   - The exponent q > 1 accounts for the additional rolloff from
//     the patch's finite ground plane and substrate effects.
//   - q = 1.35 is a typical measured value for Ku-band patches
//     with moderate substrate permittivity (εr ~ 3).
//
// Edge case:
//   - For |theta| >= 90°, the element radiates into the back
//     hemisphere. We clamp to a -50 dBi floor (physical: the
//     ground plane provides ~25 dB front-to-back ratio, but we
//     use -50 dBi as a safe numerical floor to avoid -Infinity).
// ============================================================

import {
  ELEMENT_MAX_GAIN_DBI,
  ELEMENT_PATTERN_EXPONENT,
} from '../../lib/constants';

/** Minimum gain floor in dBi — avoids -Infinity for theta >= 90° */
const GAIN_FLOOR_DBI = -50;

/**
 * Compute the element radiation pattern gain at a given scan angle.
 *
 * @param theta_deg - Off-boresight angle in degrees (0 = boresight)
 * @returns Element gain in dBi
 */
export function elementGain_dBi(theta_deg: number): number {
  const absTheta = Math.abs(theta_deg);

  // Beyond 90°, the element looks into the back hemisphere.
  // Physical antennas have finite back-lobe levels; we clamp
  // to a floor rather than returning -Infinity.
  if (absTheta >= 90) {
    return GAIN_FLOOR_DBI;
  }

  const theta_rad = (absTheta * Math.PI) / 180;
  const cosTheta = Math.cos(theta_rad);

  // cos(theta) is guaranteed positive for |theta| < 90°,
  // so log10 is safe here.
  //
  // G_element_dBi = G_max_dBi + q * 10*log10(cos(theta))
  //
  // This is equivalent to: 10*log10(G_max_linear * cos^q(theta))
  const gain_dBi =
    ELEMENT_MAX_GAIN_DBI +
    ELEMENT_PATTERN_EXPONENT * 10 * Math.log10(cosTheta);

  // Clamp to floor (shouldn't happen for theta < 90°, but be safe)
  return Math.max(gain_dBi, GAIN_FLOOR_DBI);
}
