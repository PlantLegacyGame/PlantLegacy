import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  PersistedPlayerState,
  PlayerStateStore,
} from './persistence/playerStatePersistence.ts';
import { awardSporesStored, mutatePlayerState } from './playerStateMutations.ts';

const empty: PersistedPlayerState = { slots: [null, null, null, null], spores: 0 };
const base = { accountId: null, unavailable: false, initial: empty };

describe('mutatePlayerState', () => {
  it('adopts the plan when there is no row to clamp it', async () => {
    const adopted: PersistedPlayerState[] = [];
    const result = await mutatePlayerState<{ ok: true }>(
      { ...base, store: null },
      (current) => ({ next: { ...current, spores: 5 }, result: { ok: true } }),
      (state) => adopted.push(state),
    );
    assert.deepEqual(result, { ok: true });
    assert.equal(adopted.length, 1);
    assert.equal(adopted[0]?.spores, 5);
  });

  it('adopts what the store committed, not the plan', async () => {
    const committed: PersistedPlayerState = {
      slots: [{ itemId: 'dung', count: 5 }, null, null, null],
      spores: 1000,
    };
    const adopted: PersistedPlayerState[] = [];
    const store = {
      mutate: async (
        _ownerId: string,
        _initial: PersistedPlayerState,
        apply: (
          current: PersistedPlayerState,
        ) => { next?: PersistedPlayerState; result: string } | null,
        onCommitted?: (state: PersistedPlayerState) => void,
      ) => {
        const change = apply(empty);
        // A store that clamps on the way in: the plan is wider than the row.
        onCommitted?.(committed);
        return change?.result ?? null;
      },
    } as unknown as PlayerStateStore;

    await mutatePlayerState(
      { ...base, store, accountId: 'acct_one' },
      () => ({ next: { slots: [{ itemId: 'dung', count: 99 }], spores: 5000 }, result: 'planned' }),
      (state) => adopted.push(state),
    );

    assert.deepEqual(adopted, [committed]);
  });

  it('does not adopt a refused change', async () => {
    const adopted: PersistedPlayerState[] = [];
    const result = await mutatePlayerState(
      { ...base, store: null },
      () => ({ result: 'refused' as const }),
      (state) => adopted.push(state),
    );
    assert.equal(result, 'refused');
    assert.equal(adopted.length, 0);
  });
});

describe('awardSporesStored', () => {
  it('pays only what the purse can hold and reports that amount', async () => {
    let balance: number | null = null;
    let earned = -1;
    const result = await awardSporesStored(
      {
        ...base,
        store: null,
        initial: { ...empty, spores: 990 },
        amount: 50,
        maxBalance: 1000,
      },
      (state, paid) => {
        balance = state.spores;
        earned = paid;
      },
    );
    assert.equal(result, 1000);
    assert.equal(balance, 1000);
    assert.equal(earned, 10);
  });

  it('pays nothing into a full purse', async () => {
    const result = await awardSporesStored(
      { ...base, store: null, initial: { ...empty, spores: 1000 }, amount: 10, maxBalance: 1000 },
      () => {
        assert.fail('a full purse must not commit a change');
      },
    );
    assert.equal(result, null);
  });
});
