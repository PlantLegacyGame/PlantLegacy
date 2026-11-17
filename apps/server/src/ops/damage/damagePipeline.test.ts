import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfigDir } from '@plant-legacy/shared/config';
import type { UprootConfig } from '@plant-legacy/shared/damage';
import type { PlantNode } from '@plant-legacy/shared/growth';
import type { WeatherStateName } from '@plant-legacy/weather';
import { loadGrowthConfig } from '../growth.ts';
import { deserializePlant, serializePlant } from '../persistence/plantPersistence.ts';
import { PlantWorld } from '../plantWorld.ts';
import type { ResourceWorld } from '../resourceWorld.ts';
import { loadResourcesConfig } from '../resourceWorld.ts';
import { loadDamageConfig, loadTumblingConfig, loadUprootConfig } from './config.ts';
import { DamagePipeline, type DamagePipelineOptions } from './damagePipeline.ts';

const configDir = fileURLToPath(new URL('../../../../../config', import.meta.url));
const loaded = await loadConfigDir(configDir);
if (!loaded.ok) throw new Error('config load failed');

const growthConfig = loadGrowthConfig(loaded.configs);
const resourcesConfig = loadResourcesConfig(loaded.configs);
const damageConfig = loadDamageConfig(loaded.configs);
const uprootConfig = loadUprootConfig(loaded.configs);
const tumblingConfig = loadTumblingConfig(loaded.configs);

const bounds = { minX: -128, maxX: 128, minZ: -128, maxZ: 128, minY: -100, maxY: 100 };
const TICK_RATE = 20;
const DT = 1 / TICK_RATE;

interface Harness {
  plantWorld: PlantWorld;
  pipeline: DamagePipeline;
  setWeather: (state: WeatherStateName) => void;
  setNow: (ms: number) => void;
  setMoisture: (moisture: number) => void;
}

function makeHarness(
  overrides: {
    uproot?: Partial<UprootConfig>;
    moisture?: number;
    now?: () => number;
    damage?: Partial<typeof damageConfig>;
    /** Terrain relief under the body, metres above the soil line. */
    terrainHeightAt?: (x: number, z: number) => number;
  } = {},
): Harness {
  const plantWorld = new PlantWorld(
    growthConfig,
    bounds,
    { activeTickRateHz: TICK_RATE },
    resourcesConfig,
  );
  let weather: WeatherStateName = 'clear';
  let moisture = overrides.moisture ?? 30;
  let now: () => number = overrides.now ?? (() => 1_000);
  const resources = {
    getTileResources: () => ({
      light: 80,
      moisture,
      minerals: 50,
      groundwater: 0,
      temperature: 20,
    }),
  } as unknown as ResourceWorld;
  const options: DamagePipelineOptions = {
    plantWorld,
    resourceWorld: resources,
    terrain: overrides.terrainHeightAt
      ? ({
          heightAt: overrides.terrainHeightAt,
          getLatestRevision: () => 0,
          getEditsSince: () => [],
        } as unknown as DamagePipelineOptions['terrain'])
      : null,
    damage: { ...damageConfig, ...overrides.damage },
    uproot: { ...uprootConfig, ...overrides.uproot },
    tumbling: tumblingConfig,
    tickRateHz: TICK_RATE,
    getWeatherState: () => weather,
    lightningFrequencyPerMinute: 6,
    lightningRadiusM: 5,
    random: () => 0.5,
    now,
  };
  const pipeline = new DamagePipeline(options);
  return {
    plantWorld,
    pipeline,
    setWeather: (state) => {
      weather = state;
    },
    setNow: (ms) => {
      now = () => ms;
    },
    setMoisture: (value) => {
      moisture = value;
    },
  };
}

/** A plant with a body big enough to survive a few hits. */
function makePlant(plantWorld: PlantWorld, biomass = 100, seedOnly = false): string {
  const plant = plantWorld.createPlant('owner1', 'world_1', 0, 0);
  const root = plant.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
  if (root) {
    root.biomass = biomass;
    // Most damage and uproot tests need germinated tissue, not a bare coat.
    // The seed-only path has its own immunity test below.
    if (!seedOnly) {
      root.isSeed = false;
      root.type = 'root';
    }
  }
  plant.totalBiomass = biomass;
  return plant.id;
}

describe('damage pipeline: weather', () => {
  it('weather damage reduces tissue and credits nobody', () => {
    const { plantWorld, pipeline, setWeather } = makeHarness();
    const plantId = makePlant(plantWorld);
    setWeather('thunderstorm_active');
    for (let i = 0; i < TICK_RATE; i += 1) pipeline.tick(DT, i);
    const plant = plantWorld.getPlant(plantId);
    assert.ok(plant);
    assert.ok(plant.totalBiomass < 100);
    assert.ok(plant.totalBiomass > 90);
  });

  it('does not uproot a short plant in an ordinary storm', () => {
    const { plantWorld, pipeline, setWeather } = makeHarness();
    const plantId = makePlant(plantWorld, 40);
    setWeather('thunderstorm_active');
    for (let i = 0; i < TICK_RATE * 2; i += 1) pipeline.tick(DT, i);
    assert.equal(plantWorld.getPlant(plantId)?.uproot, undefined);
  });
});

describe('damage pipeline: tool hits and kill credit', () => {
  it('records a tool hit against its player', () => {
    const { plantWorld, pipeline } = makeHarness();
    const plantId = makePlant(plantWorld);
    const hit = pipeline.applyToolHit(plantId, 5, 'player_a');
    assert.equal(hit, true);
    const damage = pipeline.drainEvents().find((event) => event.kind === 'damage');
    assert.ok(damage && damage.kind === 'damage');
    assert.equal(damage.source, 'tool');
    assert.ok(damage.amount > 0);
  });

  it('credits the player that did the most damage when the plant dies', () => {
    const { plantWorld, pipeline } = makeHarness();
    const plantId = makePlant(plantWorld);
    pipeline.applyDamage(plantId, 10, 'tool', 1, { playerId: 'player_a' });
    pipeline.applyDamage(plantId, 30, 'tool', 2, { playerId: 'player_b' });
    const plant = plantWorld.getPlant(plantId);
    assert.ok(plant);
    const death = plantWorld.killPlant(plantId, 'damage');
    assert.ok(death);
    pipeline.onPlantDeath(death, 3);
    const events = pipeline.drainEvents();
    const credit = events.find((event) => event.kind === 'kill_credit');
    assert.ok(credit && credit.kind === 'kill_credit');
    assert.equal(credit.credit.playerId, 'player_b');
    const drops = events.filter((event) => event.kind === 'drop');
    assert.ok(drops.length >= damageConfig.remainsFragmentCount);
  });

  it('tears the root plate out once structural damage passes the threshold', () => {
    const { plantWorld, pipeline } = makeHarness({ uproot: { damageThresholdHp: 20 } });
    const plantId = makePlant(plantWorld, 100);
    pipeline.applyDamage(plantId, 15, 'tool', 1, { playerId: 'player_a' });
    assert.equal(plantWorld.getPlant(plantId)?.uproot, undefined);
    pipeline.applyDamage(plantId, 15, 'tool', 2, { playerId: 'player_a' });
    const state = plantWorld.getPlant(plantId)?.uproot;
    assert.ok(state);
    assert.equal(state.cause, 'structural_damage');
  });
});

describe('damage pipeline: uproot causes', () => {
  it('uproots a germinated plant whose tile stays saturated in a storm', () => {
    const { plantWorld, pipeline, setWeather } = makeHarness({
      moisture: 96,
      uproot: { saturationSeconds: 0.2, saturationCheckIntervalS: 0.1 },
    });
    let plantId = '';
    setWeather('thunderstorm_active');
    plantId = makePlant(plantWorld);
    pipeline.tick(0.15, 1);
    assert.equal(plantWorld.getPlant(plantId)?.uproot, undefined);
    pipeline.tick(0.15, 2);
    const state = plantWorld.getPlant(plantId)?.uproot;
    assert.ok(state);
    assert.equal(state.cause, 'saturation');
  });

  it('does not uproot from saturation in ordinary rain, only in a storm', () => {
    const { plantWorld, pipeline, setWeather } = makeHarness({
      moisture: 96,
      uproot: { saturationSeconds: 0.1, saturationCheckIntervalS: 0.1 },
    });
    const plantId = makePlant(plantWorld);
    setWeather('rain');
    for (let i = 1; i <= 10; i += 1) pipeline.tick(0.2, i);
    assert.equal(plantWorld.getPlant(plantId)?.uproot, undefined);
  });

  it('never uproots a seed that has not germinated', () => {
    const { plantWorld, pipeline, setWeather } = makeHarness({
      moisture: 100,
      uproot: { saturationSeconds: 0.1, saturationCheckIntervalS: 0.1 },
    });
    const plantId = makePlant(plantWorld, 100, true);
    setWeather('thunderstorm_active');
    for (let i = 1; i <= 10; i += 1) pipeline.tick(0.2, i);
    assert.equal(plantWorld.getPlant(plantId)?.uproot, undefined);
    assert.equal(pipeline.forceUproot(plantId, 'saturation', 20), false);
  });

  it('weather damage cannot kill an ungerminated seed', () => {
    // Weather damage is absolute, not scaled by size, so a one-biomass seed used
    // to die in its first storm tick. A seed in its coat is sheltered.
    const { plantWorld, pipeline, setWeather } = makeHarness({
      damage: { weatherDamagePerS: 50 },
    });
    const seedId = makePlant(plantWorld, 1, true);
    setWeather('thunderstorm_active');
    for (let i = 1; i <= 20; i += 1) pipeline.tick(0.2, i);
    assert.ok(plantWorld.getPlant(seedId), 'the seed should still be in the ground');

    // A germinated plant in the same storm does take damage - but only up to
    // the configured share of its own biomass per second, so a 100-biomass
    // plant loses tissue over the same 20 ticks instead of being deleted.
    const grownId = makePlant(plantWorld, 100);
    const before = plantWorld.getPlant(grownId)?.totalBiomass ?? 0;
    for (let i = 21; i <= 40; i += 1) pipeline.tick(0.2, i);
    const after = plantWorld.getPlant(grownId)?.totalBiomass ?? 0;
    assert.ok(after < before, `storm did no damage: ${before} -> ${after}`);
    assert.ok(
      before - after <= before * damageConfig.weatherMaxBiomassFractionPerS * 4 + 1e-6,
      `storm took ${(before - after).toFixed(1)} biomass, more than the cap allows`,
    );
  });

  it('uproots a tall plant in a storm gust', () => {
    const { plantWorld, pipeline, setWeather } = makeHarness({
      uproot: { gustThresholdMps: 1 },
    });
    // Give the plant height so the gust exposure is realistic.
    const plantId = makePlant(plantWorld, 100);
    const plant = plantWorld.getPlant(plantId);
    assert.ok(plant);
    const root = plant.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
    if (root) root.y = 0;
    plant.nodes.set('tip', {
      ...(root as NonNullable<typeof root>),
      id: 'tip',
      y: 3,
      type: 'leaf',
      layer: 'canopy',
      isSeed: false,
      parentId: root?.id ?? null,
      children: [],
      biomass: 5,
    });
    setWeather('thunderstorm_active');
    pipeline.tick(DT, 1);
    const state = plantWorld.getPlant(plantId)?.uproot;
    assert.ok(state);
    assert.equal(state.cause, 'gust');
  });

  it('uproots on a collapse under the root plate', () => {
    const { plantWorld, pipeline } = makeHarness();
    const plantId = makePlant(plantWorld, 100);
    pipeline.forceCollapse(0, 0, 1);
    const state = plantWorld.getPlant(plantId)?.uproot;
    assert.ok(state);
    assert.equal(state.cause, 'collapse');
  });

  it('does not damage the plant whose own root tunnel collapsed', () => {
    // A radicle digs a tunnel two seconds after germination and the dry roof
    // comes down. Before this rule the collapse was billed to the plant that dug
    // it and destroyed the radicle, so growing a first root meant losing it.
    const { plantWorld, pipeline } = makeHarness();
    const plantId = makePlant(plantWorld, 100);
    const before = plantWorld.getPlant(plantId)?.totalBiomass ?? 0;
    pipeline.forceCollapse(0, 0, 1, plantId);
    const plant = plantWorld.getPlant(plantId);
    assert.equal(plant?.totalBiomass, before, 'own tunnel collapse damaged its digger');
    assert.equal(plant?.uproot, undefined, 'own tunnel collapse uprooted its digger');
  });

  it('still damages everyone else under a collapsing tunnel', () => {
    // Excluding the digger must not make collapses harmless: a rival root that
    // undermines your plate is still a hazard.
    const { plantWorld, pipeline } = makeHarness();
    const plantId = makePlant(plantWorld, 100);
    const before = plantWorld.getPlant(plantId)?.totalBiomass ?? 0;
    pipeline.forceCollapse(0, 0, 1, 'p_someone_else');
    const after = plantWorld.getPlant(plantId)?.totalBiomass ?? 0;
    assert.ok(after < before, `collapse did no damage: ${before} -> ${after}`);
  });
});

describe('damage pipeline: reroot and starvation', () => {
  it('crawls to better soil and roots again', () => {
    const { plantWorld, pipeline, setMoisture } = makeHarness({
      moisture: 5,
      uproot: { rerootWindowS: 60, rerootSettleSeconds: 0.1 },
    });
    const plantId = makePlant(plantWorld, 100);
    pipeline.forceUproot(plantId, 'gust', 0);
    pipeline.requestReroot(plantId, 1, 0);
    setMoisture(50);
    let rooted = false;
    for (let i = 1; i <= 200 && !rooted; i += 1) {
      pipeline.tick(0.1, i);
      rooted = plantWorld.getPlant(plantId)?.uproot === undefined;
    }
    assert.ok(rooted, 'plant should have rerooted');
    const plant = plantWorld.getPlant(plantId);
    assert.ok(plant);
    const root = plant.rootNodeId ? plant.nodes.get(plant.rootNodeId) : undefined;
    assert.ok((root?.x ?? 0) > 0, 'crawl should have moved the root east');
  });

  it('keeps the body on the ground when it reroots onto a rise', () => {
    // A node's y is measured from the soil line under that node, so a plant that
    // crawls onto higher ground must keep its offsets; re-basing them onto the
    // terrain height lifted the whole body (and with it Root Sight and Space)
    // into the air by the relief at the landing spot.
    const { plantWorld, pipeline, setMoisture } = makeHarness({
      moisture: 5,
      uproot: { rerootWindowS: 60, rerootSettleSeconds: 0.1 },
      // Any relief will do: the bug multiplied the whole body by the landing
      // height, so a constant 16 m rise caught it wherever the crawl stopped.
      terrainHeightAt: () => 16,
    });
    const plantId = makePlant(plantWorld, 100);
    const before = plantWorld.getPlant(plantId);
    const rootId = before?.rootNodeId ?? null;
    const startY = rootId ? (before?.nodes.get(rootId)?.y ?? 0) : 0;
    pipeline.forceUproot(plantId, 'gust', 0);
    pipeline.requestReroot(plantId, 1, 0);
    setMoisture(50);
    let rooted = false;
    for (let i = 1; i <= 200 && !rooted; i += 1) {
      pipeline.tick(0.1, i);
      rooted = plantWorld.getPlant(plantId)?.uproot === undefined;
    }
    const plant = plantWorld.getPlant(plantId);
    assert.ok(plant);
    assert.ok(rooted, 'plant should have rerooted');
    const root = rootId ? plant.nodes.get(rootId) : undefined;
    assert.ok((root?.x ?? 0) > 0, 'crawl should have moved east');
    assert.equal(root?.y, startY, 'rerooting must not lift the body by the relief');
  });

  it('moves every joint with the body when it crawls', () => {
    // A node's pose is two points, not one: where it is, and where it leaves its
    // parent. Rewriting positions alone left every lateral root attached to the
    // spot its parent had occupied before the crawl, so an uprooted plant came
    // apart at the joints while each node's own position was still correct.
    const { plantWorld, pipeline, setMoisture } = makeHarness({
      moisture: 5,
      uproot: { rerootWindowS: 60, rerootSettleSeconds: 0.1 },
    });
    const plantId = makePlant(plantWorld, 100);
    const plant = plantWorld.getPlant(plantId);
    assert.ok(plant);
    const rootId = plant.rootNodeId ?? '';
    const root = plant.nodes.get(rootId);
    assert.ok(root);
    const child: PlantNode = {
      ...root,
      id: 'test_lateral',
      type: 'lateral_root',
      isSeed: false,
      parentId: rootId,
      children: [],
      biomass: 1,
      x: root.x + 0.5,
      y: root.y,
      z: root.z,
      parentAttachX: root.x + 0.4,
      parentAttachY: root.y,
      parentAttachZ: root.z,
    };
    plant.nodes.set(child.id, child);
    root.children.push(child.id);
    const jointX = (child.parentAttachX ?? 0) - root.x;
    const jointZ = (child.parentAttachZ ?? 0) - root.z;
    const startX = root.x;

    pipeline.forceUproot(plantId, 'gust', 0);
    pipeline.requestReroot(plantId, 1, 0);
    setMoisture(50);
    for (let i = 1; i <= 200; i += 1) {
      pipeline.tick(0.1, i);
      if (plantWorld.getPlant(plantId)?.uproot === undefined) break;
    }

    const settled = plantWorld.getPlant(plantId);
    assert.ok(settled);
    const movedRoot = settled.nodes.get(rootId);
    const movedChild = settled.nodes.get(child.id);
    assert.ok(movedRoot && movedChild);
    assert.ok(
      movedRoot.x > startX + 0.05,
      `crawl should have moved the body east: ${startX} -> ${movedRoot.x}`,
    );
    assert.equal(
      Number(((movedChild.parentAttachX ?? 0) - movedRoot.x).toFixed(3)),
      Number(jointX.toFixed(3)),
      'the joint must keep its offset from the parent',
    );
    assert.equal(
      Number(((movedChild.parentAttachZ ?? 0) - movedRoot.z).toFixed(3)),
      Number(jointZ.toFixed(3)),
      'the joint must keep its offset from the parent',
    );
  });

  it('dies of starvation when it never reaches soil inside the window', () => {
    const { plantWorld, pipeline, setMoisture } = makeHarness({
      moisture: 0,
      uproot: { rerootWindowS: 3, uprootedBiomassDrainPerS: 60 },
    });
    const plantId = makePlant(plantWorld, 100);
    pipeline.forceUproot(plantId, 'gust', 0);
    setMoisture(0);
    let died = false;
    for (let i = 1; i <= 100 && !died; i += 1) {
      pipeline.tick(0.1, i);
      died = plantWorld.getPlant(plantId) === undefined;
    }
    assert.ok(died, 'uprooted plant should starve');
    const deaths = plantWorld.drainDeaths();
    assert.equal(deaths.length, 1);
    assert.equal(deaths[0].cause, 'starvation');
  });
});

describe('damage pipeline: drops', () => {
  it('leaves remains and dung where a plant died', () => {
    const { plantWorld, pipeline } = makeHarness();
    const plantId = makePlant(plantWorld, 100);
    const death = plantWorld.killPlant(plantId, 'damage');
    assert.ok(death);
    pipeline.onPlantDeath(death, 10);
    const drops = pipeline.getDrops();
    const remains = drops.filter((drop) => drop.kind === 'remains');
    const dung = drops.filter((drop) => drop.kind === 'dung');
    assert.equal(remains.length, damageConfig.remainsFragmentCount);
    assert.equal(dung.length, damageConfig.dungPerDeath);
  });

  it('expires drops after their configured lifetime', () => {
    let now = 1_000;
    const { plantWorld, pipeline } = makeHarness({ now: () => now });
    const plantId = makePlant(plantWorld, 100);
    const death = plantWorld.killPlant(plantId, 'damage');
    assert.ok(death);
    pipeline.onPlantDeath(death, 10);
    pipeline.drainEvents();
    assert.ok(pipeline.getDrops().length > 0);
    now += (Math.max(damageConfig.fragmentLifetimeS, damageConfig.dungLifetimeS) + 1) * 1000;
    pipeline.tick(DT, 11);
    assert.equal(pipeline.getDrops().length, 0);
    assert.ok(pipeline.drainEvents().some((event) => event.kind === 'drop_expired'));
  });

  it('does not spawn invisible swarms when automatic fauna is disabled', () => {
    const { plantWorld, pipeline } = makeHarness();
    const plantId = makePlant(plantWorld, 100);
    // The configured interval is minutes; a long run of ticks must not start one.
    for (let i = 1; i <= 1000; i += 1) pipeline.tick(0.1, i);
    assert.equal(pipeline.getActiveSwarm(), null);
    assert.equal(plantWorld.getPlant(plantId)?.totalBiomass, 100);
  });

  it('a swarm browses a plant and leaves dung when it moves on', () => {
    const { plantWorld, pipeline } = makeHarness();
    const plantId = makePlant(plantWorld, 100);
    pipeline.forceSwarm(0, 0, 0);
    pipeline.tick(1, 1);
    assert.ok((plantWorld.getPlant(plantId)?.totalBiomass ?? 0) < 100);
    let ended = false;
    for (let i = 2; i < 600 && !ended; i += 1) {
      pipeline.tick(0.1, i);
      ended = pipeline.getActiveSwarm() === null;
    }
    assert.ok(ended);
    assert.ok(pipeline.getDrops().some((drop) => drop.kind === 'dung'));
  });
});

describe('T06 persistence', () => {
  it('round-trips an uprooted plant through PLNT v3', () => {
    const { plantWorld, pipeline } = makeHarness();
    const plantId = makePlant(plantWorld, 100);
    pipeline.forceUproot(plantId, 'gust', 42);
    const plant = plantWorld.getPlant(plantId);
    assert.ok(plant);
    const restored = deserializePlant(serializePlant(plant));
    assert.ok(restored.uproot);
    assert.equal(restored.uproot.sinceTick, 42);
    assert.notEqual(restored.uproot.phase, 'rooted');
    assert.ok(restored.nodes.size > 0);
  });

  it('restores a rooted plant without an uproot block', () => {
    const { plantWorld } = makeHarness();
    const plantId = makePlant(plantWorld);
    const plant = plantWorld.getPlant(plantId);
    assert.ok(plant);
    const restored = deserializePlant(serializePlant(plant));
    assert.equal(restored.uproot, undefined);
  });
});
