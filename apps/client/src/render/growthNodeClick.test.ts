import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planNodeClick } from './growthNodeClick.ts';

describe('a click on a plant part', () => {
  it('asks for options even with grow mode off', () => {
    assert.deepEqual(planNodeClick({ isOwnPlant: true, growMode: false }), {
      requestOptions: true,
      enterGrowMode: true,
      inspectRival: false,
    });
  });

  it('keeps the mode it is already in', () => {
    assert.deepEqual(planNodeClick({ isOwnPlant: true, growMode: true }), {
      requestOptions: true,
      enterGrowMode: false,
      inspectRival: false,
    });
  });

  it('never grows a rival, whatever the mode', () => {
    for (const growMode of [true, false]) {
      assert.deepEqual(planNodeClick({ isOwnPlant: false, growMode }), {
        requestOptions: false,
        enterGrowMode: false,
        inspectRival: true,
      });
    }
  });
});
