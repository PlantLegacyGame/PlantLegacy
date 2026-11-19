/**
 * Title plant animation state.
 *
 * The plant breathes (one slow sway) and reacts when touched. Both are time-based
 * and pure, so the DOM only writes transform values. Reactions are rate-limited:
 * holding a finger on the plant must not stack into a shivering mess.
 */

export interface PlantMotionState {
  /** Position in the sway cycle, 0 to 1. */
  phase: number;
  /** Timestamp until which a reaction is playing. */
  reactUntilMs: number;
  /** Earliest timestamp the next reaction may start. */
  nextReactAtMs: number;
  /** Counts reactions, so a caller can log or reward the Nth touch. */
  reactCount: number;
}

export function createPlantMotion(): PlantMotionState {
  return { phase: 0, reactUntilMs: 0, nextReactAtMs: 0, reactCount: 0 };
}

export function advanceSway(state: PlantMotionState, dtMs: number, swayMs: number): void {
  if (swayMs <= 0) return;
  state.phase = (state.phase + dtMs / swayMs) % 1;
}

/** Sway in the range -1..1. Sine, so it starts and ends at rest. */
export function swayOffset(state: PlantMotionState): number {
  return Math.sin(state.phase * Math.PI * 2);
}

export interface PlantReactResult {
  reacted: boolean;
  state: PlantMotionState;
}

export function reactToTouch(
  state: PlantMotionState,
  nowMs: number,
  reactMs: number,
  cooldownMs: number,
): PlantReactResult {
  if (nowMs < state.nextReactAtMs) return { reacted: false, state };
  const next: PlantMotionState = {
    ...state,
    reactUntilMs: nowMs + reactMs,
    nextReactAtMs: nowMs + Math.max(reactMs, cooldownMs),
    reactCount: state.reactCount + 1,
  };
  return { reacted: true, state: next };
}

export function reactionProgress(state: PlantMotionState, nowMs: number, reactMs: number): number {
  if (nowMs >= state.reactUntilMs || reactMs <= 0) return 0;
  const remaining = state.reactUntilMs - nowMs;
  return Math.max(0, Math.min(1, remaining / reactMs));
}

/**
 * Scale during a reaction: a quick perk up, then back. Peaks early so the touch
 * reads as a response rather than a slow swell.
 */
export function reactionScale(state: PlantMotionState, nowMs: number, reactMs: number): number {
  const progress = reactionProgress(state, nowMs, reactMs);
  if (progress === 0) return 1;
  const t = 1 - progress;
  return 1 + 0.06 * Math.sin(Math.min(1, t * 1.6) * Math.PI);
}
