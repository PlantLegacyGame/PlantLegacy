import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BLOOM_LEVEL,
  FLOWER_CLUMPS,
  MUSHROOM_CLUSTERS,
  sceneryLevels,
  seasonOf,
} from './scenery.ts';

describe('title scenery', () => {
  it('puts the world season on a four-season wheel', () => {
    assert.equal(seasonOf(1), 'spring');
    assert.equal(seasonOf(2), 'summer');
    assert.equal(seasonOf(3), 'autumn');
    assert.equal(seasonOf(4), 'winter');
    // The world keeps counting; the verge wraps, so a long-lived world still has
    // a spring.
    assert.equal(seasonOf(5), 'spring');
    assert.equal(seasonOf(9), 'spring');
    // A menu built before the server has said anything opens on spring rather than
    // on a season nobody announced.
    assert.equal(seasonOf(0), 'spring');
    assert.equal(seasonOf(Number.NaN), 'spring');
    assert.equal(seasonOf(-1), 'spring');
  });

  it('empties the sky and the field when it rains', () => {
    const dry = sceneryLevels({ star: 0, rain: 0, soak: 0, season: 'spring' });
    assert.equal(dry.birds, 1);
    assert.equal(dry.bats, 0);
    assert.ok(dry.rabbit > 0.9);
    // No rain and no standing water: nothing that answers the ground is out.
    assert.equal(dry.mushrooms, 0);
    assert.equal(dry.worms, 0);

    const wet = sceneryLevels({ star: 0, rain: 1, soak: 1, season: 'spring' });
    assert.equal(wet.birds, 0);
    assert.equal(wet.bats, 0);
    assert.equal(wet.rabbit, 0);
    // The ground is wet through, so the soil life is out even though the sky is not.
    assert.equal(wet.mushrooms, 1);
    assert.equal(wet.worms, 1);
  });

  it('swaps the birds for the bats as the sky darkens, never both', () => {
    let seenBirds = 0;
    let seenBats = 0;
    for (let step = 0; step <= 20; step += 1) {
      const levels = sceneryLevels({ star: step / 20, rain: 0, soak: 0, season: 'summer' });
      assert.ok(levels.birds >= 0 && levels.birds <= 1);
      assert.ok(levels.bats >= 0 && levels.bats <= 1);
      if (levels.birds > 0) seenBirds += 1;
      if (levels.bats > 0) seenBats += 1;
      // A sky that has bats in it has no birds: they are the same air.
      if (levels.bats > 0.2) assert.equal(levels.birds, 0);
    }
    assert.ok(seenBirds > 5, 'there is a day with birds in it');
    assert.ok(seenBats > 2, 'there is a night with bats in it');
  });

  it('lights the lamp from dusk, not from an hour', () => {
    assert.equal(sceneryLevels({ star: 0, rain: 0, soak: 0, season: 'winter' }).warmLight, 0);
    assert.equal(sceneryLevels({ star: 1, rain: 0, soak: 0, season: 'winter' }).warmLight, 1);
    const dusk = sceneryLevels({ star: 0.55, rain: 0, soak: 0, season: 'winter' }).warmLight;
    assert.ok(dusk > 0 && dusk < 1, 'dusk is a partial lamp, not a switch');
  });

  it('brings mushrooms up out of wet ground and lets them go when it drains', () => {
    // A title-length shower, measured: the soak reads about 0.12 after twenty
    // seconds of steady rain on the title. That has to put mushrooms on the verge -
    // the earlier gates wanted 0.18 and 0.3, which a shower that long never reached.
    const damp = sceneryLevels({ star: 0, rain: 0, soak: 0.12, season: 'autumn' });
    assert.ok(damp.mushrooms > 0.1 && damp.mushrooms < 0.6, 'a shower brings them part way up');
    assert.equal(damp.worms, 0, 'the worm waits for the ground to be wet through');
    const dry = sceneryLevels({ star: 0, rain: 0, soak: 0.03, season: 'autumn' });
    assert.equal(dry.mushrooms, 0, 'the first water soaks in, it does not pool');
    const soaked = sceneryLevels({ star: 0, rain: 0, soak: 0.5, season: 'autumn' });
    assert.equal(soaked.mushrooms, 1);
    assert.equal(soaked.worms, 1);
    // Worms need more water than mushrooms: they come up later and leave sooner, so
    // halfway through the fill the mushrooms are further along.
    const filling = sceneryLevels({ star: 0, rain: 0, soak: 0.26, season: 'autumn' });
    assert.ok(filling.worms > 0, 'the worm is up in wet ground');
    assert.ok(filling.worms < filling.mushrooms);
  });

  it('keeps the bloom in season and closes it in rain', () => {
    const spring = sceneryLevels({ star: 0, rain: 0, soak: 0, season: 'spring' });
    const winter = sceneryLevels({ star: 0, rain: 0, soak: 0, season: 'winter' });
    assert.equal(spring.blooms, BLOOM_LEVEL.spring);
    assert.ok(winter.blooms > 0 && winter.blooms < spring.blooms, 'winter has stalks');
    const wetSpring = sceneryLevels({ star: 0, rain: 0.8, soak: 0, season: 'spring' });
    assert.ok(wetSpring.blooms < spring.blooms, 'flowers close in the rain');
  });

  it('clamps a sky that is out of range instead of painting outside it', () => {
    const broken = sceneryLevels({ star: Number.NaN, rain: 4, soak: -3, season: 'summer' });
    for (const value of Object.values(broken)) {
      assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
    }
  });

  it('keeps every prop inside its band and clear of the plant', () => {
    for (const clump of FLOWER_CLUMPS) {
      assert.ok(clump.x > 0 && clump.x < 100);
      assert.ok(clump.scale > 0.5 && clump.scale < 1.5);
    }
    for (const cluster of MUSHROOM_CLUSTERS) {
      assert.ok(cluster.x > 0 && cluster.x < 100);
    }
    // The plant stands at 50% and is wide: no clump may sit in its footprint.
    for (const clump of [...FLOWER_CLUMPS, ...MUSHROOM_CLUSTERS]) {
      assert.ok(Math.abs(clump.x - 50) > 7, `${clump.x}% is too close to the plant`);
    }
  });
});
