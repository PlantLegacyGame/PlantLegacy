import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { oklchToHex } from '@plant-legacy/shared/color';
import { ORGAN_ROLES, resolveOrganColours } from './organPalette.ts';

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

const organs = Object.keys(ORGAN_ROLES) as (keyof typeof ORGAN_ROLES)[];

describe("the plant's organ palette", () => {
  it('names a role for every organ, never a step', () => {
    const roles = new Set(palette.roles.map((role) => role.name));
    for (const organ of organs) {
      const role = ORGAN_ROLES[organ];
      assert.match(role, /^[a-z][a-z_]*$/, `${organ} should name a role, not a step: ${role}`);
      assert.ok(roles.has(role), `${organ} asks for role ${role}, which the palette lacks`);
    }
  });

  it("paints every organ with its role's step", () => {
    const colours = resolveOrganColours(palette);
    for (const organ of organs) {
      const role = palette.roles.find((candidate) => candidate.name === ORGAN_ROLES[organ]);
      assert.ok(role, `${organ} asks for a role the palette lacks`);
      assert.equal(colours[organ], stepHex(role.ramp, role.step));
    }
  });

  it("keeps the leaf on the art bible's leaf_body role", () => {
    assert.equal(ORGAN_ROLES.leaf, 'leaf_body');
  });

  it('refuses a palette that lacks an organ role', () => {
    assert.throws(
      () => resolveOrganColours({ ramps: palette.ramps, roles: [] }),
      /the palette has no role bark_deep for the bark organ/,
    );
  });

  it('leaves no colour literal in the mesh plant renderer', () => {
    const source = readFileSync(new URL('./MeshPlantRenderer.ts', import.meta.url), 'utf8');
    const hexes = source.match(/0x[0-9a-f]{6}\b/gi) ?? [];
    assert.deepEqual(hexes, [], `organ colours should come from the palette: ${hexes.join(', ')}`);
  });
});
