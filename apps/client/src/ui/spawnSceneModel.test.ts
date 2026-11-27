import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canAfford,
  chooseArchetype,
  chooseArea,
  chooseMode,
  createSpawnDraft,
  resolveDraft,
  type SpawnSceneOptions,
  setCoordinateText,
} from './spawnSceneModel.ts';

const options: SpawnSceneOptions = {
  archetypes: [
    {
      id: 'verdant',
      name: 'Verdant',
      description: 'Balanced',
      color: '#8fc45a',
      seedScale: 1,
      growthSpeed: 1,
      waterCapacity: 1,
      mineralCapacity: 1,
      photosynthesis: 1,
      upkeep: 1,
      mutationBias: 'leaf',
    },
    {
      id: 'deeproot',
      name: 'Deeproot',
      description: 'Roots',
      color: '#b58a5a',
      seedScale: 1,
      growthSpeed: 0.9,
      waterCapacity: 1.35,
      mineralCapacity: 1.1,
      photosynthesis: 0.95,
      upkeep: 1.04,
      mutationBias: 'root',
    },
  ],
  namedAreas: [
    {
      id: 'sunmeadow',
      name: 'Sunmeadow',
      description: 'Open ground',
      centerLatitudeDeg: 89.82,
      centerLongitudeDeg: 0,
      radiusM: 70,
      cost: 30,
    },
  ],
  playRadiusM: 620,
  exactCoordinateCost: 40,
  balance: 35,
  startingBalance: 120,
  enabled: true,
  planetRadiusM: 100_000,
  authenticated: false,
};

describe('spawn scene model', () => {
  it('starts on the first archetype and free wild ground', () => {
    const draft = createSpawnDraft(options);
    const decision = resolveDraft(draft, options);
    assert.equal(draft.archetypeId, 'verdant');
    assert.equal(decision.ok, true);
    assert.equal(decision.cost, 0);
    assert.deepEqual(decision.selection, { archetypeId: 'verdant' });
  });

  it('carries the chosen archetype through every mode', () => {
    let draft = chooseArchetype(createSpawnDraft(options), 'deeproot');
    draft = chooseArea(draft, 'sunmeadow');
    const area = resolveDraft(draft, options);
    assert.equal(area.selection?.archetypeId, 'deeproot');
    assert.equal(area.selection?.areaId, 'sunmeadow');
    assert.equal(area.cost, 30);
    assert.equal(canAfford(area, options), true);

    draft = chooseMode(draft, 'exact');
    draft = setCoordinateText(draft, 'latitudeText', '89.9 N');
    draft = setCoordinateText(draft, 'longitudeText', '0.1 E');
    const exact = resolveDraft(draft, options);
    assert.equal(exact.ok, true);
    assert.equal(exact.cost, 40);
    assert.equal(canAfford(exact, options), false, '35 spores cannot buy a 40 spore seed');
  });

  it('refuses a half-entered or malformed coordinate without a selection', () => {
    let draft = chooseMode(createSpawnDraft(options), 'exact');
    assert.equal(resolveDraft(draft, options).ok, false);
    draft = setCoordinateText(draft, 'latitudeText', "12° 75' N");
    draft = setCoordinateText(draft, 'longitudeText', '0 E');
    const decision = resolveDraft(draft, options);
    assert.equal(decision.ok, false);
    assert.equal(decision.selection, null);
    assert.match(decision.message ?? '', /latitude/i);
  });

  it('disables paid modes when the server has closed them', () => {
    const closed = { ...options, enabled: false };
    const draft = chooseArea(createSpawnDraft(closed), 'sunmeadow');
    const decision = resolveDraft(draft, closed);
    assert.equal(decision.ok, false);
    assert.match(decision.message ?? '', /wild seed is free/i);
    assert.equal(resolveDraft(createSpawnDraft(closed), closed).ok, true);
  });
});
