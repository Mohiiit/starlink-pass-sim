// Signal quality aggregation — combines EVM contributions from PA, oscillator,
// and quantization noise into total EVM and SNR penalty.

import type { PowerAmplifierState, OscillatorState } from '../types';

// ADC/DAC quantization noise floor contribution
const EVM_QUANTIZATION_PERCENT = 0.5;

/**
 * Combine EVM contributions from all RF chain sources and compute SNR penalty.
 *
 * @param pa   Power amplifier state (for EVM contribution)
 * @param osc  Oscillator state (for EVM contribution)
 */
export function computeSignalQuality(
  pa: PowerAmplifierState,
  osc: OscillatorState,
): { totalEVM_percent: number; snrPenalty_dB: number } {
  // ---- RSS combination of independent EVM sources ----
  const evmPA = pa.evmContribution_percent;
  const evmOsc = osc.evmContribution_percent;
  const evmQuant = EVM_QUANTIZATION_PERCENT;

  const totalEVM_percent = Math.sqrt(
    evmPA * evmPA + evmOsc * evmOsc + evmQuant * evmQuant,
  );

  // ---- SNR penalty from EVM ----
  // EVM reduces effective SNR. For small EVM (<10%):
  // snrPenalty_dB = -20*log10(1 - (EVM/100)^2)
  const evmFraction = totalEVM_percent / 100;
  const evmSquared = evmFraction * evmFraction;

  // Guard: if EVM is so large that 1 - evm^2 <= 0, clamp to massive penalty
  const inner = 1 - evmSquared;
  const snrPenalty_dB =
    inner > 0 ? -20 * Math.log10(inner) : 20; // 20 dB cap for catastrophic EVM

  return {
    totalEVM_percent,
    snrPenalty_dB,
  };
}
