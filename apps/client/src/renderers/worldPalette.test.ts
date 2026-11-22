import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { oklchToHex } from '@plant-legacy/shared/color';
import { applyWorldPalette, WORLD_ROLES, worldColour } from './worldPalette.ts';

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

const paletteConfig = read('../../../../config/palette.json') as {
  values: {
    ramps: {
      value: { name: string; steps: { step: number; l: number; c: number; h: number }[] }[];
    };
    roles: { value: { name: string; ramp: string; step: number }[] };
  };
};

const palette = {
  ramps: paletteConfig.values.ramps.value,
  roles: paletteConfig.values.roles.value,
};

const stepHex = (rampName: string, step: number) => {
  const ramp = palette.ramps.find((candidate) => candidate.name === rampName);
  const entry = ramp?.steps.find((candidate) => candidate.step === step);
  return entry ? oklchToHex(entry).hex : undefined;
};

/** The renderers that own a world colour; none of them may carry a hex literal. */
const WORLD_FILES = [
  './worldPalette.ts',
  './PlantRenderer.ts',
  './EnvironmentRenderer.ts',
  './environment/ground.ts',
  './environment/waterMaterial.ts',
  './environment/waterField.ts',
  './environment/ocean.ts',
  './environment/rainSystem.ts',
];

describe("the world's palette", () => {
  it('names only roles the palette has, and names none twice', () => {
    const names = new Set(palette.roles.map((role) => role.name));
    assert.equal(new Set(WORLD_ROLES).size, WORLD_ROLES.length, 'a world role is listed twice');
    for (const role of WORLD_ROLES) {
      assert.match(role, /^[a-z][a-z_]*$/, `${role} should name a role, not a step`);
      assert.ok(names.has(role), `the palette has no role ${role}`);
    }
  });

  it("paints each role with that role's step", () => {
    applyWorldPalette(palette);
    for (const role of WORLD_ROLES) {
      const entry = palette.roles.find((candidate) => candidate.name === role);
      assert.ok(entry, `the palette has no role ${role}`);
      assert.equal(worldColour(role).getHexString(), stepHex(entry.ramp, entry.step)?.slice(1));
    }
  });

  it('refuses a palette that lacks a world role, at boot rather than at draw', () => {
    assert.throws(() => applyWorldPalette({ ramps: palette.ramps, roles: [] }), /no role sunlight/);
  });

  it('leaves no colour literal in the world renderers', () => {
    // Colour-shaped hexes only: a hash seed (0x5eed1234) is not a colour, but a
    // material set to 0xrrggbb or 0xrrggbbaa is.
    const colourLiteral = /(?:Color\(|\.set\(|setHex\(|color:\s*)0x[0-9a-f]{6,8}/gi;
    for (const path of WORLD_FILES) {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      const hexes = source.match(colourLiteral) ?? [];
      assert.deepEqual(hexes, [], `${path} still carries ${hexes.join(', ')}`);
    }
  });
});
