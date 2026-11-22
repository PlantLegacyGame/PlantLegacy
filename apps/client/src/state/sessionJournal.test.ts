import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  describeLastAction,
  JOURNAL_KEY,
  loadJournal,
  MAX_JOURNAL_ENTRIES,
  markCleanExit,
  previousSessionEnd,
  recordEvent,
} from './sessionJournal.ts';

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(JOURNAL_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    raw: () => values.get(JOURNAL_KEY) ?? null,
  };
}

describe('the session journal', () => {
  it('reads nothing as an empty, first-run history', () => {
    const journal = loadJournal(memoryStorage());
    assert.deepEqual(journal.entries, []);
    assert.equal(previousSessionEnd(journal), 'first-run');
  });

  it('tells a session that was killed from one that left on purpose', () => {
    // A killed tab writes no exit marker: the entries stop mid-action.
    const killed = memoryStorage();
    recordEvent(killed, { at: 1, kind: 'boot' });
    recordEvent(killed, { at: 2, kind: 'avatar.stored', detail: { chars: 1511 } });
    assert.equal(previousSessionEnd(loadJournal(killed)), 'crashed');
    assert.equal(
      describeLastAction(loadJournal(killed)),
      'avatar.stored (chars=1511)',
      'the report names the action the crash followed',
    );

    const deliberate = memoryStorage();
    recordEvent(deliberate, { at: 1, kind: 'boot' });
    markCleanExit(deliberate, 2);
    assert.equal(previousSessionEnd(loadJournal(deliberate)), 'clean');
  });

  it('a clean exit is not inherited: the next boot is in progress again', () => {
    const storage = memoryStorage();
    markCleanExit(storage, 5);
    assert.equal(previousSessionEnd(loadJournal(storage)), 'clean');
    // Boot clears the flag by recording into the same journal.
    recordEvent(storage, { at: 6, kind: 'boot' });
    assert.equal(previousSessionEnd(loadJournal(storage)), 'crashed');
  });

  it('keeps the newest entries and drops the oldest past the cap', () => {
    const storage = memoryStorage();
    for (let i = 0; i < MAX_JOURNAL_ENTRIES + 10; i += 1) {
      recordEvent(storage, { at: i, kind: `event-${i}` });
    }
    const journal = loadJournal(storage);
    assert.equal(journal.entries.length, MAX_JOURNAL_ENTRIES);
    assert.equal(journal.entries.at(-1)?.kind, `event-${MAX_JOURNAL_ENTRIES + 9}`);
    assert.equal(journal.entries[0]?.kind, 'event-10');
  });

  it('survives a corrupt or unreadable store', () => {
    const corrupt = memoryStorage('{not json');
    assert.deepEqual(loadJournal(corrupt).entries, []);
    const hostile = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    assert.doesNotThrow(() => recordEvent(hostile, { at: 1, kind: 'boot' }));
    assert.equal(previousSessionEnd(loadJournal(hostile)), 'first-run');
  });

  it('keeps entries that were written by a newer build without its extra fields', () => {
    const storage = memoryStorage(
      JSON.stringify({
        v: 99,
        entries: [
          { at: 1, kind: 'boot' },
          { at: 'x', kind: 3 },
        ],
      }),
    );
    const journal = loadJournal(storage);
    assert.deepEqual(
      journal.entries.map((e) => e.kind),
      ['boot'],
    );
  });
});
