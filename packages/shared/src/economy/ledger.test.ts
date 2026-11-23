import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  appendLedger,
  LEDGER_LIMIT,
  type LedgerEntry,
  ledgerAmountText,
  ledgerEntryText,
} from './ledger.ts';

const purchase: LedgerEntry = {
  kind: 'purchase',
  label: 'Starter Dung',
  itemId: 'dung_starter',
  count: 1,
  amount: -8,
  balance: 112,
};

describe('the spore ledger', () => {
  it('keeps the newest entries and drops the oldest at the limit', () => {
    let entries: LedgerEntry[] = [];
    for (let i = 0; i < LEDGER_LIMIT + 3; i += 1) {
      entries = appendLedger(entries, { ...purchase, balance: i });
    }
    assert.equal(entries.length, LEDGER_LIMIT);
    assert.equal(entries[entries.length - 1]?.balance, LEDGER_LIMIT + 2);
    assert.equal(entries[0]?.balance, 3);
  });

  it('does not mutate the list it was given', () => {
    const before: LedgerEntry[] = [];
    const after = appendLedger(before, purchase);
    assert.equal(before.length, 0);
    assert.equal(after.length, 1);
  });

  it('prints a spend with a minus and an award with a plus', () => {
    assert.equal(ledgerAmountText(-8), '\u22128 spores');
    assert.equal(ledgerAmountText(3), '+3 spores');
    assert.equal(ledgerAmountText(0), '');
    assert.equal(ledgerAmountText(0.2), '');
  });

  it('names each kind and always carries the committed balance', () => {
    assert.equal(
      ledgerEntryText(purchase),
      'Bought Starter Dung \u00B7 \u22128 spores \u00B7 112 left',
    );
    assert.equal(
      ledgerEntryText({ ...purchase, kind: 'use', amount: 3, balance: 115 }),
      'Used Starter Dung \u00B7 +3 spores \u00B7 115 left',
    );
    assert.equal(
      ledgerEntryText({
        kind: 'drop',
        label: 'Dung',
        itemId: null,
        count: 0,
        amount: 2,
        balance: 117,
      }),
      'Picked up Dung \u00B7 +2 spores \u00B7 117 left',
    );
    assert.equal(
      ledgerEntryText({
        kind: 'award',
        label: 'Kill credit',
        itemId: null,
        count: 0,
        amount: 1,
        balance: 118,
      }),
      'Kill credit \u00B7 +1 spores \u00B7 118 left',
    );
  });

  it('shows a stack count only when more than one moved', () => {
    assert.equal(
      ledgerEntryText({ ...purchase, kind: 'use', count: 3, amount: 0 }),
      'Used Starter Dung \u00D73 \u00B7 112 left',
    );
    // A grant of three items says three, so the pouch can be reconciled.
    assert.equal(
      ledgerEntryText({
        kind: 'award',
        label: 'Dev grant: Starter Fertilizer',
        itemId: 'fertilizer_starter',
        count: 3,
        amount: 0,
        balance: 120,
      }),
      'Dev grant: Starter Fertilizer \u00D73 \u00B7 120 left',
    );
  });

  it('never prints an item id in the line the player reads', () => {
    const line = ledgerEntryText(purchase);
    assert.ok(!line.includes(purchase.itemId as string), line);
    assert.ok(!line.includes('_'), line);
  });

  it('treats a non-finite balance as zero rather than printing NaN', () => {
    assert.equal(
      ledgerEntryText({ ...purchase, amount: 0, balance: Number.NaN }),
      'Bought Starter Dung \u00B7 0 left',
    );
  });
});
