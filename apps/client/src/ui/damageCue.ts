/**
 * When the damage vignette may pulse.
 *
 * PLANT_DAMAGE arrives at the damage pipeline's flush rate - up to 10 Hz while a
 * storm or a swarm is taking tissue, and once per tick for upkeep loss. The cue
 * is a short fade, so starting one on every message left the edge overlay in its
 * first tenth permanently: the screen read as a dark/bright blink instead of a
 * hit. The rule is one pulse, then a gap at least as long as the pulse itself.
 */

/** The shortest gap between two pulses, whatever `damage_vignette_ms` says. */
export const MIN_DAMAGE_CUE_GAP_MS = 1000;

/** True when a new damage cue may start now. */
export function damageCueDue(params: {
  nowMs: number;
  lastPulseAtMs: number;
  /** `ui.damage_vignette_ms`: how long the fade runs. */
  pulseMs: number;
  /** False once the previous animation has finished. */
  running: boolean;
}): boolean {
  if (params.running) return false;
  if (!Number.isFinite(params.lastPulseAtMs)) return true;
  const gap = Math.max(params.pulseMs, MIN_DAMAGE_CUE_GAP_MS);
  return params.nowMs - params.lastPulseAtMs >= gap;
}
