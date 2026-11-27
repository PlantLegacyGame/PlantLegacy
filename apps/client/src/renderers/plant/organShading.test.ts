import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { resolveOrganColours } from '../organPalette.ts';
import { inkColourFor, inkOrganFor, usesOwnInkColour } from './organShading.ts';

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

const paletteConfig = read('../../../../../config/palette.json') as {
  values: {
    ramps: {
      value: { name: string; steps: { step: number; l: number; c: number; h: number }[] }[];
    };
    roles: { value: { name: string; ramp: string; step: number }[] };
  };
};

const colours = resolveOrganColours({
  ramps: paletteConfig.values.ramps.value,
  roles: paletteConfig.values.roles.value,
});

/** The line an organ of this colour is drawn in. */
const inkOf = (hex: string) => inkColourFor(new THREE.Color(hex)).getHexString();

describe('which organ a part is inked as', () => {
  it('inks a flower’s stalk as the stem it is drawn as', () => {
    // The stalk used to take the flower's own ink, so a green stem carried a
    // maroon line and the outline named the wrong part.
    assert.equal(inkOrganFor('flower'), 'stem');
    assert.equal(inkOrganFor('spore_sac'), 'stem');
  });

  it('leaves the organs that are one thing alone', () => {
    for (const type of ['stem', 'trunk', 'root', 'lateral_root', 'leaf', 'cotyledon', 'seed']) {
      assert.equal(inkOrganFor(type), type);
    }
  });

  it('does not fall over on a differently cased type', () => {
    assert.equal(inkOrganFor('Flower'), 'stem');
    assert.equal(inkOrganFor('STEM'), 'stem');
  });

  it('gives the stalk the stem’s line and the head its own', () => {
    // One node, two parts: the stalk is inked as a stem and the head as a flower,
    // so the two lines are different inks rather than one ink used twice.
    const stemInk = inkOf(colours.stem);
    const petalInk = inkOf(colours.flower);
    assert.notEqual(stemInk, petalInk);
    assert.equal(inkOrganFor('flower'), 'stem');
    assert.equal(colours[inkOrganFor('flower') as 'stem'], colours.stem);
  });

  it('is the colour that part is painted, deepened', () => {
    for (const organ of ['stem', 'leaf', 'flower', 'spore'] as const) {
      const body = new THREE.Color(colours[organ]);
      const ink = inkColourFor(body);
      const from = { h: 0, s: 0, l: 0 };
      const to = { h: 0, s: 0, l: 0 };
      body.getHSL(from);
      ink.getHSL(to);
      assert.ok(Math.abs(from.h - to.h) < 0.02, `the ${organ}'s line changed hue`);
      assert.ok(to.l <= from.l + 1e-6, `the ${organ}'s line is lighter than its body`);
      // A line, not an absence of light: deep enough to read, never black.
      assert.ok(to.l <= 0.13, `the ${organ}'s line is not deep enough to be a line`);
      assert.ok(to.l >= 0.05 - 1e-6, `the ${organ}'s line went black`);
    }
  });

  it('keeps the roots on the plate’s own brown', () => {
    assert.equal(usesOwnInkColour('root'), false);
    assert.equal(usesOwnInkColour('lateral_root'), false);
    assert.equal(usesOwnInkColour('radicle'), false);
    assert.equal(usesOwnInkColour('seed'), false);
    assert.equal(usesOwnInkColour('stem'), true);
    // A flower's stalk is a shoot even though its head is not.
    assert.equal(usesOwnInkColour(inkOrganFor('flower')), true);
  });
});
