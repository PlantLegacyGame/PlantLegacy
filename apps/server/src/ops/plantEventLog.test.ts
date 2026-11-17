import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PlantEventLog } from './plantEventLog.ts';

const growth = (tick: number) => ({
  type: 'growth' as const,
  tick,
  data: { nodeId: `node_${tick}` },
});

describe('PlantEventLog', () => {
  it('appends and returns events oldest first', () => {
    const log = new PlantEventLog(10);
    log.append('p1', growth(1));
    log.append('p1', growth(2));
    assert.deepEqual(
      log.get('p1').map((event) => event.tick),
      [1, 2],
    );
  });

  it('keeps plants separate', () => {
    const log = new PlantEventLog(10);
    log.append('p1', growth(1));
    log.append('p2', growth(2));
    assert.equal(log.size('p1'), 1);
    assert.equal(log.size('p2'), 1);
    assert.equal(log.get('missing').length, 0);
  });

  it('drops the oldest entries once the compaction threshold is exceeded', () => {
    const log = new PlantEventLog(3);
    for (let tick = 1; tick <= 5; tick += 1) log.append('p1', growth(tick));
    assert.deepEqual(
      log.get('p1').map((event) => event.tick),
      [3, 4, 5],
    );
  });

  it('bounds seeded history from a saved log', () => {
    const log = new PlantEventLog(2);
    log.seed('p1', [growth(1), growth(2), growth(3)]);
    assert.deepEqual(
      log.get('p1').map((event) => event.tick),
      [2, 3],
    );
  });

  it('returns a copy, so callers cannot mutate the stored log', () => {
    const log = new PlantEventLog(10);
    log.append('p1', growth(1));
    log.get('p1').push(growth(99));
    assert.equal(log.size('p1'), 1);
  });

  it('deletes history with the plant', () => {
    const log = new PlantEventLog(10);
    log.append('p1', growth(1));
    log.delete('p1');
    assert.equal(log.size('p1'), 0);
    assert.equal(log.plantCount, 0);
  });

  it('treats a zero threshold as one entry rather than unbounded', () => {
    const log = new PlantEventLog(0);
    log.append('p1', growth(1));
    log.append('p1', growth(2));
    assert.deepEqual(
      log.get('p1').map((event) => event.tick),
      [2],
    );
  });
});
