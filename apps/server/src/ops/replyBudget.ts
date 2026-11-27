/**
 * Per-player cooldowns for replies that cost far more than the request.
 *
 * The socket-wide token bucket caps how often a client may ask, not how much
 * one answer costs: a full resource grid is ~262 KB, a plant sync carries every
 * visible node, and a terrain region is tens of KB. A client has no legitimate
 * reason to ask for any of them at message rate, so each gets its own minimum
 * interval. The budget is keyed by request kind on one player, keeping the
 * rules independent without three more fields on the connection.
 */
export interface ReplyBudget {
  lastAllowedAt: Map<string, number>;
}

export function createReplyBudget(): ReplyBudget {
  return { lastAllowedAt: new Map() };
}

/**
 * True when this request kind may run now, and stamps the attempt.
 *
 * A clock that moves backwards is treated as too soon rather than as an
 * unlimited burst. A non-positive interval disables the cooldown.
 */
export function allowReply(
  budget: ReplyBudget,
  kind: string,
  nowMs: number,
  minIntervalMs: number,
): boolean {
  const interval = Number.isFinite(minIntervalMs) ? Math.max(0, minIntervalMs) : 0;
  const last = budget.lastAllowedAt.get(kind);
  if (last !== undefined && nowMs - last < interval) return false;
  budget.lastAllowedAt.set(kind, nowMs);
  return true;
}
