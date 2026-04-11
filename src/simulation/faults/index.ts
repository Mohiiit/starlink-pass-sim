// Faults — re-exports
export {
  getScenarioFaults,
  createInitialFaultState,
  stepFaults,
} from './fault-scheduler';
export {
  applyAntennaFaults,
  applyPAFaults,
  applyOscillatorFaults,
  applyPowerFaults,
  applyThermalFaults,
  applyComputeFaults,
} from './fault-applicator';
