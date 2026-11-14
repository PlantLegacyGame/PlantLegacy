/**
 * Per-connection inbound message budget.
 *
 * Every other limit in the server is per message *type* (chat, reports, growth
 * intents). That left a connection free to send any number of malformed,
 * unknown or state-mutating messages per second, bounded only by the 16 KB
 * payload cap — the cheapest way to burn the tick budget from one socket.
 *
 * A token bucket is the right shape here: it tolerates the bursts a real client
 * produces (a tick's worth of INPUT plus a growth intent) while capping the
 * sustained rate to something a client can actually need.
 */

export interface TokenBucket {
  tokens: number;
  lastRefillMs: number;
}

/** Start full: a fresh connection may spend its whole burst immediately. */
export function createTokenBucket(capacity: number, nowMs: number): TokenBucket {
  return { tokens: Math.max(1, capacity), lastRefillMs: nowMs };
}

/**
 * Refill by elapsed time, then spend one token.
 *
 * Takes `nowMs` from the caller so the bucket is testable without a clock, and
 * clamps both refill and capacity: a clock that jumps backwards must not create
 * tokens, and a long idle period must not bank more than the burst.
 */
export function tokenBucketAllow(
  bucket: TokenBucket,
  nowMs: number,
  ratePerSecond: number,
  capacity: number,
): boolean {
  const cap = Math.max(1, capacity);
  const rate = Math.max(0, ratePerSecond);

  const elapsedSeconds = Math.max(0, nowMs - bucket.lastRefillMs) / 1000;
  if (elapsedSeconds > 0) {
    bucket.tokens = Math.min(cap, bucket.tokens + elapsedSeconds * rate);
    bucket.lastRefillMs = nowMs;
  } else if (nowMs > bucket.lastRefillMs) {
    bucket.lastRefillMs = nowMs;
  }

  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}
