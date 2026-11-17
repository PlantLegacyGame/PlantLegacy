import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  accumulateShedDamage,
  drainQueuedShedDamage,
  type ShedDamage,
  shedFlushIntervalTicks,
} from './shedDamage.ts';

const loss = (plantId: string, amount: number, totalBiomass = 10): ShedDamage => ({
  plantId,
  amount,
  totalBiomass,
});

describe('shedFlushIntervalTicks', () => {
  it('flushes twice a second at the configured tick rate', () => {
    assert.equal(shedFlushIntervalTicks(20), 10);
    assert.equal(shedFlushIntervalTicks(30), 15);
  });

  it('never flushes more than once per tick', () => {
    assert.equal(shedFlushIntervalTicks(1), 1);
  });

  it('falls back to 20 Hz for a nonsense rate', () => {
    assert.equal(shedFlushIntervalTicks(Number.NaN), 10);
    assert.equal(shedFlushIntervalTicks(0), 10);
  });
});

describe('accumulateShedDamage', () => {
  it('sums the ticks a plant lost tissue on', () => {
    const queued = new Map<string, ShedDamage>();
    accumulateShedDamage(queued, loss('plant_a', 0.02, 9.98));
    accumulateShedDamage(queued, loss('plant_a', 0.03, 9.95));
    assert.equal(queued.size, 1);
    assert.deepEqual(drainQueuedShedDamage(queued), [
      { plantId: 'plant_a', amount: 0.05, totalBiomass: 9.95 },
    ]);
  });

  it('keeps plants apart', () => {
    const queued = new Map<string, ShedDamage>();
    accumulateShedDamage(queued, loss('plant_a', 0.02));
    accumulateShedDamage(queued, loss('plant_b', 0.5, 4.5));
    assert.deepEqual(drainQueuedShedDamage(queued), [
      { plantId: 'plant_a', amount: 0.02, totalBiomass: 10 },
      { plantId: 'plant_b', amount: 0.5, totalBiomass: 4.5 },
    ]);
  });

  it('ignores a loss that is not a positive number', () => {
    const queued = new Map<string, ShedDamage>();
    accumulateShedDamage(queued, loss('plant_a', 0));
    accumulateShedDamage(queued, loss('plant_a', Number.NaN));
    assert.equal(queued.size, 0);
  });
});

describe('drainQueuedShedDamage', () => {
  it('is empty when nothing was lost', () => {
    assert.deepEqual(drainQueuedShedDamage(new Map()), []);
  });

  it('clears what it drained, so the next flush does not repeat it', () => {
    const queued = new Map<string, ShedDamage>();
    accumulateShedDamage(queued, loss('plant_a', 0.02));
    drainQueuedShedDamage(queued);
    assert.deepEqual(drainQueuedShedDamage(queued), []);
  });

  it('rounds the wire values to three decimals', () => {
    const queued = new Map<string, ShedDamage>();
    accumulateShedDamage(queued, loss('plant_a', 0.0004, 1.23456));
    assert.deepEqual(drainQueuedShedDamage(queued), [
      { plantId: 'plant_a', amount: 0, totalBiomass: 1.235 },
    ]);
  });
});
