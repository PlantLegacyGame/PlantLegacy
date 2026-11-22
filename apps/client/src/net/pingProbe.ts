/**
 * Connection-health probing: one PING in flight, timed from its own send.
 *
 * The interval used to stamp the clock only when no probe was pending, so a
 * probe that never answered kept its five-second-old timestamp and the next
 * PONG was measured from it. The dot then reported the interval as the round
 * trip - the 500 ms "ping" on a loopback link - instead of the real latency.
 * Every send starts a fresh probe here, so a stale timestamp cannot survive.
 */

export interface PingProbeOpen {
  /** When this probe was sent, on the caller's clock. */
  sentAt: number;
  /** True when the previous probe outlived the stall window. */
  stalled: boolean;
}

/** Start a probe. A probe still pending past `stallMs` marks the link stalled. */
export function openPingProbe(
  previousSentAt: number | null,
  now: number,
  stallMs: number,
): PingProbeOpen {
  const stalled =
    previousSentAt !== null && Number.isFinite(previousSentAt) && now - previousSentAt > stallMs;
  return { sentAt: now, stalled };
}

/** The round trip for a finished probe, or null when nothing was pending. */
export function closePingProbe(sentAt: number | null, now: number): number | null {
  if (sentAt === null || !Number.isFinite(sentAt) || !Number.isFinite(now)) return null;
  const rtt = Math.round(now - sentAt);
  return rtt >= 0 ? rtt : null;
}
