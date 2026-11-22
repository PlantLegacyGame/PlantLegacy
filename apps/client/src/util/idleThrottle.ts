/**
 * When the render loop may drop to its idle cadence.
 *
 * `idle_drop_timeout_ms` has been in `config/render.json` and in the C01 record
 * since the client foundation, and nothing ever read it: the loop asked for sixty
 * frames a second forever, even with a still world and no hand on the machine.
 * The rule is one comparison, kept here so it can be tested without a renderer.
 */

/** True when no real input has arrived for the configured timeout. */
export function shouldIdleRender(nowMs: number, lastInputMs: number, timeoutMs: number): boolean {
  // 0 and a missing value both mean "never": the setting is opt-out.
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return false;
  if (!Number.isFinite(nowMs) || !Number.isFinite(lastInputMs)) return false;
  return nowMs - lastInputMs >= timeoutMs;
}
