/**
 * Broadcast cadence helpers (INV-TM-09).
 *
 * A tick may run at 20 Hz while the wire only needs a payload at
 * `client_send_rate_hz`. Banking elapsed milliseconds rather than testing
 * `tick % interval` keeps the rate exact when the tick rate changes and avoids
 * sending a burst after a dev rate change.
 */
export interface CadenceStep {
  due: boolean;
  /** Accumulated time to carry into the next tick. */
  nextAccumulatorMs: number;
}

export function cadenceIntervalMs(sendRateHz: number): number {
  return 1000 / Math.max(1, sendRateHz);
}

export function stepCadence(accumulatorMs: number, dtMs: number, sendRateHz: number): CadenceStep {
  const interval = cadenceIntervalMs(sendRateHz);
  if (!(dtMs > 0)) return { due: false, nextAccumulatorMs: accumulatorMs };
  const accumulated = Math.max(0, accumulatorMs) + dtMs;
  if (accumulated + 1e-9 < interval) return { due: false, nextAccumulatorMs: accumulated };
  // Keep the remainder so a 30 Hz tick feeding a 20 Hz wire sends at 20 Hz
  // rather than rounding every interval up to a whole tick.
  return { due: true, nextAccumulatorMs: accumulated % interval };
}
