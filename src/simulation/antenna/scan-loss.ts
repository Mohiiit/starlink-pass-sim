// ============================================================
// Phased Array Scan Loss Model
// ============================================================
//
// When a phased array steers its beam off boresight, several
// mechanisms reduce the effective radiated power:
//
// 1. PROJECTED APERTURE LOSS
//    The physical aperture projected toward the target shrinks
//    as cos(theta). For a planar array, the effective area is
//    A_eff = A_physical * cos(theta). In practice, the rolloff
//    is slightly steeper due to element mutual coupling changes,
//    so we use cos^1.2(theta) as a well-established empirical fit.
//
// 2. ACTIVE REFLECTION COEFFICIENT
//    As the beam steers, the impedance seen by each element
//    changes due to mutual coupling. The active reflection
//    coefficient Gamma increases with scan angle:
//      |Gamma(theta)| ≈ 0.05 + 0.15 * (theta/90)^2
//    At boresight: Gamma ≈ 0.05 (well-matched, VSWR ~ 1.1)
//    At 60°: Gamma ≈ 0.12 (VSWR ~ 1.3, typical for phased arrays)
//    At 90°: Gamma ≈ 0.20 (significant mismatch)
//    The power delivered to free space is reduced by (1 - |Gamma|^2).
//
// 3. MUTUAL COUPLING VARIATION
//    Beyond the reflection coefficient, mutual coupling causes
//    amplitude and phase errors across the aperture. At large
//    scan angles (>50°), edge elements couple more strongly,
//    causing an additional ~0.5–1.0 dB degradation. We model
//    this as a smooth rolloff that activates above 50°.
//
// Combined scan efficiency:
//   eta_scan(theta) = cos^1.2(theta) * (1 - |Gamma(theta)|^2) * eta_coupling(theta)
//
// Returned as scan loss in dB (negative value, representing loss).
// ============================================================

/**
 * Compute the active reflection coefficient magnitude at a given
 * steering angle. Models impedance mismatch growth with scan.
 *
 * @param theta_deg - Steering angle in degrees (0 = boresight)
 * @returns |Gamma| (dimensionless, 0 to 1)
 */
export function activeReflectionCoefficient(theta_deg: number): number {
  const absTheta = Math.abs(theta_deg);
  const normalized = absTheta / 90; // 0 at boresight, 1 at 90°

  // Quadratic growth: well-matched at boresight, increasing mismatch at scan
  const gamma = 0.05 + 0.15 * normalized * normalized;

  // Physical bound: reflection coefficient can't exceed 1
  return Math.min(gamma, 1.0);
}

/**
 * Compute mutual coupling degradation factor.
 * Below 50° this is negligible; above 50° it ramps up to ~1 dB at 60°
 * and continues growing at extreme angles.
 *
 * @param theta_deg - Steering angle in degrees
 * @returns Coupling loss in dB (negative value)
 */
function mutualCouplingLoss_dB(theta_deg: number): number {
  const absTheta = Math.abs(theta_deg);

  if (absTheta <= 50) {
    // Below 50°, coupling variation is negligible
    return 0;
  }

  // Smooth ramp: 0 dB at 50°, ~0.7 dB at 60°, ~2.5 dB at 70°
  // Uses a cubic ramp for physical smoothness (no discontinuity in derivative)
  const excessAngle = absTheta - 50; // 0 to 40 range
  const normalized = excessAngle / 20; // 0 at 50°, 1.0 at 70°

  // Cubic gives smooth onset: 0.5 * x^2 + 0.5 * x^3
  // At 60° (norm=0.5): 0.5*0.25 + 0.5*0.125 = 0.188 dB (modest)
  // At 70° (norm=1.0): 0.5*1.0 + 0.5*1.0 = 1.0 dB
  // Scale to reach ~0.7 dB at 60° and ~2.5 dB at 70°
  const loss = 2.5 * (0.5 * normalized * normalized + 0.5 * normalized * normalized * normalized);

  return -loss; // Return as negative (it's a loss)
}

/**
 * Compute the total scan loss for a given steering angle.
 *
 * Combines:
 *   1. Projected aperture loss: cos^1.2(theta)
 *   2. Impedance mismatch loss: (1 - |Gamma|^2)
 *   3. Mutual coupling degradation
 *
 * @param theta_deg - Steering angle in degrees (0 = boresight)
 * @returns Total scan loss in dB (negative value, representing loss)
 */
export function scanLoss_dB(theta_deg: number): number {
  const absTheta = Math.abs(theta_deg);

  // At boresight, no scan loss
  if (absTheta === 0) {
    return 0;
  }

  // Clamp to physical range — beyond 90° the beam is in the back hemisphere
  const clampedTheta = Math.min(absTheta, 89.99);
  const theta_rad = (clampedTheta * Math.PI) / 180;

  // 1. Projected aperture with empirical exponent
  //    cos^1.2(theta) — slightly steeper than pure geometric cos
  //    because element patterns also contribute to the rolloff
  const cosProjection = Math.pow(Math.cos(theta_rad), 1.2);

  // 2. Reflection coefficient mismatch loss
  //    Power lost to reflection: factor = (1 - |Gamma|^2)
  const gamma = activeReflectionCoefficient(clampedTheta);
  const mismatchFactor = 1 - gamma * gamma;

  // Combined efficiency (linear scale)
  const etaScan = cosProjection * mismatchFactor;

  // Convert to dB
  const projectionAndMismatch_dB = 10 * Math.log10(etaScan);

  // 3. Add mutual coupling loss (already in dB, negative)
  const couplingLoss = mutualCouplingLoss_dB(clampedTheta);

  // Total scan loss (negative value)
  return projectionAndMismatch_dB + couplingLoss;
}
