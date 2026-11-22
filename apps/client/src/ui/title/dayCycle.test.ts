import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cyclePhase,
  isNight,
  leafThroughLight,
  lerpHex,
  lightMood,
  moonBrightness,
  moonPosition,
  paletteAt,
  sunPosition,
  sunWashGate,
  titleLighting,
} from './dayCycle.ts';

describe('light through the leaves', () => {
  const hidden = { x: 0, y: 0, visible: false };

  it('is only a trace with a disc overhead', () => {
    // Thin leaves always hold a little of the sky; nothing here is a glow.
    const overhead = leafThroughLight(paletteAt(0.5), { x: 0.5, y: 1, visible: true }, hidden);
    assert.ok(overhead.amount < 0.1, `sun overhead lit the leaves: ${overhead.amount}`);
    const night = leafThroughLight(paletteAt(0), hidden, { x: 0.5, y: 1, visible: true });
    assert.ok(night.amount < 0.25, `a moon overhead lit the leaves: ${night.amount}`);
    // A disc low on the horizon is the case that must light them: grazing light.
    const grazing = leafThroughLight(paletteAt(0.5), { x: 0.02, y: 0.05, visible: true }, hidden);
    assert.ok(
      grazing.amount > 0.15,
      `a disc on the horizon did not light the leaves: ${grazing.amount}`,
    );
  });

  it('lights the leaves at the hours the bodies are really low', () => {
    // The arcs are the ones the title draws: moonrise and sunset are the grazing
    // hours, and the old gate (centred *and* low) matched neither of them.
    for (const [phase, want] of [
      [0.78, 0.2],
      [0.72, 0.12],
    ] as const) {
      const light = leafThroughLight(paletteAt(phase), sunPosition(phase), moonPosition(phase));
      assert.ok(light.amount > want, `phase ${phase} left the canopy flat: ${light.amount}`);
    }
  });

  it('runs one version for the moon and one for the sun', () => {
    const moon = leafThroughLight(paletteAt(0), hidden, { x: 0.5, y: 0.05, visible: true });
    const sun = leafThroughLight(paletteAt(0.75), { x: 0.5, y: 0.05, visible: true }, hidden);
    assert.ok(moon.amount > 0.2, `moon through the leaves is ${moon.amount}`);
    assert.ok(sun.amount > 0.1, `sun through the leaves is ${sun.amount}`);
    // Cold for the moon, warm for the sun: the point of having two versions.
    const rgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const [mr, , mb] = rgb(moon.colour);
    const [sr, , sb] = rgb(sun.colour);
    assert.ok((mb ?? 0) > (mr ?? 0), `the moon's light is not cold: ${moon.colour}`);
    assert.ok((sr ?? 0) > (sb ?? 0), `the sun's light is not warm: ${sun.colour}`);
  });

  it('fades as the disc climbs away from the crown', () => {
    const low = leafThroughLight(paletteAt(0), hidden, { x: 0.5, y: 0.04, visible: true });
    const high = leafThroughLight(paletteAt(0), hidden, { x: 0.5, y: 0.3, visible: true });
    assert.ok(low.amount > high.amount, 'a high moon lit the canopy as much as a low one');
  });
});

describe('title day cycle', () => {
  it('wraps the phase over one cycle', () => {
    assert.equal(cyclePhase(0, 3600_000), 0);
    assert.equal(cyclePhase(1_800_000, 3600_000), 0.5);
    assert.ok(Math.abs(cyclePhase(3_600_000, 3_600_000) - 0) < 1e-9);
    assert.equal(cyclePhase(1000, 0), 0);
  });

  it('blends between the keyframe colours', () => {
    assert.equal(lerpHex('#000000', '#ffffff', 0), '#000000');
    assert.equal(lerpHex('#000000', '#ffffff', 1), '#ffffff');
    assert.equal(lerpHex('#000000', '#ffffff', 0.5), '#808080');
  });

  it('gives a bright sky at noon and a dark one at midnight', () => {
    const noon = paletteAt(0.5);
    const midnight = paletteAt(0);
    assert.ok(noon.star === 0, 'no stars at noon');
    assert.ok(midnight.star > 0.9, 'stars at midnight');
    assert.ok(midnight.plantDim < noon.plantDim, 'plant dims at night');
    // Day sky is lighter than night sky.
    const noonHigh = Number.parseInt(noon.skyHigh.slice(1, 3), 16);
    const nightHigh = Number.parseInt(midnight.skyHigh.slice(1, 3), 16);
    assert.ok(noonHigh > nightHigh + 30);
  });

  it('never leaves the cycle between two keyframes', () => {
    for (let i = 0; i <= 100; i += 1) {
      const palette = paletteAt(i / 100);
      assert.match(palette.skyHigh, /^#[0-9a-f]{6}$/);
      assert.ok(palette.star >= 0 && palette.star <= 1);
      assert.ok(palette.plantDim > 0 && palette.plantDim <= 1);
    }
  });

  it('keeps the sun above the horizon from dawn to dusk', () => {
    const dawn = sunPosition(0.25);
    const noon = sunPosition(0.5);
    const dusk = sunPosition(0.75);
    assert.equal(dawn.visible, true);
    assert.ok(Math.abs(dawn.x) < 1e-9);
    assert.ok(Math.abs(noon.x - 0.5) < 1e-9);
    assert.ok(noon.y > 0.99, `sun should peak at noon, got ${noon.y}`);
    assert.ok(Math.abs(dusk.x - 1) < 1e-9);
    assert.equal(sunPosition(0.0).visible, false);
    assert.equal(sunPosition(0.9).visible, false);
  });

  it('gates the sun wash on the disc, not on the palette glow', () => {
    // Sunset: the palette is still warm, but there is no sun left to wash the scene.
    assert.equal(sunWashGate(sunPosition(0.9)), 0);
    assert.equal(sunWashGate({ x: 0, y: 0, visible: false }), 0);
    assert.equal(sunWashGate({ x: 0.5, y: 1, visible: true }), 1);
    assert.ok(sunWashGate({ x: 0.2, y: 0.11, visible: true }) < 0.6, 'low sun washes less');
  });

  it('never shows the sun and the moon at once', () => {
    for (let i = 0; i <= 100; i += 1) {
      const phase = i / 100;
      assert.ok(
        !(sunPosition(phase).visible && moonPosition(phase).visible),
        `both visible at ${phase}`,
      );
    }
  });

  it('moves the moon through the night half', () => {
    const lateEvening = moonPosition(0.8);
    const midnight = moonPosition(0.0);
    assert.equal(lateEvening.visible, true);
    assert.ok(midnight.y > 0.9, `moon should peak around midnight, got ${midnight.y}`);
    assert.equal(moonPosition(0.5).visible, false);
  });

  it('agrees with itself about when it is night', () => {
    assert.equal(isNight(0), true);
    assert.equal(isNight(0.5), false);
    assert.equal(isNight(0.8), true);
    assert.equal(isNight(0.3), false);
  });
});

describe('light mood', () => {
  it('reads warmth from the horizon colour, not the hour', () => {
    assert.ok(lightMood(paletteAt(0.75)).warmth > 0.4, 'dusk is golden');
    assert.ok(lightMood(paletteAt(0.5)).warmth < 0.2, 'noon is neutral');
  });

  it('is only dark at night', () => {
    assert.ok(lightMood(paletteAt(0)).night > 0.6);
    assert.ok(lightMood(paletteAt(0.5)).night < 0.2);
  });
});

describe('title lighting', () => {
  it('keeps the sun glow for the day and drops it at night', () => {
    assert.ok(titleLighting(paletteAt(0.5)).sunWash > 0.2);
    assert.equal(titleLighting(paletteAt(0.05)).sunWash < 0.05, true, 'no glow after sunset');
  });

  it('swaps the sun glow for a moon halo at night', () => {
    const midnight = titleLighting(paletteAt(0));
    assert.ok(midnight.moonWash > 0.4, 'the moon lights the night');
    assert.ok(midnight.nightWash <= 0.45, 'the night pass stays light enough to see');
    assert.equal(titleLighting(paletteAt(0.5)).moonWash, 0, 'no moon halo at noon');
  });

  it('lights the horizon and the near foreground with the same grade', () => {
    const dusk = titleLighting(paletteAt(0.75));
    const noon = titleLighting(paletteAt(0.5));
    const night = titleLighting(paletteAt(0));
    assert.ok(dusk.bloom > noon.bloom, 'the horizon burns at golden hour');
    assert.equal(night.bloom < 0.02, true, 'no bloom once the sun is down');
    assert.ok(night.milkyWay > 0.15, 'the band of stars comes out at night');
    assert.equal(noon.milkyWay, 0);
    assert.ok(noon.cloudShadow > 0.3, 'shadows cross the soil by day');
    assert.equal(night.cloudShadow < 0.1, true, 'and fade with the sun');
    assert.match(noon.leafRim, /^#[0-9a-f]{6}$/);
    assert.ok(night.leafRimOpacity < dusk.leafRimOpacity + 0.01);
  });

  it('warms the leaves at dusk and cools them under moonlight', () => {
    assert.ok(titleLighting(paletteAt(0.75)).plantHue > 0, 'golden hour is warm');
    assert.ok(titleLighting(paletteAt(0)).plantHue < 0, 'moonlight is cool');
    assert.ok(titleLighting(paletteAt(0.5)).plantSepia < 0.02, 'noon is neutral');
  });
});

describe('moon brightness', () => {
  it('is out in daylight and whole at night', () => {
    assert.equal(moonBrightness(0), 0);
    assert.equal(moonBrightness(0.2), 0);
    assert.equal(moonBrightness(0.26), 0);
    assert.ok(moonBrightness(0.6) > 0.99);
    assert.equal(moonBrightness(1), 1);
  });

  it('rises through dusk instead of switching at an hour', () => {
    let previous = -1;
    for (let star = 0; star <= 1.0001; star += 0.05) {
      const value = moonBrightness(star);
      assert.ok(value >= previous - 1e-9, `fell at star ${star}`);
      assert.ok(value >= 0 && value <= 1);
      previous = value;
    }
    // Half the way through the ramp it is half drawn - that band of bright sky the
    // clock still called night is where the full moon used to hang.
    assert.ok(Math.abs(moonBrightness(0.43) - 0.5) < 0.06);
  });

  it('never draws a moon for a missing number', () => {
    assert.equal(moonBrightness(Number.NaN), 0);
  });
});
