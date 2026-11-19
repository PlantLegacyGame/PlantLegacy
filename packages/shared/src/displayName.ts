/**
 * Display names: the name other players see.
 *
 * One validator for both ends of the wire. The client uses it to accept a
 * nickname before it offers Play, the server uses it on `HELLO`, and neither can
 * drift because there is only this file. Usernames are a separate thing: an
 * account's `@handle` is unique and permanent, a display name is neither, so
 * this module deliberately does not enforce uniqueness or stability.
 *
 * Letters from any script are allowed. Nothing here trims a name down to ASCII:
 * a player who writes their name in their own alphabet should see it in game.
 */

export type DisplayNameError = 'empty' | 'too_long' | 'bad_characters';

export interface DisplayNameResult {
  ok: boolean;
  /** The cleaned value. Always set, even when `ok` is false, so a form can echo it. */
  value: string;
  error?: DisplayNameError;
}

/** Default when a caller has no configured limit. `config/ui.json` owns the real one. */
export const DISPLAY_NAME_MAX_LENGTH = 32;

const ALLOWED = /[\p{L}\p{N} _.-]/u;

/**
 * Trim, collapse runs of whitespace, and drop characters a name may not contain.
 * Control characters go first so a pasted zero-width or newline cannot split a
 * name into two.
 */
export function sanitizeDisplayName(raw: string): string {
  const withoutControls = Array.from(raw)
    // A line break or tab inside a pasted name is a separator, not a reason to
    // glue two words together.
    .map((ch) => (/\s/.test(ch) ? ' ' : ch))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      // Printable, and not a format character (zero-width joiners and friends).
      return code >= 0x20 && !/\p{Cf}/u.test(ch);
    })
    .join('');
  const collapsed = withoutControls.replace(/\s+/g, ' ').trim();
  let out = '';
  for (const ch of collapsed) {
    if (ALLOWED.test(ch)) out += ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

export function validateDisplayName(
  raw: string,
  maxLength: number = DISPLAY_NAME_MAX_LENGTH,
): DisplayNameResult {
  const value = sanitizeDisplayName(raw);
  if (value.length === 0) return { ok: false, value, error: 'empty' };
  if (value.length > maxLength) {
    return { ok: false, value: value.slice(0, maxLength), error: 'too_long' };
  }
  return { ok: true, value };
}

/** True when the raw input contains something the sanitizer would remove. */
export function hasDisallowedCharacters(raw: string): boolean {
  return sanitizeDisplayName(raw) !== raw.replace(/\s+/g, ' ').trim();
}
