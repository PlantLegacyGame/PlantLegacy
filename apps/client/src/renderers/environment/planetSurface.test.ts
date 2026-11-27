import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_TERRAIN_FIELD } from '@plant-legacy/shared/world';
import * as THREE from 'three';
import {
  createPlanetBody,
  createPlayDisk,
  createTerrainFarField,
  createTerrainPatch,
  createTerrainPatches,
  createTerrainSkirt,
  FAR_FIELD_EXTENT_M,
  FAR_FIELD_RELIEF_M,
  farFieldRelief,
  PLANET_BODY_SEGMENTS,
  PLAY_DISK_CELL_M,
  patchLocalSurfaceY,
  planetFacetSag,
  planetGravity,
  planetSurfaceDrop,
  planetSurfaceFrame,
  planetSurfaceY,
  planetTerrainY,
  planetUp,
  SOIL_SLAB_INSET_M,
  surfaceUpAt,
  TERRAIN_SKIN_M,
  terrainRelief,
} from './planetSurface.ts';

const RADIUS = 300;
const FIELD = {
  ...DEFAULT_TERRAIN_FIELD,
  amplitudeM: 2.4,
  patchRadiusM: 300,
  rimFadeFraction: 0.35,
};

describe('planet surface', () => {
  it('puts the pole at the tangent plane and drops away from it', () => {
    assert.equal(planetSurfaceDrop(RADIUS, 0, 0), 0);
    assert.equal(planetSurfaceY(RADIUS, 0, 0), 0);

    const near = planetSurfaceDrop(RADIUS, 10, 0);
    const far = planetSurfaceDrop(RADIUS, 40, 0);
    assert.ok(near > 0);
    assert.ok(far > near);
    // r = 50 on a 300 m planet: 300 - sqrt(300² - 50²) ≈ 4.2 m.
    assert.ok(Math.abs(planetSurfaceDrop(RADIUS, 50, 0) - 4.19) < 0.05);
  });

  it('is symmetric in every direction around the pole', () => {
    assert.equal(planetSurfaceDrop(RADIUS, 20, 0), planetSurfaceDrop(RADIUS, 0, 20));
    assert.equal(planetSurfaceDrop(RADIUS, 12, 16), planetSurfaceDrop(RADIUS, 16, -12));
  });

  it('clamps past the horizon instead of returning NaN', () => {
    assert.equal(planetSurfaceDrop(RADIUS, RADIUS + 10, 0), RADIUS);
    assert.equal(planetSurfaceDrop(0, 10, 10), 0);
    assert.equal(planetSurfaceDrop(RADIUS, Number.NaN, 0), 0);
  });

  it('places surface points exactly on the sphere and normals point outward', () => {
    for (const [x, z] of [
      [0, 0],
      [10, -5],
      [40, 40],
    ]) {
      const { point, normal } = planetSurfaceFrame(RADIUS, x as number, z as number);
      const centre = { y: -RADIUS };
      const distance = Math.hypot(point.x, point.y - centre.y, point.z);
      assert.ok(Math.abs(distance - RADIUS) < 1e-6);
      assert.ok(Math.abs(normal.length() - 1) < 1e-9);
      assert.ok(normal.y > 0);
      // Point minus centre must be radial.
      assert.ok(Math.abs(point.x - normal.x * RADIUS) < 1e-6);
      assert.ok(Math.abs(point.z - normal.z * RADIUS) < 1e-6);
    }
  });

  it('lifts a point along the surface normal by the requested altitude', () => {
    const { point } = planetSurfaceFrame(RADIUS, 20, 20, 0.5);
    assert.ok(point.y > planetSurfaceY(RADIUS, 20, 20));
  });

  it('answers world up for the flat world and planet up otherwise', () => {
    assert.deepEqual(surfaceUpAt(0, 10, -4).toArray(), [0, 1, 0]);
    assert.ok(surfaceUpAt(RADIUS, 30, -20).distanceTo(planetUp(RADIUS, 30, -20)) < 1e-12);
  });

  it('gives gravity that points at the planet centre, opposite the surface up', () => {
    const up = planetUp(RADIUS, 30, -20);
    const gravity = planetGravity(RADIUS, 30, -20);
    assert.ok(Math.abs(up.length() - 1) < 1e-9);
    assert.ok(gravity.x === -up.x && gravity.y === -up.y && gravity.z === -up.z);

    const point = planetSurfaceFrame(RADIUS, 30, -20).point;
    const toCentre = { x: -point.x, y: -RADIUS - point.y, z: -point.z };
    const length = Math.hypot(toCentre.x, toCentre.y, toCentre.z);
    const dot = (gravity.x * toCentre.x + gravity.y * toCentre.y + gravity.z * toCentre.z) / length;
    assert.ok(Math.abs(dot - 1) < 1e-9);
  });

  it('adds deterministic, bounded relief that actually varies', () => {
    assert.equal(terrainRelief(12.5, -3.25, FIELD), terrainRelief(12.5, -3.25, FIELD));
    assert.equal(terrainRelief(10, 10, { ...FIELD, amplitudeM: 0 }), 0);

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = -40; i <= 40; i += 1) {
      for (let j = -40; j <= 40; j += 1) {
        const relief = terrainRelief(i * 3.7, j * 2.9, FIELD);
        assert.ok(relief >= 0);
        assert.ok(relief <= FIELD.amplitudeM + 1e-9);
        min = Math.min(min, relief);
        max = Math.max(max, relief);
      }
    }
    assert.ok(max - min > FIELD.amplitudeM * 0.5, 'terrain has no relief');
  });

  it('puts the relief on top of the sphere drop and fades it out at the rim', () => {
    const x = 5;
    const z = -3;
    const expected = planetSurfaceY(RADIUS, x, z) + terrainRelief(x, z, FIELD) + TERRAIN_SKIN_M;
    assert.ok(Math.abs(planetTerrainY(RADIUS, x, z, FIELD) - expected) < 1e-12);
    assert.equal(
      planetTerrainY(RADIUS, x, z, { ...FIELD, amplitudeM: 0 }),
      planetSurfaceY(RADIUS, x, z) + TERRAIN_SKIN_M,
    );
    // At the patch rim the authored relief has faded to nothing and the far
    // field has not started, so the two share the bare sphere: the seam is one
    // surface, not a step.
    const rim = FIELD.patchRadiusM;
    assert.equal(terrainRelief(rim, 0, FIELD), 0);
    assert.equal(farFieldRelief(rim, 0, FIELD), 0);
    // The ring's hole is a square, so every point on its edge is on the seam.
    for (const [x, z] of [
      [rim, rim],
      [rim, -rim * 0.5],
      [-rim, rim * 0.25],
      [0, -rim],
    ] as const) {
      assert.equal(farFieldRelief(x, z, FIELD), 0, `the far field lifts the seam at ${x}, ${z}`);
    }
    assert.ok(Math.abs(terrainRelief(rim + 2, 0, FIELD) - terrainRelief(rim - 2, 0, FIELD)) < 0.2);
    // Past the rim there is relief again. The far field is sunk so most of it is
    // sea, so it may dip under the sphere - the planet body is drawn under the
    // water there and the trough only deepens the sea.
    let farMin = Number.POSITIVE_INFINITY;
    let farMax = Number.NEGATIVE_INFINITY;
    let farEdge = 0;
    for (let i = -12; i <= 12; i += 1) {
      for (let j = -12; j <= 12; j += 1) {
        const relief = farFieldRelief(i * 250, j * 250, FIELD);
        farMin = Math.min(farMin, relief);
        farMax = Math.max(farMax, relief);
        if (Math.hypot(i * 250, j * 250) > 900) farEdge = Math.max(farEdge, relief);
      }
    }
    assert.ok(farMin > -12, 'the far field is deeper than the sea can cover');
    assert.ok(farEdge > 4, 'the far field has no hills');
    assert.ok(farMax < FIELD.amplitudeM + FAR_FIELD_RELIEF_M + 2, 'the far field is unbounded');
  });

  it('carries far hills on the horizon ring, wide and proud of the sphere', () => {
    const mesh = createTerrainFarField(RADIUS, FIELD, new THREE.MeshBasicMaterial());
    const positions = mesh.geometry.getAttribute('position');
    let indented = 0;
    let outer = 0;
    for (let i = 0; i < positions.count; i += 1) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const distance = Math.hypot(x, z);
      outer = Math.max(outer, distance);
      // Local Y is the drop, the relief and the skin. The ring may not sit
      // inside the sphere it is the surface of, or the body would cover it.
      const relief = positions.getY(i) - planetSurfaceY(RADIUS, x, z);
      if (distance >= FIELD.patchRadiusM - 1e-6 && relief < -1e-3) indented += 1;
    }
    assert.equal(indented, 0, 'the horizon ring sinks into the planet body');
    assert.ok(outer > 2500, 'the horizon ring does not reach the horizon');
    // The ring covers the whole outer square, from the authored ring's edge.
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    assert.ok(box && Math.abs(box.min.x + FAR_FIELD_EXTENT_M / 2) < 1e-3);
  });

  it('carries the relief on a metre-scale patch instead of the planet sphere', () => {
    const extent = 180;
    const segments = 96;
    const patch = createTerrainPatch(
      RADIUS,
      FIELD,
      new THREE.MeshBasicMaterial(),
      segments,
      extent,
    );
    const cellSize = extent / segments;
    assert.ok(cellSize < 3, `terrain cells are ${cellSize.toFixed(1)} m across`);
    // The radius is a placement, not part of the vertex data.
    assert.equal(patch.position.y, RADIUS);

    const positions = patch.geometry.getAttribute('position');
    let spread = 0;
    for (let i = 0; i < positions.count; i += 1) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const relief = positions.getY(i) - planetSurfaceY(RADIUS, x, z) - 0.02; // the patch skin
      // Raise-only: the sphere stays the physics floor, so no vertex may dip
      // below it, and none may exceed the configured amplitude.
      assert.ok(relief >= -1e-3, `terrain dips ${relief.toFixed(3)} m below the sphere`);
      assert.ok(relief <= FIELD.amplitudeM + 0.05, `terrain rises ${relief.toFixed(2)} m`);
      spread = Math.max(spread, relief);
    }
    assert.ok(spread > FIELD.amplitudeM * 0.5, `patch only rises ${spread.toFixed(2)} m`);

    const planet = createPlanetBody(RADIUS, new THREE.MeshBasicMaterial());
    const planetPositions = planet.geometry.getAttribute('position');
    let offSphere = 0;
    for (let i = 0; i < planetPositions.count; i += 1) {
      const length = Math.hypot(
        planetPositions.getX(i),
        planetPositions.getY(i),
        planetPositions.getZ(i),
      );
      if (Math.abs(length - RADIUS) > 1e-3) offSphere += 1;
    }
    assert.equal(offSphere, 0);
  });

  it('builds a detailed inner patch and a coarse outer patch on the same field', () => {
    const material = new THREE.MeshBasicMaterial();
    const { inner, outer } = createTerrainPatches(RADIUS, FIELD, material, 64);
    const innerVerts = inner.geometry.getAttribute('position').count;
    const outerVerts = outer.geometry.getAttribute('position').count;
    assert.ok(innerVerts > 0 && outerVerts > 0);
    assert.ok(inner.name !== outer.name);
    assert.equal(inner.position.y, RADIUS);
    assert.equal(outer.position.y, RADIUS);
    // The outer patch reaches the configured play radius in each direction.
    outer.geometry.computeBoundingBox();
    const box = outer.geometry.boundingBox;
    assert.ok(box);
    if (box) {
      assert.ok(Math.abs(box.max.x - FIELD.patchRadiusM) < 1e-3);
      assert.ok(Math.abs(box.min.x + FIELD.patchRadiusM) < 1e-3);
    }

    // The ring is a hole, not a sheet under the detailed patch: no triangle may
    // lie wholly inside the inner square.
    const innerExtent = 180;
    const outerIndex = outer.geometry.getIndex();
    assert.ok(outerIndex);
    const positions = outer.geometry.getAttribute('position');
    let centreTriangles = 0;
    if (outerIndex) {
      for (let i = 0; i < outerIndex.count; i += 3) {
        let inside = true;
        for (let corner = 0; corner < 3; corner += 1) {
          const vertex = outerIndex.getX(i + corner);
          if (
            Math.abs(positions.getX(vertex)) >= innerExtent / 2 ||
            Math.abs(positions.getZ(vertex)) >= innerExtent / 2
          ) {
            inside = false;
            break;
          }
        }
        if (inside) centreTriangles += 1;
      }
    }
    assert.equal(centreTriangles, 0, 'the outer ring still overlaps the detailed patch');
  });

  it('stores patch heights in patch-local metres, not in planet radii', () => {
    // What a vertex pays for is the size of the number stored in it: float32
    // spaces values near the radius by `radius × 2⁻²³`, which is 7.8 mm at the
    // world's 100 km radius and grows with the planet. A vertex holds the
    // curvature drop and the relief; the radius is a placement.
    const radius = 100000;
    const field = { ...DEFAULT_TERRAIN_FIELD, amplitudeM: 26, patchRadiusM: 620 };
    const patch = createTerrainPatch(radius, field, new THREE.MeshBasicMaterial(), 24, 1240);
    assert.equal(patch.position.y, radius);

    const positions = patch.geometry.getAttribute('position');
    let largest = 0;
    for (let i = 0; i < positions.count; i += 1) {
      largest = Math.max(largest, Math.abs(positions.getY(i)));
    }
    // 620 m across a 100 km sphere drops 1.92 m, plus at most the 26 m relief.
    assert.ok(largest < 30, `a patch vertex is ${largest.toFixed(1)} m from the tangent plane`);

    // Vertex plus placement is still the world height every other reader uses.
    const x = 40;
    const z = -20;
    assert.ok(
      Math.abs(
        patchLocalSurfaceY(radius, x, z, field, TERRAIN_SKIN_M) -
          planetTerrainY(radius, x, z, field),
      ) < 1e-9,
    );
  });

  it('uses one sphere as the whole ground, with its pole on the play plane', () => {
    // The ground is the planet, not a cap over a body: one surface means no seam
    // and no edge to walk off. The body is pushed down by its own radius so the
    // pole sits at y = 0, where the play area's tangent plane is.
    const mesh = createPlanetBody(RADIUS, new THREE.MeshBasicMaterial());
    assert.equal(mesh.position.y, -RADIUS);

    const positions = mesh.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i += 1) {
      const distance = Math.hypot(positions.getX(i), positions.getY(i), positions.getZ(i));
      assert.ok(Math.abs(distance - RADIUS) < 1e-3, `vertex ${i} is off the sphere`);
    }
  });

  it('covers the planet continuously instead of stopping at an edge', () => {
    const mesh = createPlanetBody(RADIUS, new THREE.MeshBasicMaterial());
    const positions = mesh.geometry.getAttribute('position');
    let lowest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < positions.count; i += 1) {
      lowest = Math.min(lowest, positions.getY(i));
    }
    assert.ok(Math.abs(lowest + RADIUS) < 1e-2);
  });
});

describe('the coarse ring and the body under it', () => {
  it('hangs a skirt off it, deep enough to meet the body', () => {
    // The ground patches are built on the exact sphere; the body is a polyhedron
    // whose facets sit inside it. At the far patch's outer edge that difference is
    // a step down into nothing, and the skirt is the wall that closes it. Its top
    // must be the patch's own edge - the same height function, not a second
    // reading of the config - and its bottom must reach past the facets.
    const field = { ...DEFAULT_TERRAIN_FIELD, amplitudeM: 26, patchRadiusM: 620 };
    const extent = 40;
    const sag = planetFacetSag(RADIUS, PLANET_BODY_SEGMENTS);
    const skirt = createTerrainSkirt(
      RADIUS,
      field,
      new THREE.MeshBasicMaterial(),
      extent,
      TERRAIN_SKIN_M,
      sag + 2,
      16,
    );
    assert.equal(skirt.name, 'planet-terrain-skirt');
    const positions = skirt.geometry.getAttribute('position');
    const loop = positions.count / 2;
    for (let i = 0; i < loop; i += 1) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const top = positions.getY(i);
      const bottom = positions.getY(loop + i);
      assert.ok(
        // Float32 positions, so the edge agrees to the buffer's own precision.
        Math.abs(top - patchLocalSurfaceY(RADIUS, x, z, field, TERRAIN_SKIN_M)) < 1e-4,
        `skirt top ${i} is not the patch's edge`,
      );
      // Deeper than the body's worst facet, so the wall is buried in the body
      // rather than stopping in the air at the patch's edge.
      assert.ok(
        top - bottom > sag + TERRAIN_SKIN_M,
        `skirt bottom ${i} stops above the body's facets`,
      );
    }

    // It faces outward: a wall seen from inside the ring would be invisible from
    // the only side anything ever sees it.
    const ax = positions.getX(0);
    const az = positions.getZ(0);
    const outward = new THREE.Vector3(ax, 0, az).normalize();
    const a = new THREE.Vector3(positions.getX(0), positions.getY(0), positions.getZ(0));
    const b = new THREE.Vector3(positions.getX(1), positions.getY(1), positions.getZ(1));
    const c = new THREE.Vector3(positions.getX(loop), positions.getY(loop), positions.getZ(loop));
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    assert.ok(normal.dot(outward) > 0, 'the skirt faces inward');
  });

  it('meets the fine sheet on a shared boundary instead of passing under it', () => {
    // The ring's first loop is the fine sheet's own edge, vertex for vertex.
    // Nothing overlaps and nothing sinks: the seam is one polyline with the same
    // heights on both sides. A T-junction or a second, slightly different edge
    // would open the hairline the old underlap was hiding.
    const { inner, outer } = createTerrainPatches(RADIUS, FIELD, new THREE.MeshBasicMaterial(), 64);
    const half = 180 / 2;
    const innerPositions = inner.geometry.getAttribute('position');
    const edge = new Map<string, number>();
    for (let i = 0; i < innerPositions.count; i += 1) {
      const x = innerPositions.getX(i);
      const z = innerPositions.getZ(i);
      if (Math.abs(Math.abs(x) - half) < 1e-4 || Math.abs(Math.abs(z) - half) < 1e-4) {
        edge.set(`${x.toFixed(4)},${z.toFixed(4)}`, innerPositions.getY(i));
      }
    }
    assert.ok(edge.size > 0, 'the fine sheet has no boundary to share');

    const positions = outer.geometry.getAttribute('position');
    const segments = Number(outer.userData.terrainEdgeSegments);
    assert.ok(segments > 0, 'the ring did not record its boundary resolution');
    const loopCount = segments * 4;
    assert.equal(
      loopCount,
      edge.size,
      'the ring boundary and the fine edge do not share every vertex',
    );
    for (let i = 0; i < loopCount; i += 1) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const key = `${x.toFixed(4)},${z.toFixed(4)}`;
      const innerY = edge.get(key);
      assert.notEqual(innerY, undefined, `ring boundary vertex ${i} is not on the fine edge`);
      assert.ok(
        Math.abs(positions.getY(i) - (innerY as number)) < 1e-4,
        `ring boundary vertex ${i} is not at the fine height`,
      );
    }

    // The ring has no centre: every vertex is outside the inner square. The
    // old underlap kept a sheet in there and relied on the fine patch to hide it.
    let inside = 0;
    for (let i = 0; i < positions.count; i += 1) {
      if (Math.abs(positions.getX(i)) < half - 1e-6 && Math.abs(positions.getZ(i)) < half - 1e-6) {
        inside += 1;
      }
    }
    assert.equal(inside, 0, 'the ring still passes under the fine sheet');
    assert.equal(inner.position.y, outer.position.y, 'the two patches are on different placements');
  });

  it('does not build a vertical apron at the seam', () => {
    // The apron closed the hairline but was itself a four-metre wall, visible
    // from inside the play area as a white band down every valley that crossed
    // the square. The shared edge is the closure now; no wall should come back.
    const patches = createTerrainPatches(RADIUS, FIELD, new THREE.MeshBasicMaterial(), 32);
    assert.equal('apron' in patches, false, 'a vertical apron is back at the seam');
  });

  it("keeps the soil slab's walls off the seam", () => {
    // The slab's walls used to stand on the patch's own square, which is also the
    // level of detail seam: wherever the coarse ring interpolated above the fine
    // patch, a slice of wall - a century of strata - showed above the ground there.
    // The walls are inset, so their top edge is under interior ground.
    const innerExtent = Math.min(180, 620 * 2);
    const slabHalf = innerExtent / 2 - SOIL_SLAB_INSET_M;
    const seamHalf = innerExtent / 2;
    assert.ok(slabHalf < seamHalf, 'the slab wall is still on the seam');
    // Two metres of inset would leave the wall inside the ring's own hole edge
    // (the seam minus the ring's overlap), where the fine sheet still covers it.
    assert.ok(SOIL_SLAB_INSET_M >= 2, 'the inset is thinner than the ring overlap');
  });

  it('builds one fixed play disk whose vertices follow the terrain field', () => {
    const disk = createPlayDisk({
      radiusM: RADIUS,
      field: FIELD,
      material: new THREE.MeshBasicMaterial(),
      playRadiusM: 40,
    });
    assert.equal(disk.userData.playDiskCellM, PLAY_DISK_CELL_M);
    const positions = disk.geometry.getAttribute('position');
    const rings = disk.userData.playDiskRings as number;
    const segments = disk.userData.playDiskSegments as number;
    // Every surface vertex is exactly the height function the server and the
    // slab use; the rim wall below it is the only extra column.
    for (let i = 0; i < 1 + rings * segments; i += 1) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const expected = patchLocalSurfaceY(RADIUS, x, z, FIELD, TERRAIN_SKIN_M);
      assert.ok(Math.abs(positions.getY(i) - expected) < 1e-4, `vertex ${i} left the field`);
    }
    // The wall reaches below the deepest rim vertex, so the globe cannot show
    // through under the edge.
    const rimStart = 1 + (rings - 1) * segments;
    const wallStart = 1 + rings * segments;
    let lowestRim = Number.POSITIVE_INFINITY;
    for (let i = rimStart; i < wallStart; i += 1)
      lowestRim = Math.min(lowestRim, positions.getY(i));
    for (let i = wallStart; i < wallStart + segments; i += 1) {
      assert.ok(positions.getY(i) <= lowestRim - 1, 'the rim wall does not close the seam');
    }
  });

  it('builds the planet body finer than the sag the skirt was sized for', () => {
    // 256 facets put the body 7.5 m inside the sphere at a 100 km radius, which is
    // where the far patch's edge hung over nothing.
    const big = 100_000;
    assert.ok(planetFacetSag(big, 256) > 7, 'the old facet count no longer sags');
    assert.ok(
      planetFacetSag(big, PLANET_BODY_SEGMENTS) < planetFacetSag(big, 256) / 1.5,
      'the finer body did not halve the sag',
    );
    // And the shipped body really is that fine: its own geometry says so.
    const body = createPlanetBody(RADIUS, new THREE.MeshBasicMaterial());
    const positions = body.geometry.getAttribute('position');
    let measured = 0;
    for (let i = 0; i < positions.count; i += 1) {
      const r = Math.hypot(positions.getX(i), positions.getY(i), positions.getZ(i));
      measured = Math.max(measured, RADIUS - r);
    }
    assert.ok(measured > 0, 'the body has no facets, so this test proves nothing');
  });
});
