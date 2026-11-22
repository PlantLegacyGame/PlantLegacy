import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGpuTimer } from './GpuTimer.ts';

/**
 * A WebGL2 context that answers the way Chromium does on this machine:
 * `QUERY_RESULT_AVAILABLE` is a boolean, `QUERY_RESULT` is nanoseconds, and a
 * query is only ready after a few polls.
 */
function fakeContext(
  options: { availableAfterReads?: number; disjoint?: boolean; withExtension?: boolean } = {},
) {
  const availableAfterReads = options.availableAfterReads ?? 2;
  const state = {
    begun: 0,
    ended: 0,
    availabilityReads: 0,
    results: 0,
    deleted: 0,
    disjoint: options.disjoint ?? false,
  };
  const records = new Map<object, { reads: number }>();

  const gl = {
    QUERY_RESULT_AVAILABLE: 34919,
    QUERY_RESULT: 34918,
    getExtension: (name: string) =>
      options.withExtension === false || name !== 'EXT_disjoint_timer_query_webgl2'
        ? null
        : { TIME_ELAPSED_EXT: 35007, GPU_DISJOINT_EXT: 36795 },
    createQuery: () => {
      const query = {};
      records.set(query, { reads: 0 });
      return query;
    },
    deleteQuery: (query: object) => {
      records.delete(query);
      state.deleted += 1;
    },
    beginQuery: () => {
      state.begun += 1;
    },
    endQuery: () => {
      state.ended += 1;
    },
    getParameter: () => state.disjoint,
    getQueryParameter: (query: object, pname: number) => {
      const record = records.get(query);
      assert.ok(record, 'the timer read a query it had already deleted');
      if (pname === gl.QUERY_RESULT_AVAILABLE) {
        state.availabilityReads += 1;
        record.reads += 1;
        // A boolean, exactly as WebGL2 returns it. Treating `false` as a number
        // (`false !== 0`) made every query look finished on its first poll.
        return record.reads > availableAfterReads;
      }
      assert.equal(pname, gl.QUERY_RESULT);
      state.results += 1;
      return 4_000_000;
    },
  } as unknown as WebGL2RenderingContext;

  return { gl, state };
}

describe('GPU frame timer', () => {
  it('keeps a query until the driver says it is ready, then reads its duration', () => {
    const { gl, state } = fakeContext({ availableAfterReads: 2 });
    const timer = createGpuTimer(gl);
    assert.equal(timer.available, true);

    timer.begin();
    timer.end();
    assert.equal(timer.readMs(), null, 'not ready on the first polls');
    assert.equal(state.results, 0, 'a query that is not ready must not be read');
    assert.equal(state.deleted, 0, 'and must not be deleted');

    timer.begin();
    assert.equal(state.begun, 1, 'no second query while one is still in flight');
    timer.end();
    assert.equal(timer.readMs(), 4, 'the GPU duration, in milliseconds');
    assert.equal(timer.measured, true);
  });

  it('discards a disjoint query instead of reporting a wrong number', () => {
    const { gl, state } = fakeContext({ availableAfterReads: 5, disjoint: true });
    const timer = createGpuTimer(gl);
    timer.begin();
    timer.end();
    assert.equal(timer.readMs(), null);
    assert.equal(state.deleted, 1, 'a disjoint query is dropped');
    timer.begin();
    assert.equal(state.begun, 2, 'and the next frame starts a clean query');
  });

  it('degrades to the null timer without the extension', () => {
    const { gl } = fakeContext({ withExtension: false });
    const timer = createGpuTimer(gl);
    assert.equal(timer.available, false);
    timer.begin();
    timer.end();
    assert.equal(timer.readMs(), null);
  });
});
