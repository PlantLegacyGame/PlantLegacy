import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatMessageIssue, validateMessage } from './messageSchemas.ts';

function codes(type: number, payload: unknown): string[] {
  return validateMessage(type, payload).issues.map((i) => i.code);
}

describe('validateMessage', () => {
  it('accepts a well-formed HELLO', () => {
    assert.deepEqual(validateMessage(1, { clientVersion: 2 }).issues, []);
  });

  it('rejects HELLO missing required clientVersion', () => {
    assert.ok(codes(1, {}).includes('message.field_missing'));
  });

  it('rejects HELLO with wrong field type', () => {
    assert.ok(codes(1, { clientVersion: '2' }).includes('message.field_type'));
  });

  it('accepts HELLO with optional accessToken and plantId', () => {
    assert.deepEqual(
      validateMessage(1, {
        clientVersion: 2,
        accessToken: 'abc',
        plantId: 'p1',
      }).issues,
      [],
    );
  });

  it('rejects a non-object payload', () => {
    assert.ok(codes(1, 'not-an-object').includes('message.payload_type'));
    assert.ok(codes(1, null).includes('message.payload_type'));
    assert.ok(codes(1, 42).includes('message.payload_type'));
  });

  it('accepts an empty PING payload', () => {
    assert.deepEqual(validateMessage(3, {}).issues, []);
  });

  it('accepts a well-formed GROWTH_INTENT', () => {
    assert.deepEqual(
      validateMessage(4, {
        intent: {
          plantId: 'p1',
          nodeId: 'n1',
          direction: { x: 0, y: 1, z: 0 },
          nodeType: 'stem',
          isAttack: false,
          tick: 5,
        },
      }).issues,
      [],
    );
  });

  it('rejects GROWTH_INTENT with a bad direction', () => {
    assert.ok(
      codes(4, {
        intent: {
          plantId: 'p1',
          nodeId: 'n1',
          direction: { x: 0, y: 1 }, // missing z
          nodeType: 'stem',
          isAttack: false,
          tick: 5,
        },
      }).includes('message.field_missing'),
    );
  });

  it('rejects GROWTH_INTENT with non-integer... accepts numeric tick', () => {
    assert.deepEqual(
      validateMessage(4, {
        intent: {
          plantId: 'p1',
          nodeId: 'n1',
          direction: { x: 0, y: 0, z: 0 },
          nodeType: 'stem',
          isAttack: false,
          tick: 5,
        },
      }).issues,
      [],
    );
  });

  it('accepts an empty RESOURCE_QUERY', () => {
    assert.deepEqual(validateMessage(5, {}).issues, []);
  });

  it('accepts a germination GROWTH_EVENT with newNodes and no newNode', () => {
    const node = {
      id: 'n1',
      plantId: 'p1',
      type: 'radicle',
      layer: 'root',
      x: 0,
      y: -1,
      z: 0,
      biomass: 8,
      age: 0,
      parentId: 'seed1',
      children: [],
      statModifiers: {},
      resourceDrawWater: 0.8,
      resourceDrawNutrients: 0.5,
      upkeepBiomassPerSecond: 0.001,
      growthDirectionBias: 'downward',
      lastGrowthTick: 1,
      growthProgress: 0,
      isSeed: false,
    };
    assert.deepEqual(
      validateMessage(16, {
        plantId: 'p1',
        newNodes: [node],
        updatedParentNode: { ...node, id: 'seed1', type: 'root' },
        totalBiomass: 25,
        totalEnergy: 100,
      }).issues,
      [],
    );
  });

  it('rejects INPUT missing its nested required fields', () => {
    assert.ok(codes(2, { input: { moveForward: true } }).includes('message.field_missing'));
  });

  it('rejects INPUT with wrong input type', () => {
    assert.ok(codes(2, { input: 'not-an-object' }).includes('message.field_type'));
  });

  it('rejects an unknown message type with a non-object payload', () => {
    assert.ok(codes(99, 'bad').includes('message.payload_type'));
  });

  it('renders issues via formatMessageIssue', () => {
    const result = validateMessage(1, {});
    const rendered = result.issues.map(formatMessageIssue);
    assert.ok(rendered.length > 0);
    assert.ok(rendered.some((line) => line.includes('message.field_missing')));
  });
});
