/**
 * Countdown text for a season. A season is measured in days, so the label must
 * not switch to seconds until there is genuinely less than a minute left: a
 * ticking "51840s" reads like a stopwatch, not a calendar.
 */
export function formatSeasonRemaining(totalSeconds: number): string {
  const seconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);

  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} m`;
  if (minutes > 0) return `${minutes} m`;
  return `${seconds} s`;
}

/** "Season 3 · 34 d 12 h" — the whole chip, so the HUD has one source of truth. */
export function formatSeasonChip(season: number, remainingSeconds: number): string {
  return `Season ${season} · ${formatSeasonRemaining(remainingSeconds)}`;
}
