/**
 * The drawn growth progress of one part.
 *
 * Growth is a render-time scale from 0 to 1, and the client recomputes it every
 * time a plant packet arrives. That recomputation is where the whole plant could
 * vanish: a node's progress was derived from `serverTick - growthStartTick`, and
 * whenever the client's tick estimate was behind the node's start tick - a packet
 * from a newer tick, a reconnect, any clock skew - that subtraction clamped to 0.
 * Every node in that packet then had progress 0, so every segment drew at zero
 * length and the plant disappeared until a later packet agreed again.
 *
 * The rule here is therefore conservative, and deliberately boring:
 *
 * 1. An explicit server progress is trusted, but it may not un-grow a part we
 *    have already drawn: growth is one-way, so the drawn value only ever rises.
 *    (Measured: a growing radicle's mirror progress went 0.95 then 0.55 on a
 *    later packet. The drawn root snapped back, and the Root Sight cavity - whose
 *    mouth follows the part's drawn radius - collapsed with it, which the player
 *    reported as the view vanishing mid-growth.)
 * 2. Tick arithmetic is only trusted when the arithmetic is possible at all: a
 *    negative elapsed tick is not "zero progress", it is an answer the client
 *    cannot give yet, so it falls through instead.
 * 3. Falling through keeps what we last knew, and a node we have never seen is
 *    a finished part, not an invisible one. A missing answer never erases a part.
 */

export interface DrawnProgressInput {
  /** Progress the server sent for this node, if any. */
  serverProgress?: number | null;
  /** The client's estimate of the current server tick, if any. */
  serverTick?: number | null;
  /** The tick this node's growth began on, if the server sent one. */
  growthStartTick?: number | null;
  /** The node's growth duration in seconds, if the server sent one. */
  growthTimeSeconds?: number | null;
  /** The progress this client already drew for the node, if it knows the node. */
  previousProgress?: number | null;
  /** Server tick rate, used to turn a duration in seconds into ticks. */
  tickRateHz?: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** True when `serverTick - growthStartTick` means something. */
export function tickProgressIsMeaningful(
  serverTick: number | null | undefined,
  growthStartTick: number | null | undefined,
): boolean {
  const tick = finiteOrNull(serverTick);
  const start = finiteOrNull(growthStartTick);
  if (tick === null || start === null) return false;
  // A client that has not seen a tick yet knows nothing, and a node that starts
  // in the future cannot have grown: both are "no answer", not "zero".
  return tick > 0 && start <= tick;
}

export function resolveDrawnProgress(input: DrawnProgressInput): number {
  const explicit = finiteOrNull(input.serverProgress);
  const previous = finiteOrNull(input.previousProgress);
  // Growth is one-way. An explicit number is the server's answer about how far a
  // part has grown, and it may not hear about progress the client has already
  // drawn - a packet built before the last tick, or one for a part whose growth
  // was re-stamped. Honouring a smaller number un-grows the part on screen: the
  // segment shortens, and the Root Sight cavity, which is sized from what the
  // parts have dug, closes part of the way and then reopens. A part that has been
  // drawn grown stays grown; only the parts that are still rising are affected,
  // and only in the direction they were already going.
  if (explicit !== null) {
    const floor = previous !== null ? clamp01(previous) : 0;
    return clamp01(Math.max(floor, clamp01(explicit)));
  }

  const tick = finiteOrNull(input.serverTick);
  const start = finiteOrNull(input.growthStartTick);
  const seconds = finiteOrNull(input.growthTimeSeconds);
  const rate = finiteOrNull(input.tickRateHz) ?? 20;

  if (
    tick !== null &&
    start !== null &&
    seconds !== null &&
    seconds > 0 &&
    tickProgressIsMeaningful(tick, start)
  ) {
    const durationTicks = seconds * Math.max(1, rate);
    const derived = (tick - start) / durationTicks;
    // A part we already drew as grown is not un-grown by an earlier packet: the
    // server is authoritative about its own number, not about this arithmetic.
    const floor = previous !== null ? clamp01(previous) : 0;
    return clamp01(Math.max(floor, derived));
  }

  if (previous !== null) return clamp01(previous);
  // Unknown node, no server number: draw it whole. A part that exists is a part
  // the player has already paid for.
  return 1;
}

/**
 * One part's health, as every consumer should read it.
 *
 * The server sends `health` as a fraction of that part's tissue quota, so a
 * finished node reads 1 and a damaged one reads below it. Two client paths used
 * to ignore that field and invent a number as `biomass / 10` instead: a young
 * stem holds a few tenths of a unit of biomass, so `0.4 / 10` is 0.04, and the
 * inspect panel called every part on the plant "Depleted" while the panel's own
 * numbers said the plant was healthy.
 *
 * A node without the field is drawn as intact. A missing answer is not damage,
 * and inventing damage is worse than saying nothing: the panel is the only place
 * a player can read what is wrong with a part.
 */
// The wire shapes differ between messages and not all of them declare the field,
// so the presence check is the type check.
export function clientNodeHealth(node: object): number {
  const health = (node as { health?: unknown }).health;
  if (typeof health === 'number' && Number.isFinite(health)) return clamp01(health);
  return 1;
}
