import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type LoggedNotification,
  NOTIFICATION_LOG_LIMIT,
  pushNotification,
} from './NotificationLog.ts';

const entry = (message: string, at = 0) => ({ at, message, kind: 'info' as const });

describe('pushNotification', () => {
  it('puts the newest entry first', () => {
    const first = pushNotification([], entry('damage', 1));
    const second = pushNotification(first, entry('rooted', 2));
    assert.deepEqual(
      second.map((item) => item.message),
      ['rooted', 'damage'],
    );
  });

  it('drops the oldest entry once the cap is reached', () => {
    let entries: LoggedNotification[] = [entry('b'), entry('a')];
    entries = pushNotification(entries, entry('c'), 2);
    assert.deepEqual(
      entries.map((item) => item.message),
      ['c', 'b'],
    );
  });

  it('leaves the list it was given alone', () => {
    const before = [entry('a')];
    const after = pushNotification(before, entry('b'));
    assert.equal(before.length, 1);
    assert.notEqual(after, before);
  });

  it('keeps the default cap bounded and positive', () => {
    assert.ok(NOTIFICATION_LOG_LIMIT > 0);
    assert.ok(NOTIFICATION_LOG_LIMIT <= 200);
  });
});
