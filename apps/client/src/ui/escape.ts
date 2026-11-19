/**
 * HTML escaping for the UI builders.
 *
 * Inline markup is built with template strings in this codebase, so every value
 * that came from a player, a config file or the server goes through here before
 * it reaches `innerHTML`. Kept in one place: three copies drifted apart before,
 * and one of them forgot quotes.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
