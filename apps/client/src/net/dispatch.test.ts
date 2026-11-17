import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CLIENT_TO_SERVER_TYPES,
  MESSAGE_NAME,
  MESSAGE_TYPE,
  SERVER_TO_CLIENT_TYPES,
} from '@plant-legacy/shared/protocol';
import { createDispatchTable, missingServerMessageTypes } from './dispatch.ts';

const noop = (): void => {};

describe('dispatch table', () => {
  it('rejects a second handler for the same protocol type', () => {
    assert.throws(
      () =>
        createDispatchTable([
          [MESSAGE_TYPE.WELCOME, noop],
          [MESSAGE_TYPE.WELCOME, noop],
        ]),
      /Duplicate message handler for protocol type 10/,
    );
  });

  it('answers with the registered handler and nothing for an unregistered type', () => {
    const table = createDispatchTable([[MESSAGE_TYPE.PONG, noop]]);
    assert.equal(table.get(MESSAGE_TYPE.PONG), noop);
    assert.equal(table.get(MESSAGE_TYPE.CHAT_BROADCAST), undefined);
  });

  it('names every server type a table does not handle, in protocol order', () => {
    const table = createDispatchTable([[MESSAGE_TYPE.WELCOME, noop]]);
    assert.deepEqual(
      missingServerMessageTypes(table),
      SERVER_TO_CLIENT_TYPES.filter((type) => type !== MESSAGE_TYPE.WELCOME),
    );
  });

  it('is complete when every server type is registered', () => {
    const table = createDispatchTable(SERVER_TO_CLIENT_TYPES.map((type) => [type, noop] as const));
    assert.deepEqual(missingServerMessageTypes(table), []);
  });

  it('does not demand a handler for a client-to-server type', () => {
    const table = createDispatchTable(SERVER_TO_CLIENT_TYPES.map((type) => [type, noop] as const));
    // The client sends these; receiving them would be a server bug, not a gap.
    for (const type of CLIENT_TO_SERVER_TYPES) {
      assert.equal(table.has(type), false, `server handler for ${MESSAGE_NAME[type]}`);
    }
  });
});

describe('protocol direction split', () => {
  it('sorts every message type into exactly one direction', () => {
    const all = Object.values(MESSAGE_TYPE);
    const sorted = [...CLIENT_TO_SERVER_TYPES, ...SERVER_TO_CLIENT_TYPES];
    assert.equal(new Set(sorted).size, sorted.length, 'a type is listed in both directions');
    assert.deepEqual(
      [...sorted].sort((a, b) => a - b),
      [...all].sort((a, b) => a - b),
    );
  });
});
