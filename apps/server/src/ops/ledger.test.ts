import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WebSocket } from 'ws';
import { awardLabel, sendLedgerEntry, tidyLedgerEntry } from './ledger.ts';
import { MESSAGE_TYPE } from './net.ts';

function recorder() {
  const sent: Array<{ type: number; payload: unknown }> = [];
  return {
    sent,
    ports: {
      send: (_ws: WebSocket, type: number, payload: unknown) => {
        sent.push({ type, payload });
      },
    },
  };
}

const ws = {} as WebSocket;

describe('the spore ledger', () => {
  it('sends one LEDGER_ENTRY with the reason and the committed balance', () => {
    const { sent, ports } = recorder();
    sendLedgerEntry(
      ports,
      { ws },
      {
        kind: 'purchase',
        label: 'Starter Dung',
        itemId: 'dung_starter',
        count: 1,
        amount: -8,
        balance: 112,
      },
    );

    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.type, MESSAGE_TYPE.LEDGER_ENTRY);
    assert.deepEqual(sent[0]?.payload, {
      kind: 'purchase',
      label: 'Starter Dung',
      itemId: 'dung_starter',
      count: 1,
      amount: -8,
      balance: 112,
    });
  });

  it('rounds a float purse down to a number a HUD can print', () => {
    const entry = tidyLedgerEntry({
      kind: 'use',
      label: 'Dung',
      itemId: 'dung_starter',
      count: 1,
      amount: 2.9999999,
      balance: 112.0000000000001,
    });
    assert.equal(entry.amount, 3);
    assert.equal(entry.balance, 112);
  });

  it('refuses to send NaN or a negative item count', () => {
    const entry = tidyLedgerEntry({
      kind: 'award',
      label: 'Kill credit',
      itemId: null,
      count: -4,
      amount: Number.NaN,
      balance: Number.NaN,
    });
    assert.equal(entry.count, 0);
    assert.equal(entry.amount, 0);
    assert.equal(entry.balance, 0);
  });

  it('turns an award reason into a sentence, never the wire token', () => {
    assert.equal(awardLabel('kill_credit'), 'Kill credit');
    assert.equal(awardLabel('drop_remains'), 'Remains');
    assert.equal(awardLabel('something_new'), 'Award');
    for (const reason of ['kill_credit', 'drop_dung', 'drop_fragment']) {
      assert.ok(!awardLabel(reason).includes('_'), reason);
    }
  });
});
