/**
 * A breadcrumb of what this session was doing, kept across a reload.
 *
 * The avatar reboot was reported and never reproduced: the picker ran clean with
 * a 48 MB decode, the page did not reload, and the player never touched a GPU
 * texture. That is exactly the case where guessing is worse than instrumenting,
 * because a crash leaves no console - the tab is simply gone and a new page
 * starts with nothing to say.
 *
 * So every session writes what it did into `localStorage`, and every session
 * reads the previous one's tail at boot. If the last session never wrote its
 * unload marker, the page did not navigate away: it was killed (renderer crash,
 * out of memory, GPU process loss). The entries before that point name the
 * action that preceded it, which is the fact a report needs.
 *
 * Bounded and cheap: forty entries, written only at interesting moments. Pure
 * over an injected storage object, so the behaviour is testable without a DOM.
 */

export const JOURNAL_KEY = 'plantlegacy:journal';
export const JOURNAL_VERSION = 1;
/** How many entries survive; the newest are the ones that matter. */
export const MAX_JOURNAL_ENTRIES = 40;

export interface JournalEntry {
  /** Wall clock, so the value still means something after a reload. */
  at: number;
  /** What happened: `boot`, `avatar.picked`, `device.lost`, ... */
  kind: string;
  detail?: Record<string, unknown>;
}

export interface SessionJournal {
  entries: JournalEntry[];
  /** True when the session that wrote this last record left on purpose. */
  endedCleanly: boolean;
}

export interface JournalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type PreviousSession = 'clean' | 'crashed' | 'first-run';

const EMPTY: SessionJournal = { entries: [], endedCleanly: false };

function isEntry(value: unknown): value is JournalEntry {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.at === 'number' && typeof record.kind === 'string';
}

/** Read the stored journal, treating anything unreadable as "no history". */
export function loadJournal(storage: JournalStorage): SessionJournal {
  let raw: string | null = null;
  try {
    raw = storage.getItem(JOURNAL_KEY);
  } catch {
    return { ...EMPTY };
  }
  if (!raw) return { ...EMPTY };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const entries = Array.isArray(parsed.entries) ? parsed.entries.filter(isEntry) : [];
    return { entries, endedCleanly: parsed.endedCleanly === true };
  } catch {
    // A half-written value is not worth a broken boot.
    return { ...EMPTY };
  }
}

function save(storage: JournalStorage, journal: SessionJournal): void {
  try {
    storage.setItem(JOURNAL_KEY, JSON.stringify({ v: JOURNAL_VERSION, ...journal }));
  } catch {
    // Storage can be full or blocked; diagnostics must never break the game.
  }
}

/** Append one entry, dropping the oldest past the cap. */
export function recordEvent(storage: JournalStorage, entry: JournalEntry): SessionJournal {
  const current = loadJournal(storage);
  const entries = [...current.entries, entry].slice(-MAX_JOURNAL_ENTRIES);
  const next: SessionJournal = { entries, endedCleanly: false };
  save(storage, next);
  return next;
}

/** The session left on purpose: a reload, a navigation, a closed tab. */
export function markCleanExit(storage: JournalStorage, at: number): void {
  const current = loadJournal(storage);
  save(storage, {
    entries: [...current.entries, { at, kind: 'exit' }].slice(-MAX_JOURNAL_ENTRIES),
    endedCleanly: true,
  });
}

/** Why the previous session stopped, as far as its own records can tell. */
export function previousSessionEnd(journal: SessionJournal): PreviousSession {
  if (journal.entries.length === 0) return 'first-run';
  return journal.endedCleanly ? 'clean' : 'crashed';
}

/**
 * The last thing the previous session did, in one line: what an "it rebooted"
 * report needs, without a console that no longer exists.
 */
export function describeLastAction(journal: SessionJournal): string {
  const last = journal.entries.at(-1);
  if (!last) return 'nothing recorded';
  const detail = last.detail
    ? Object.entries(last.detail)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' ')
    : '';
  return detail ? `${last.kind} (${detail})` : last.kind;
}
