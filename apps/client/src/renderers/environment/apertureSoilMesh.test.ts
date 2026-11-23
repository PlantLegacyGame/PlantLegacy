import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  apertureSoilBounds,
  apertureSoilSdf,
  buildApertureSoilMesh,
  type GroundHeight,
} from '@plant-legacy/shared/world';
import {
  APERTURE_SOIL_BELOW_FLOOR_M,
  APERTURE_SOIL_EXTENT_M,
  APERTURE_SOIL_GAP_M,
  APERTURE_SOIL_MIN_DEPTH_M,
  APERTURE_SOIL_TOP_INSET_M,
  apertureSoilParamsFor,
} from './apertureSoilMesh.ts';
import { CAVITY_CUT_OVERREACH, cavityDepthM } from './cavity/index.ts';

const CENTRE_X = 1.7;
const CENTRE_Z = -2.4;

/**
 * The apertures the world actually opens: `aperture_min_m` for a seedling, the
 * config's 0.7 x 7 combination, and the sizes a grown plant reaches.
 */
const APERTURES_M = [0.28, 0.7, 1.4, 4.9];

const flat: GroundHeight = () => 4;
const bank: GroundHeight = (x, z) => 4 + 0.4 * x - 0.2 * z;

/**
 * The body the renderer asks for, built from the aperture alone, exactly as
 * `EnvironmentRenderer.syncApertureSoil` builds it: the bowl's mouth is the
 * aperture times the cut overreach, and the floor is the pit's depth plus the
 * clearance the body keeps under it.
 */
function bodyFor(apertureM: number) {
  const mouthM = apertureM * CAVITY_CUT_OVERREACH;
  const params = apertureSoilParamsFor({
    centreX: CENTRE_X,
    centreZ: CENTRE_Z,
    mouthRadiusM: mouthM,
    depthM: cavityDepthM(apertureM) + APERTURE_SOIL_BELOW_FLOOR_M,
  });
  return { apertureM, mouthM, params };
}

function radiusOf(params: { centreXM: number; centreZM: number }, x: number, z: number): number {
  return Math.hypot(x - params.centreXM, z - params.centreZM);
}

describe('the aperture body fits the bowl it is cut for', () => {
  it('sits its top under the sheet, on flat ground and on a bank', () => {
    for (const ground of [flat, bank]) {
      for (const apertureM of APERTURES_M) {
        const { params } = bodyFor(apertureM);
        // Outside the shaft, so the top plane is the only face in play.
        const x = CENTRE_X + params.voidRadiusM + 0.5;
        const z = CENTRE_Z;
        const surface = ground(x, z);
        const top = surface - params.topInsetM;
        assert.ok(
          apertureSoilSdf(ground, params, x, surface - params.topInsetM / 2, z) > 0,
          `aperture ${apertureM}: air between the sheet and the body is soil`,
        );
        assert.ok(
          apertureSoilSdf(ground, params, x, top - 0.05, z) < 0,
          `aperture ${apertureM}: the body has no earth under its own top`,
        );
        assert.equal(params.topInsetM, APERTURE_SOIL_TOP_INSET_M);
        assert.ok(params.topInsetM > 0, 'a top at the sheet z-fights it');
      }
    }
  });

  it('keeps every meshed vertex under the sheet, with the top at the inset', () => {
    for (const apertureM of APERTURES_M) {
      const { params } = bodyFor(apertureM);
      const body = buildApertureSoilMesh(bank, params);
      assert.ok(body, `aperture ${apertureM}: nothing meshed`);

      let highest = Number.NEGATIVE_INFINITY;
      for (let v = 0; v < body.vertices; v += 1) {
        const x = body.positions[v * 3];
        const y = body.positions[v * 3 + 1];
        const z = body.positions[v * 3 + 2];
        const aboveTop = y - (bank(x, z) - params.topInsetM);
        assert.ok(
          aboveTop <= 1e-5,
          `aperture ${apertureM}: a vertex is ${aboveTop.toFixed(3)} m above the body's top`,
        );
        if (aboveTop > highest) highest = aboveTop;
      }
      // Not merely under the sheet: close enough to it that a buried eye at the
      // lip still has earth overhead, rather than a body sunk out of reach.
      assert.ok(
        highest > -1e-3,
        `aperture ${apertureM}: the nearest top vertex is ${(-highest).toFixed(3)} m under the inset`,
      );
    }
  });

  it('cuts its void wider than the bowl mouth, and never fills the bowl', () => {
    for (const apertureM of APERTURES_M) {
      const { mouthM, params } = bodyFor(apertureM);
      assert.ok(
        Math.abs(params.voidRadiusM - mouthM - APERTURE_SOIL_GAP_M) < 1e-12,
        `aperture ${apertureM}: void ${params.voidRadiusM.toFixed(3)} m is not the mouth plus the gap`,
      );
      assert.ok(
        params.voidRadiusM > mouthM,
        `aperture ${apertureM}: the shaft is not wider than the bowl's mouth`,
      );

      // The bowl's own volume is air: its axis, half its mouth, and its wall,
      // from under the lip to its floor.
      // Level ground: on a bank the mouth's plane is the lowest ground under
      // the lip, so the bowl's own volume is not the column under its centre.
      const bowlDepth = cavityDepthM(mouthM);
      for (const fraction of [0, 0.5, 0.9]) {
        for (const depth of [0.05, bowlDepth / 2, bowlDepth - 0.05]) {
          const x = CENTRE_X + mouthM * fraction;
          const z = CENTRE_Z;
          const sdf = apertureSoilSdf(flat, params, x, flat(x, z) - depth, z);
          assert.ok(
            sdf > 0,
            `aperture ${apertureM}: soil ${sdf.toFixed(3)} m into the bowl at r ${(mouthM * fraction).toFixed(2)} m, ${depth.toFixed(2)} m down`,
          );
        }
      }
    }
  });

  it('meshes no vertex inside the void, at any aperture', () => {
    // Surface nets lands vertices near the field's surface, not on it, and at a
    // seedling's 30 cm mouth the cells are nearly as wide as the shaft. The
    // builder pushes those vertices back to the void's radius; without it 82 of
    // them sat up to 27 mm inside the mouth the bowl lines.
    for (const apertureM of APERTURES_M) {
      const { mouthM, params } = bodyFor(apertureM);
      const body = buildApertureSoilMesh(bank, params);
      assert.ok(body, `aperture ${apertureM}: nothing meshed`);
      for (let v = 0; v < body.vertices; v += 1) {
        const radius = radiusOf(params, body.positions[v * 3], body.positions[v * 3 + 2]);
        assert.ok(
          radius >= params.voidRadiusM - 1e-6,
          `aperture ${apertureM}: a vertex ${(params.voidRadiusM - radius).toFixed(4)} m inside the void (mouth ${mouthM.toFixed(3)} m)`,
        );
      }
    }
  });

  it('reaches past the aperture in plan and below the bowl in depth', () => {
    for (const apertureM of APERTURES_M) {
      const { mouthM, params } = bodyFor(apertureM);
      const bowlDepth = cavityDepthM(mouthM);
      assert.ok(
        params.extentM >= params.voidRadiusM,
        `aperture ${apertureM}: extent ${params.extentM.toFixed(2)} m is inside the shaft`,
      );
      assert.ok(
        params.extentM >= APERTURE_SOIL_EXTENT_M,
        `aperture ${apertureM}: extent fell under the body floor`,
      );
      assert.ok(
        params.depthM >= bowlDepth + 0.2,
        `aperture ${apertureM}: body ${params.depthM.toFixed(2)} m deep does not reach past the ${bowlDepth.toFixed(2)} m bowl`,
      );
      assert.ok(
        params.depthM >= APERTURE_SOIL_MIN_DEPTH_M,
        `aperture ${apertureM}: depth fell under the body floor`,
      );

      // The sample box covers what the field claims: the plan extent either way
      // and the full depth, so the mesh cannot be clipped by its own bounds.
      const bounds = apertureSoilBounds(bank, params);
      assert.ok(
        bounds.max[0] - bounds.min[0] >= 2 * params.extentM - 1e-9 &&
          bounds.max[2] - bounds.min[2] >= 2 * params.extentM - 1e-9,
        `aperture ${apertureM}: plan bounds are narrower than the extent`,
      );
      assert.ok(
        bounds.max[1] - bounds.min[1] >= params.depthM,
        `aperture ${apertureM}: bounds are shallower than the body`,
      );
    }
  });
});
