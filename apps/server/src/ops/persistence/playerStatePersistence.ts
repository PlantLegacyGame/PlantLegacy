import type { ItemDefinition } from '@plant-legacy/shared/schemas';
import type { Pool } from 'pg';
import { createInventory, type Inventory, setSlot } from '../inventory.ts';

/** One serialised pouch slot. `null` means the slot is empty. */
export interface PersistedSlot {
  itemId: string;
  count: number;
}

/** The pouch and purse as they cross the Postgres boundary. */
export interface PersistedPlayerState {
  slots: (PersistedSlot | null)[];
  spores: number;
}

export interface PlayerStateStoreOptions {
  itemDefinitions: Map<string, ItemDefinition>;
  maxSlots: number;
  maxSpores: number;
  /** Called for a row that was readable but had to be repaired. */
  onRepair?: (message: string, meta?: Record<string, unknown>) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Turn a stored JSON value into a safe pouch.
 *
 * The database is the second copy of a number the server already validated, so
 * this is deliberately conservative: an unknown item is dropped, a bad count is
 * dropped, and a stack above the item's own limit is clamped. A malformed row
 * must not make the server refuse to boot, but it also must not become a free
 * item. `null` is a valid empty slot.
 */
export function sanitizeSlots(
  value: unknown,
  options: Pick<PlayerStateStoreOptions, 'itemDefinitions' | 'maxSlots' | 'onRepair'>,
): (PersistedSlot | null)[] {
  if (!Array.isArray(value)) {
    options.onRepair?.('player state slots is not an array; starting with an empty pouch');
    return new Array(options.maxSlots).fill(null);
  }

  const slots: (PersistedSlot | null)[] = new Array(options.maxSlots).fill(null);
  for (let index = 0; index < Math.min(value.length, options.maxSlots); index++) {
    const raw = value[index];
    if (raw === null || raw === undefined) continue;
    if (!isRecord(raw)) {
      options.onRepair?.('dropped a non-object inventory slot', { index });
      continue;
    }
    const itemId = raw.itemId;
    const count = raw.count;
    if (typeof itemId !== 'string' || itemId.length === 0) {
      options.onRepair?.('dropped an inventory slot with no item id', { index });
      continue;
    }
    const definition = options.itemDefinitions.get(itemId);
    if (!definition) {
      options.onRepair?.('dropped an inventory item that no longer exists', { index, itemId });
      continue;
    }
    if (!Number.isFinite(count) || !Number.isInteger(count) || (count as number) <= 0) {
      options.onRepair?.('dropped an inventory slot with an invalid count', { index, itemId });
      continue;
    }
    const stackLimit = definition.stack_limit;
    if (!Number.isInteger(stackLimit) || stackLimit < 1) {
      options.onRepair?.('dropped an item with an unusable stack limit', { index, itemId });
      continue;
    }
    slots[index] = { itemId, count: Math.min(count as number, stackLimit) };
  }
  if (value.length > options.maxSlots) {
    options.onRepair?.('truncated an oversized inventory', {
      stored: value.length,
      maxSlots: options.maxSlots,
    });
  }
  return slots;
}

/** The write shape. Never stores an Inventory object, only its data. */
export function toPersistedState(inventory: Inventory, spores: number): PersistedPlayerState {
  return {
    slots: inventory.slots.map((slot) =>
      slot ? { itemId: slot.itemId, count: slot.count } : null,
    ),
    spores,
  };
}

/** Load a persisted pouch into a fresh inventory, dropping anything unusable. */
export function toInventory(
  state: PersistedPlayerState,
  options: Pick<PlayerStateStoreOptions, 'itemDefinitions' | 'maxSlots' | 'onRepair'>,
): Inventory {
  const inventory = createInventory(options.maxSlots);
  const slots = sanitizeSlots(state.slots, options);
  for (let index = 0; index < slots.length; index++) {
    const slot = slots[index];
    if (slot) setSlot(inventory, index, slot, options.itemDefinitions);
  }
  return inventory;
}

function clampSpores(
  value: unknown,
  maxSpores: number,
  onRepair?: PlayerStateStoreOptions['onRepair'],
): number {
  // `pg` returns BIGINT as a string; a numeric string is still a number here.
  const numeric = typeof value === 'string' && value.trim().length > 0 ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) {
    onRepair?.('player state spores is not a number; starting at zero');
    return 0;
  }
  const rounded = Math.round(numeric);
  const clamped = Math.max(0, Math.min(maxSpores, rounded));
  if (clamped !== rounded) {
    onRepair?.('clamped player state spores', { stored: value, clamped });
  }
  return clamped;
}

/**
 * The only reader and writer of `player_state`.
 *
 * `save` is a transaction: it locks the account row with `SELECT ... FOR UPDATE`
 * and then upserts. `mutate` is the read-modify-write variant: it seeds and
 * locks the row, reads the current pouch and purse inside the lock, lets the
 * caller apply one change, and writes the result before commit. A refusal
 * rolls back without touching the row.
 */
export class PlayerStateStore {
  readonly #pool: Pool;
  readonly #options: PlayerStateStoreOptions;
  /** One in-flight write per owner, so commits follow call order. */
  readonly #writeQueues = new Map<string, Promise<unknown>>();

  constructor(pool: Pool, options: PlayerStateStoreOptions) {
    this.#pool = pool;
    this.#options = options;
  }

  async load(ownerId: string): Promise<PersistedPlayerState | null> {
    const result = await this.#pool.query<{
      slots: unknown;
      spores: unknown;
    }>('SELECT slots, spores FROM player_state WHERE owner_id = $1', [ownerId]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      slots: sanitizeSlots(row.slots, this.#options),
      spores: clampSpores(row.spores, this.#options.maxSpores, this.#options.onRepair),
    };
  }

  /**
   * Apply one change to the stored state under a row lock.
   *
   * `initial` seeds a missing row. The callback receives the state read inside
   * the lock, not the caller's stale copy, so two purchases in flight cannot
   * both spend the same spores. Return `null`, or a result with no `next`, to
   * refuse the change; the transaction rolls back and the row is untouched.
   */
  mutate<T>(
    ownerId: string,
    initial: PersistedPlayerState,
    apply: (current: PersistedPlayerState) => { next?: PersistedPlayerState; result: T } | null,
  ): Promise<T | null> {
    return this.#serialize(ownerId, () => this.#mutateNow(ownerId, initial, apply));
  }

  async #mutateNow<T>(
    ownerId: string,
    initial: PersistedPlayerState,
    apply: (current: PersistedPlayerState) => { next?: PersistedPlayerState; result: T } | null,
  ): Promise<T | null> {
    const seedSlots = sanitizeSlots(initial.slots, this.#options);
    const seedSpores = clampSpores(initial.spores, this.#options.maxSpores, this.#options.onRepair);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      // Create the row if it is missing, so the following SELECT always has a
      // row to lock. Two first writes serialise on the unique key instead of
      // both reading "no row" and racing.
      await client.query(
        `INSERT INTO player_state (owner_id, slots, spores, updated_at)
         VALUES ($1, $2::jsonb, $3, NOW())
         ON CONFLICT (owner_id) DO NOTHING`,
        [ownerId, JSON.stringify(seedSlots), seedSpores],
      );
      const result = await client.query<{ slots: unknown; spores: unknown }>(
        'SELECT slots, spores FROM player_state WHERE owner_id = $1 FOR UPDATE',
        [ownerId],
      );
      const row = result.rows[0];
      const current: PersistedPlayerState = row
        ? {
            slots: sanitizeSlots(row.slots, this.#options),
            spores: clampSpores(row.spores, this.#options.maxSpores, this.#options.onRepair),
          }
        : { slots: seedSlots, spores: seedSpores };

      const change = apply(current);
      if (!change) {
        await client.query('ROLLBACK');
        return null;
      }
      if (!change.next) {
        await client.query('ROLLBACK');
        return change.result;
      }

      const slots = sanitizeSlots(change.next.slots, this.#options);
      const spores = clampSpores(
        change.next.spores,
        this.#options.maxSpores,
        this.#options.onRepair,
      );
      await client.query(
        `INSERT INTO player_state (owner_id, slots, spores, updated_at)
         VALUES ($1, $2::jsonb, $3, NOW())
         ON CONFLICT (owner_id) DO UPDATE
           SET slots = EXCLUDED.slots,
               spores = EXCLUDED.spores,
               updated_at = NOW()`,
        [ownerId, JSON.stringify(slots), spores],
      );
      await client.query('COMMIT');
      return change.result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {
        // The connection may already be gone; the original error is the one
        // the caller needs to see.
      });
      throw error;
    } finally {
      client.release();
    }
  }

  save(ownerId: string, state: PersistedPlayerState): Promise<void> {
    return this.#serialize(ownerId, () => this.#saveNow(ownerId, state));
  }

  async #saveNow(ownerId: string, state: PersistedPlayerState): Promise<void> {
    const slots = sanitizeSlots(state.slots, this.#options);
    const spores = clampSpores(state.spores, this.#options.maxSpores, this.#options.onRepair);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      // Lock the account row before writing. A missing row is created by the
      // upsert; same-owner writes are serialised by #serialize, so a stale
      // writer cannot overtake a newer one inside this process.
      await client.query('SELECT owner_id FROM player_state WHERE owner_id = $1 FOR UPDATE', [
        ownerId,
      ]);
      await client.query(
        `INSERT INTO player_state (owner_id, slots, spores, updated_at)
         VALUES ($1, $2::jsonb, $3, NOW())
         ON CONFLICT (owner_id) DO UPDATE
           SET slots = EXCLUDED.slots,
               spores = EXCLUDED.spores,
               updated_at = NOW()`,
        [ownerId, JSON.stringify(slots), spores],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {
        // The connection may already be gone; the original error is the one
        // the caller needs to see.
      });
      throw error;
    } finally {
      client.release();
    }
  }

  #serialize<T>(ownerId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#writeQueues.get(ownerId) ?? Promise.resolve();
    const run = previous.then(work);
    const settled = run.catch(() => {});
    this.#writeQueues.set(ownerId, settled);
    void settled.finally(() => {
      if (this.#writeQueues.get(ownerId) === settled) this.#writeQueues.delete(ownerId);
    });
    return run;
  }
}
