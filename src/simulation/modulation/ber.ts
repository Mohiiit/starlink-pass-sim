// ============================================================
// Bit Error Rate (BER) Computation
// ============================================================
//
// Computes uncoded and coded BER for each modulation scheme.
//
// The erfc (complementary error function) is implemented via the
// Abramowitz & Stegun 7.1.26 polynomial approximation, which gives
// |error| < 1.5e-7 for all x >= 0.
//
// Modulation-specific BER formulas:
//   - QPSK: BER = 0.5 * erfc(sqrt(Eb/N0))
//   - M-PSK/M-APSK (M-QAM approximation):
//       BER = (2/log2(M)) * (1 - 1/sqrt(M)) * erfc(sqrt(3*log2(M)*EbN0/(2*(M-1))))
//
// Post-FEC BER uses a simplified model where coding gain is
// approximated by exponentiation of the uncoded BER.
// ============================================================

import type { ModCodEntry } from '../types';

// ---- Abramowitz & Stegun 7.1.26 erfc approximation ----
// erfc(x) = t * exp(-x^2 + polynomial(t))
// where t = 1 / (1 + 0.3275911 * x)
// Coefficients:
const ERFC_P = 0.3275911;
const ERFC_A1 = 0.254829592;
const ERFC_A2 = -0.284496736;
const ERFC_A3 = 1.421413741;
const ERFC_A4 = -1.453152027;
const ERFC_A5 = 1.061405429;

/**
 * Complementary error function via Horner approximation.
 * Accurate to |error| < 1.5e-7 for x >= 0.
 *
 * @param x - Input value (must be >= 0 for this approximation).
 * @returns erfc(x).
 */
export function erfc(x: number): number {
  // erfc(-x) = 2 - erfc(x) for negative inputs
  if (x < 0) return 2 - erfc(-x);

  const t = 1 / (1 + ERFC_P * x);
  const poly =
    ERFC_A1 * t +
    ERFC_A2 * t * t +
    ERFC_A3 * t * t * t +
    ERFC_A4 * t * t * t * t +
    ERFC_A5 * t * t * t * t * t;

  return t * poly * Math.exp(-x * x);
}

/**
 * Determine the constellation size M from modulation name.
 */
function modulationOrder(modulation: string): number {
  switch (modulation) {
    case 'QPSK':
      return 4;
    case '8PSK':
      return 8;
    case '16APSK':
      return 16;
    case '32APSK':
      return 32;
    case '64APSK':
      return 64;
    default:
      return 4;
  }
}

/**
 * Parse the code rate string (e.g., "3/4") into a numeric value.
 */
function parseCodeRate(rateStr: string): number {
  const parts = rateStr.split('/');
  if (parts.length === 2) {
    return parseInt(parts[0], 10) / parseInt(parts[1], 10);
  }
  return 0.5; // fallback
}

/**
 * Compute uncoded and coded BER for a given SNR and ModCod.
 *
 * @param snr_dB - Effective SNR in dB.
 * @param modcod - The active ModCod entry.
 * @returns Object with uncoded and coded BER values.
 */
export function computeBER(
  snr_dB: number,
  modcod: ModCodEntry,
): { uncoded: number; coded: number } {
  const M = modulationOrder(modcod.modulation);
  const specEff = modcod.spectralEfficiency;
  const codeRate = parseCodeRate(modcod.codeRate);

  // Convert SNR to Eb/N0: EbN0_dB = SNR_dB - 10*log10(spectralEfficiency)
  const ebN0_dB = snr_dB - 10 * Math.log10(specEff);
  const ebN0_linear = Math.pow(10, ebN0_dB / 10);

  // Guard against very low Eb/N0
  if (ebN0_linear <= 0) {
    return { uncoded: 0.5, coded: 0.5 };
  }

  let ber_uncoded: number;

  if (M === 4) {
    // QPSK: BER = 0.5 * erfc(sqrt(Eb/N0))
    ber_uncoded = 0.5 * erfc(Math.sqrt(ebN0_linear));
  } else {
    // General M-QAM/M-PSK approximation:
    // BER = (2/log2(M)) * (1 - 1/sqrt(M)) * erfc(sqrt(3*log2(M)*EbN0/(2*(M-1))))
    const log2M = Math.log2(M);
    const sqrtM = Math.sqrt(M);
    const prefactor = (2 / log2M) * (1 - 1 / sqrtM);
    const argument = Math.sqrt((3 * log2M * ebN0_linear) / (2 * (M - 1)));
    ber_uncoded = prefactor * erfc(argument);
  }

  // Clamp uncoded BER to physical range
  ber_uncoded = Math.max(0, Math.min(0.5, ber_uncoded));

  // ---- Post-FEC (coded) BER ----
  // Simplified model: BER_coded = BER_uncoded^(1 + 2*codeRate)
  // At rate 1/2: exponent = 2.0 (strong coding gain)
  // At rate 3/4: exponent = 2.5 (moderate coding gain)
  // At rate 1/4: exponent = 1.5 (very strong coding, diminishing returns on exponent)
  const codingExponent = 1 + 2 * codeRate;
  const ber_coded = Math.pow(ber_uncoded, codingExponent);

  return {
    uncoded: ber_uncoded,
    coded: ber_coded,
  };
}
