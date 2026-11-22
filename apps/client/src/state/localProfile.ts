/**
 * What the menu remembers about this browser.
 *
 * A display name and an avatar, kept locally so a guest can name themselves and
 * see their own picture before they have an account. This is not identity: the
 * name is sent with `HELLO` and the server sanitises it, and the avatar never
 * leaves the device. When avatars move onto accounts, this stays the guest path
 * and the account becomes the owner for signed-in players.
 *
 * The storage object is injected so the behaviour can be tested without a DOM.
 */

export interface ProfileStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LocalProfile {
  displayName: string;
  /** Data URL for the avatar, or null for the default mark. */
  avatar: string | null;
  /**
   * True once the first world entry has taught the core loop.
   *
   * The walking instructions are worth saying once. Saying them on every entry
   * turns the first thing a returning player sees into a tutorial they already
   * finished, and hiding them behind a panel makes them unfindable.
   */
  tutorialSeen: boolean;
}

export const PROFILE_KEY = 'plantlegacy:profile';

/**
 * Largest avatar this profile will load back, in characters of data URL.
 *
 * Uploads are shrunk to 128 px before they are stored (`MainMenu.storeAvatar`),
 * so a real avatar is a few kilobytes. The ceiling exists for values written by
 * an older build, when the picked file's own data URL went into storage: loading
 * one of those back is megabytes of base64 parsed on boot for a 30 px circle.
 */
export const MAX_AVATAR_DATA_URL = 256 * 1024;

/** Only data URLs are accepted back: a stored `javascript:` URL is not an image. */
function readAvatar(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('data:image/')) return null;
  if (value.length > MAX_AVATAR_DATA_URL) return null;
  return value;
}

export function loadProfile(storage: ProfileStorage): LocalProfile {
  try {
    const raw = storage.getItem(PROFILE_KEY);
    if (!raw) return { displayName: '', avatar: null, tutorialSeen: false };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null)
      return { displayName: '', avatar: null, tutorialSeen: false };
    const record = parsed as Record<string, unknown>;
    return {
      displayName: typeof record.displayName === 'string' ? record.displayName : '',
      avatar: readAvatar(record.avatar),
      tutorialSeen: record.tutorialSeen === true,
    };
  } catch {
    // A corrupt entry is not worth a broken menu: start clean and overwrite.
    return { displayName: '', avatar: null, tutorialSeen: false };
  }
}

export function saveProfile(storage: ProfileStorage, profile: Partial<LocalProfile>): LocalProfile {
  const current = loadProfile(storage);
  const next: LocalProfile = {
    displayName: profile.displayName ?? current.displayName,
    avatar: profile.avatar === undefined ? current.avatar : readAvatar(profile.avatar),
    tutorialSeen: profile.tutorialSeen ?? current.tutorialSeen,
  };
  try {
    storage.setItem(PROFILE_KEY, JSON.stringify(next));
  } catch {
    // Storage can be full or blocked. The menu still works in the session.
  }
  return next;
}
