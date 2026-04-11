// RF Chain — combines PA, oscillator, and signal quality into unified state

import type { RFChainState } from '../types';
import { computePAState } from './power-amplifier';
import { computeOscillatorState } from './oscillator';
import { computeSignalQuality } from './signal-quality';

export { computePAState } from './power-amplifier';
export { computeOscillatorState } from './oscillator';
export { computeSignalQuality } from './signal-quality';

/**
 * Compute full RF chain state for a single simulation tick.
 *
 * @param desiredBackoff_dB  Target PA output backoff from P_sat
 * @param paTemp_C           PA junction temperature
 * @param oscTemp_C          Oscillator temperature
 * @param channelBW_Hz       Channel bandwidth (for oscillator EVM calc)
 * @param faultP1dBReduction_dB  Additional P1dB reduction from faults (default 0)
 * @param faultFreqOffset_Hz     Additional frequency offset from faults (default 0)
 * @param faultOscUnlock         Force oscillator unlock from fault (default false)
 */
export function computeRFChainState(
  desiredBackoff_dB: number,
  paTemp_C: number,
  oscTemp_C: number,
  channelBW_Hz: number,
  faultP1dBReduction_dB: number = 0,
  faultFreqOffset_Hz: number = 0,
  faultOscUnlock: boolean = false,
): RFChainState {
  const pa = computePAState(desiredBackoff_dB, paTemp_C, faultP1dBReduction_dB);
  const oscillator = computeOscillatorState(oscTemp_C, channelBW_Hz, faultFreqOffset_Hz, faultOscUnlock);
  const { totalEVM_percent, snrPenalty_dB } = computeSignalQuality(
    pa,
    oscillator,
  );

  return {
    pa,
    oscillator,
    totalEVM_percent,
    snrPenalty_dB,
    txPower_dBm: pa.outputPower_dBm,
  };
}
