import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  handlePlantCommand,
  type PlantCommandContext,
  type PlantCommandPorts,
  type RootGrowth,
} from './plantCommands.ts';

const both: PlantCommandContext = { hasPlant: true, hasPlayer: true };

function createPorts(overrides: Partial<PlantCommandPorts> = {}) {
  const calls: string[] = [];
  const responses: Array<{ action: string; payload: Record<string, unknown> }> = [];
  const broadcasts: RootGrowth[] = [];
  const ports: PlantCommandPorts = {
    setGrowthCooldown: (seconds) => calls.push(`cooldown:${seconds}`),
    setGerminationMins: (patch) => calls.push(`germination:${JSON.stringify(patch)}`),
    crownPosition: () => ({ x: 2, z: 5 }),
    mutationGallery: (center) => {
      calls.push(`gallery:${center.x},${center.z}`);
      return { plants: 8 };
    },
    grantMutation: (mutationId) => {
      calls.push(`grant:${mutationId}`);
      return { ok: true };
    },
    clearMutations: () => {
      calls.push('clear');
      return 3;
    },
    syncMutationState: () => calls.push('syncMutations'),
    fillEnergy: () => calls.push('energy'),
    fillTissue: () => {
      calls.push('tissue');
      return 42;
    },
    fillStoredResources: () => {
      calls.push('stored');
      return { water: 10, minerals: 5 };
    },
    grantItem: (itemId, count) => {
      calls.push(`item:${itemId}:${count}`);
      return 1;
    },
    endSeason: () => {
      calls.push('season');
      return { season: 'summer' };
    },
    prepareRootGrowth: () => {
      calls.push('prepare');
      return true;
    },
    rootParent: () => ({ id: 'root-1', hasRoots: true }),
    growRoot: (parentId, angle, nodeType) => {
      calls.push(`grow:${parentId}:${nodeType}:${Math.round(angle * 1000) / 1000}`);
      return {
        ok: true,
        growth: { payload: { newNode: { id: `n${angle}` } }, x: 1, z: 2, newNodeId: `n${angle}` },
      };
    },
    broadcastGrowth: (growth) => broadcasts.push(growth),
    regenerate: () => {
      calls.push('regenerate');
      return 'plant-2';
    },
    sendWelcome: () => calls.push('welcome'),
    settleDeaths: () => calls.push('deaths'),
    respond: (action, payload) => responses.push({ action, payload }),
    ...overrides,
  };
  return { ports, calls, responses, broadcasts };
}

describe('handlePlantCommand', () => {
  it('claims only plant writes', () => {
    const { ports, calls } = createPorts();
    assert.equal(handlePlantCommand(ports, { type: 'dev_damage_plant' }, both), false);
    assert.equal(handlePlantCommand(ports, { type: 'dev_fill_energy' }, both), true);
    assert.deepEqual(calls, ['energy']);
  });

  it('answers no_plant for the commands that need one', () => {
    const { ports, responses } = createPorts();
    const plantOnly = [
      'dev_set_growth',
      'dev_mutation_gallery',
      'dev_fill_energy',
      'dev_fill_biomass',
      'dev_fill_resources',
      'dev_regenerate_plant',
    ];
    for (const type of plantOnly) {
      handlePlantCommand(ports, { type }, { hasPlant: false, hasPlayer: true });
    }
    assert.equal(responses.length, plantOnly.length);
    for (const r of responses) assert.deepEqual(r.payload, { ok: false, error: 'no_plant' });
  });

  it('needs a player row for mutations, roots and items', () => {
    const { ports, responses } = createPorts();
    for (const type of [
      'dev_grant_mutation',
      'dev_clear_mutations',
      'dev_grow_roots',
      'dev_grant_item',
    ]) {
      handlePlantCommand(ports, { type }, { hasPlant: true, hasPlayer: false });
    }
    assert.equal(
      responses.every((r) => r.payload.error === 'no_plant'),
      true,
    );
  });

  it('sets the growth cooldown and the germination minimums', () => {
    const { ports, calls } = createPorts();
    handlePlantCommand(
      ports,
      { type: 'dev_set_growth', growth_cooldown: 5, germination_min_moisture: 0.2 },
      both,
    );
    assert.deepEqual(calls, ['cooldown:5', 'germination:{"moisture":0.2}']);
  });

  it('ignores a cooldown that is not a number, which used to block growth for good', () => {
    const { ports, calls } = createPorts();
    handlePlantCommand(ports, { type: 'dev_set_growth', growth_cooldown: 'soon' }, both);
    assert.deepEqual(calls, ['germination:{}']);
  });

  it('puts the mutation gallery behind the plant', () => {
    const { ports, responses } = createPorts();
    handlePlantCommand(ports, { type: 'dev_mutation_gallery' }, both);
    assert.deepEqual(responses[0]?.payload, { ok: true, plants: 8 });
  });

  it('falls back to the origin when the plant has no crown', () => {
    const { ports, calls } = createPorts({ crownPosition: () => null });
    handlePlantCommand(ports, { type: 'dev_mutation_gallery' }, both);
    assert.deepEqual(calls, ['gallery:0,-16']);
  });

  it('syncs mutations after a grant and after a clear', () => {
    const { ports, calls } = createPorts();
    handlePlantCommand(ports, { type: 'dev_grant_mutation', mutationId: 'glow' }, both);
    handlePlantCommand(ports, { type: 'dev_clear_mutations' }, both);
    assert.deepEqual(calls, ['grant:glow', 'syncMutations', 'clear', 'syncMutations']);
  });

  it('does not push a mutation state that was refused', () => {
    const { ports, calls, responses } = createPorts({
      grantMutation: () => ({ ok: false, reason: 'unknown_mutation' }),
    });
    handlePlantCommand(ports, { type: 'dev_grant_mutation', mutationId: 'nope' }, both);
    assert.deepEqual(calls, []);
    assert.deepEqual(responses[0]?.payload, {
      ok: false,
      reason: 'unknown_mutation',
      mutationId: 'nope',
    });
  });

  it('fills energy, biomass and stored resources through one port each', () => {
    const { ports, responses } = createPorts();
    handlePlantCommand(ports, { type: 'dev_fill_energy' }, both);
    handlePlantCommand(ports, { type: 'dev_fill_biomass' }, both);
    handlePlantCommand(ports, { type: 'dev_fill_resources' }, both);
    assert.deepEqual(
      responses.map((r) => r.payload),
      [{ ok: true }, { ok: true, totalBiomass: 42 }, { ok: true, water: 10, minerals: 5 }],
    );
  });

  it('grows a chain of roots, broadcasting each step', () => {
    const { ports, calls, responses, broadcasts } = createPorts();
    handlePlantCommand(ports, { type: 'dev_grow_roots', count: 3 }, both);
    assert.equal(calls.filter((c) => c === 'prepare').length, 3);
    assert.equal(calls.filter((c) => c.startsWith('grow:')).length, 3);
    assert.equal(broadcasts.length, 3);
    assert.equal((responses[0]?.payload.grown as string[] | undefined)?.length, 3);
    assert.deepEqual(responses[0]?.payload.rejected, []);
  });

  it('clamps the root count and stops at the first refusal', () => {
    const { ports, calls, responses } = createPorts({
      rootParent: () => null,
    });
    handlePlantCommand(ports, { type: 'dev_grow_roots', count: 999 }, both);
    assert.equal(calls.filter((c) => c === 'prepare').length, 1);
    assert.deepEqual(responses[0]?.payload.rejected, ['no_parent']);
  });

  it('stops with plant_gone when the plant disappears mid-chain', () => {
    const { ports, responses } = createPorts({ prepareRootGrowth: () => false });
    handlePlantCommand(ports, { type: 'dev_grow_roots' }, both);
    assert.deepEqual(responses[0]?.payload.rejected, ['plant_gone']);
  });

  it('grants items with a whole count and answers in the same command', () => {
    const { ports, calls, responses } = createPorts();
    handlePlantCommand(ports, { type: 'dev_grant_item', itemId: 'seed', count: 2.7 }, both);
    assert.deepEqual(calls, ['item:seed:2']);
    assert.deepEqual(responses[0]?.payload, { ok: true, itemId: 'seed', added: 1 });
  });

  it('reports a refused item grant as not added', () => {
    const { ports, responses } = createPorts({ grantItem: () => 0 });
    handlePlantCommand(ports, { type: 'dev_grant_item', itemId: 'ghost' }, both);
    assert.equal(responses[0]?.payload.ok, false);
  });

  it('ends the season whether or not there is a plant', () => {
    const { ports, responses } = createPorts();
    handlePlantCommand(ports, { type: 'dev_end_season' }, { hasPlant: false, hasPlayer: false });
    assert.deepEqual(responses[0]?.payload, { ok: true, season: 'summer' });
  });

  it('regenerates in the order the client needs: welcome, deaths, answer', () => {
    const { ports, calls, responses } = createPorts();
    handlePlantCommand(ports, { type: 'dev_regenerate_plant' }, both);
    assert.deepEqual(calls, ['regenerate', 'welcome', 'deaths']);
    assert.deepEqual(responses[0]?.payload, { ok: true, newPlantId: 'plant-2' });
  });

  it('answers no_plant when regeneration produced nothing', () => {
    const { ports, responses } = createPorts({ regenerate: () => null });
    handlePlantCommand(ports, { type: 'dev_regenerate_plant' }, both);
    assert.deepEqual(responses[0]?.payload, { ok: false, error: 'no_plant' });
  });
});
