import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import {
  attachFractionFromScreenPress,
  attachFractionRequest,
  buildTaperedTubeGeometry,
  clampAnchorToNode,
  groundMarkerHeight,
  growthAimMouthRadius,
  growthStartNormal,
  jointAnchorAllowanceM,
  ringFrameFor,
  ringMouthRadiusM,
  taperedTubeRadius,
  wrapRingOnHost,
} from './growthGizmoGeometry.ts';

describe('the attach fraction a press on the part means', () => {
  // A 200 px part drawn straight up the screen.
  const startScreen = { x: 100, y: 500 };
  const endScreen = { x: 100, y: 300 };
  const pressAt = (x: number, y: number) =>
    attachFractionFromScreenPress({ startScreen, endScreen, pressScreen: { x, y }, base: 0.6 });

  it('follows the press along the whole part', () => {
    assert.equal(pressAt(100, 500), 0.05);
    assert.equal(pressAt(100, 420), 0.4);
    assert.equal(pressAt(100, 300), 1);
  });

  it('ignores how far off the part the press lands', () => {
    assert.equal(pressAt(160, 420), 0.4);
  });

  it('clamps a press past either end', () => {
    assert.equal(pressAt(100, 900), 0.05);
    assert.equal(pressAt(100, 0), 1);
  });

  it('gives the configured fraction back for a part seen end-on', () => {
    assert.equal(
      attachFractionFromScreenPress({
        startScreen,
        endScreen: startScreen,
        pressScreen: { x: 120, y: 520 },
        base: 0.6,
      }),
      0.6,
    );
  });
});

describe('a joint the part does not allow', () => {
  const startScreen = { x: 100, y: 500 };
  const endScreen = { x: 100, y: 300 };
  const press = (y: number) =>
    attachFractionRequest({ startScreen, endScreen, pressScreen: { x: 100, y }, base: 0.6 });

  it('reports the press as held when the gene moved it', () => {
    const past = press(900);
    assert.equal(past.fraction, 0.05);
    assert.equal(past.held, true);
    assert.equal(press(0).held, true);
  });

  it('does not call an allowed press held', () => {
    assert.equal(press(420).held, false);
  });
});

describe('the ring may stand anywhere along its part', () => {
  it('reaches the base of an 0.85 m part whose thickness is 2 cm', () => {
    const segment = new THREE.Vector3(0, 0, 0);
    const end = new THREE.Vector3(0, -0.85, 0);
    const ring = segment.clone().lerp(end, 0.2);
    const clamped = clampAnchorToNode(ring, end, jointAnchorAllowanceM(0.85, 0.02));
    assert.deepEqual(clamped.toArray(), ring.toArray());
    // The old allowance (thickness only) dragged it back to the tip.
    assert.notDeepEqual(clampAnchorToNode(ring, end, 0.1).toArray(), ring.toArray());
  });
});

describe('growth aim arrow geometry', () => {
  it('tapers from the mouth to the tip', () => {
    const base = taperedTubeRadius(0, 0.01, 0.45);
    const middle = taperedTubeRadius(0.5, 0.01, 0.45);
    const tip = taperedTubeRadius(1, 0.01, 0.45);
    assert.equal(base, 0.01);
    assert.ok(middle < base && middle > tip, `not monotone: ${base} ${middle} ${tip}`);
    assert.ok(Math.abs(tip - 0.0045) < 1e-9);
  });

  it('never collapses to a zero-width hairline', () => {
    assert.ok(taperedTubeRadius(1, 0.01, 0) > 0);
    assert.ok(taperedTubeRadius(2, 0.01, 0.45) > 0);
    assert.ok(taperedTubeRadius(-1, 0.01, 0.45) > 0);
  });

  it('builds a closed tube with a ring per point', () => {
    const points = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0.4, 0),
      new THREE.Vector3(0.1, 0.8, 0),
    ];
    const geometry = buildTaperedTubeGeometry(points, 0.02, 0.4, 6);
    const position = geometry.getAttribute('position');
    assert.equal(position.count, points.length * 6);
    assert.equal(geometry.getIndex()?.count, (points.length - 1) * 6 * 6);
    geometry.dispose();
  });

  it('puts the wide end at the start of the path', () => {
    const points = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 2, 0),
    ];
    const geometry = buildTaperedTubeGeometry(points, 0.02, 0.4, 8);
    const position = geometry.getAttribute('position');
    const ringRadiusAt = (ring: number): number => {
      let sum = 0;
      for (let i = 0; i < 8; i += 1) {
        const index = ring * 8 + i;
        sum += Math.hypot(position.getX(index), position.getZ(index));
      }
      return sum / 8;
    };
    const first = ringRadiusAt(0);
    const last = ringRadiusAt(2);
    assert.ok(first > last, `start radius ${first} should exceed tip radius ${last}`);
    geometry.dispose();
  });
});

describe('growth aim ground marker', () => {
  it('stands on the terrain under the tip', () => {
    assert.equal(
      groundMarkerHeight(() => 3.5, 10, -2),
      3.5,
    );
  });

  it('falls back to the soil line rather than to NaN', () => {
    assert.equal(
      groundMarkerHeight(() => Number.NaN, 0, 0),
      0,
    );
  });
});

describe('growth aim ring frame', () => {
  const up = new THREE.Vector3(0, 1, 0);

  it('lies across the stem it leaves, not across the aim', () => {
    // A branch leaving a vertical stem at 45 degrees: the ring is the stem's
    // cross-section, so its plane is horizontal and the arrow leaves through it.
    const aim = new THREE.Vector3(0.7, 0.7, 0).normalize();
    const frame = ringFrameFor({
      attach: new THREE.Vector3(0, 1, 0),
      parentTangent: new THREE.Vector3(0, 1, 0),
      aim,
      surfaceUp: up,
      partRadiusM: 0.05,
    });
    assert.ok(frame.normal.distanceTo(up) < 1e-6, 'the ring turned to face the aim');
    assert.deepEqual(frame.center.toArray(), [0, 1, 0]);
  });

  it('sits on a seed coat at the point the part leaves, facing the aim', () => {
    const aim = new THREE.Vector3(0, -1, 0);
    const frame = ringFrameFor({
      attach: new THREE.Vector3(0, 0.4, 0),
      parentTangent: null,
      aim,
      surfaceUp: up,
      partRadiusM: 0.1,
    });
    assert.ok(Math.abs(frame.center.y - 0.3) < 1e-9, 'the mouth is not on the coat');
    assert.ok(frame.normal.distanceTo(aim) < 1e-6);
  });

  it('uses planet up when a part has no aim or parent axis', () => {
    const frame = ringFrameFor({
      attach: new THREE.Vector3(0, 0, 0),
      parentTangent: null,
      aim: new THREE.Vector3(),
      surfaceUp: new THREE.Vector3(0.6, 0.8, 0),
      partRadiusM: 0.2,
    });
    assert.ok(frame.normal.y > 0.79 && frame.normal.x > 0.59);
  });
  it('stays a unit normal for a degenerate parent tangent', () => {
    const frame = ringFrameFor({
      attach: new THREE.Vector3(1, 1, 1),
      parentTangent: new THREE.Vector3(0, 0, 0),
      aim: up,
      surfaceUp: up,
      partRadiusM: 0.1,
    });
    assert.ok(Math.abs(frame.normal.length() - 1) < 1e-9);
  });
});

describe('the aim ring lies on its part', () => {
  // A vertical stem, 1 m long, 2.6 cm thick - the profile's own stem radius.
  const start = new THREE.Vector3(0, 1, 0);
  const end = new THREE.Vector3(0, 2, 0);
  const host = { start, end, radius: 0.026 };
  const lift = 0.002;
  /** Distance from the part's own axis, so "on the surface" can be measured. */
  const fromAxis = (p: THREE.Vector3) => Math.hypot(p.x - start.x, p.z - start.z);
  const wrap = (ringRadius: number, outward = new THREE.Vector3(1, 0, 0)) =>
    wrapRingOnHost({ host, point: new THREE.Vector3(0, 1.4, 0), outward, ringRadius, lift });

  it('puts every point of the loop on the stem, not on a flat hoop round it', () => {
    // A 5 cm hoof round a 2.6 cm stem used to stand off it by up to 2.4 cm.
    const ring = wrap(0.05);
    for (const p of ring.points) {
      assert.ok(
        Math.abs(fromAxis(p) - (0.026 + lift)) < 1e-6,
        `point left the surface: ${fromAxis(p).toFixed(4)} m from the axis`,
      );
    }
    assert.ok(Math.abs(ring.centre.y - 1.4) < 1e-6);
    assert.ok(ring.normal.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-6);
  });

  it('bends round the part as the ring widens', () => {
    // The wider the mouth, the further the loop wraps round the stem: the loop's
    // width across the part grows, its reach along it stays the ring's own size.
    const narrow = wrap(0.01);
    const wide = wrap(0.026);
    const across = (ring: { points: THREE.Vector3[] }) =>
      Math.max(...ring.points.map((p) => Math.atan2(p.z, p.x))) -
      Math.min(...ring.points.map((p) => Math.atan2(p.z, p.x)));
    assert.ok(across(wide) > across(narrow) * 2, 'the wide mouth did not wrap further');
    const reach = (ring: { points: THREE.Vector3[] }) =>
      Math.max(...ring.points.map((p) => p.y)) - Math.min(...ring.points.map((p) => p.y));
    assert.ok(reach(wide) >= reach(narrow) * 0.9);
  });

  it('follows the side of the part the press picked', () => {
    const ring = wrap(0.02, new THREE.Vector3(-1, 0, 0));
    assert.ok(ring.centre.x < -0.02, 'the ring ignored the pressed side');
    assert.ok(ring.normal.x < -0.9);
  });

  it('keeps the loop on a seed coat, which is curved in every direction', () => {
    const coat = { start: null, end: new THREE.Vector3(0, 0.3, 0), radius: 0.075 };
    const ring = wrapRingOnHost({
      host: coat,
      point: coat.end,
      outward: new THREE.Vector3(0, -1, 0),
      ringRadius: 0.05,
      lift,
    });
    for (const p of ring.points) {
      const r = p.distanceTo(coat.end);
      assert.ok(Math.abs(r - (0.075 + lift)) < 1e-6, `off the coat: ${r.toFixed(4)} m`);
    }
    assert.ok(ring.centre.y < 0.3, 'the ring did not sit on the side it was aimed at');
  });

  it('never collapses a loop to nothing on a tiny part', () => {
    const thin = { start, end, radius: 0.005 };
    const ring = wrapRingOnHost({
      host: thin,
      point: new THREE.Vector3(0, 1.5, 0),
      outward: new THREE.Vector3(1, 0, 0),
      ringRadius: 0.004,
    });
    const distinct = new Set(
      ring.points.map((p) =>
        p
          .toArray()
          .map((v) => v.toFixed(6))
          .join(','),
      ),
    );
    assert.equal(distinct.size, ring.points.length);
  });
});

describe('the mouth is the size of the part that will leave', () => {
  it('follows the emerging organ, not the part it leaves', () => {
    // A spore sac (1 cm) on a trunk (4.5 cm): the mouth is the sac's own size.
    const mouth = ringMouthRadiusM({
      emergingRadiusM: 0.01,
      parentRadiusM: 0.045,
      scale: 1.6,
      minM: 0.008,
    });
    assert.ok(Math.abs(mouth - 0.016) < 1e-9);
  });

  it('never draws a mouth wider than the part it leaves', () => {
    assert.equal(
      ringMouthRadiusM({ emergingRadiusM: 0.06, parentRadiusM: 0.02, scale: 1.6, minM: 0.008 }),
      0.02,
    );
  });

  it('keeps a floor so a hair root still shows a ring', () => {
    assert.equal(
      ringMouthRadiusM({ emergingRadiusM: 0.001, parentRadiusM: 0.002, scale: 1.6, minM: 0.008 }),
      0.008,
    );
  });

  it('grows with the part about to leave, not with the part it leaves', () => {
    // One host, three organs: a trunk's base is widest, a stem's narrower, a
    // spore sac's narrowest. The host is the same for all three, so the order can
    // only come from the organ that is about to grow.
    const mouth = (emergingType: string) =>
      growthAimMouthRadius({ emergingType, parentRadiusM: 0.08, scale: 1.6, minM: 0.008 });
    assert.ok(mouth('trunk') > mouth('stem'), `trunk ${mouth('trunk')} vs stem ${mouth('stem')}`);
    assert.ok(
      mouth('stem') > mouth('spore_sac'),
      `stem ${mouth('stem')} vs sac ${mouth('spore_sac')}`,
    );
  });

  it('takes the joint the new part will actually be drawn with', () => {
    // A flower is a soft organ: its base is its own 1 cm, so the mouth is 1.6 cm
    // even on a 4.5 cm trunk, rather than the trunk's 4.5 cm.
    const mouth = growthAimMouthRadius({
      emergingType: 'flower',
      parentRadiusM: 0.045,
      scale: 1.6,
      minM: 0.008,
    });
    assert.ok(Math.abs(mouth - 0.016) < 1e-9, `flower mouth ${mouth}`);
  });

  it('never opens wider than the part it is stuck to', () => {
    for (const emergingType of ['trunk', 'stem', 'lateral_root', 'flower']) {
      const mouth = growthAimMouthRadius({
        emergingType,
        parentRadiusM: 0.012,
        scale: 1.6,
        minM: 0.008,
      });
      assert.ok(mouth <= 0.012 + 1e-9, `${emergingType} opened to ${mouth} on a 1.2 cm part`);
    }
  });
});

describe('where the aim leaves a part', () => {
  const up = new THREE.Vector3(0, 1, 0);

  it('measures "at the surface" from the part\'s own ground, not world zero', () => {
    // G6: a node 12 m up a hill, 5 cm above the soil under it, is standing on the
    // ground. The old absolute-Y test called it off-surface and aimed it along the
    // part it grew from instead of away from the soil.
    const normal = growthStartNormal({
      node: { x: 4, y: 12.05, z: -3 },
      parent: { x: 4, y: 11.4, z: -3 },
      isSeed: false,
      groundY: 12,
      surfaceUp: up,
      toleranceM: 0.18,
    });
    assert.ok(normal.distanceTo(up) < 1e-9, 'the aim left along the parent, not off the soil');
  });

  it('aims away from planet up on a hillside, not along world Y', () => {
    const slopeUp = new THREE.Vector3(-0.6, 0.8, 0).normalize();
    const normal = growthStartNormal({
      node: { x: -6, y: 9, z: 2 },
      parent: null,
      isSeed: true,
      groundY: 8.9,
      surfaceUp: slopeUp,
      toleranceM: 0.18,
    });
    assert.ok(normal.distanceTo(slopeUp) < 1e-9, 'world up was used on a slope');
  });

  it('follows the parent link for a part that stands clear of the soil', () => {
    // The link leans, so "along the link" cannot be mistaken for "up".
    const normal = growthStartNormal({
      node: { x: 0.5, y: 5, z: 0 },
      parent: { x: 0, y: 4.5, z: 0 },
      isSeed: false,
      groundY: 1,
      surfaceUp: up,
      toleranceM: 0.18,
    });
    assert.ok(normal.x > 0.7 && normal.y > 0.7, `not the link: ${normal.toArray()}`);
    assert.ok(Math.abs(normal.length() - 1) < 1e-9);
  });

  it('falls back to the surface when the link has no direction', () => {
    const slopeUp = new THREE.Vector3(0.6, 0.8, 0).normalize();
    const normal = growthStartNormal({
      node: { x: 2, y: 3, z: 2 },
      parent: { x: 2, y: 3, z: 2 },
      isSeed: false,
      groundY: 0,
      surfaceUp: slopeUp,
      toleranceM: 0.18,
    });
    assert.ok(normal.distanceTo(slopeUp) < 1e-9);
  });

  it('uses world up when the caller has no surface normal to give', () => {
    const normal = growthStartNormal({
      node: { x: 0, y: 0, z: 0 },
      parent: null,
      isSeed: false,
      groundY: 0,
      surfaceUp: new THREE.Vector3(),
      toleranceM: 0.18,
    });
    assert.deepEqual(normal.toArray(), [0, 1, 0]);
  });
});

describe('growth aim anchor', () => {
  const centre = new THREE.Vector3(1, 2, 3);

  it('leaves an anchor on its own part alone', () => {
    const anchor = new THREE.Vector3(1.4, 2.3, 3);
    assert.deepEqual(clampAnchorToNode(anchor, centre, 1.6).toArray(), anchor.toArray());
  });

  it('pulls an anchor from another stem back onto the selected part', () => {
    const elsewhere = new THREE.Vector3(9, 2, 3);
    const clamped = clampAnchorToNode(elsewhere, centre, 1.6);
    assert.ok(clamped.distanceTo(centre) < 1.6001);
    // Pulled along the same bearing, so the ring keeps the side the server meant.
    assert.ok(clamped.x > centre.x);
    assert.ok(Math.abs(clamped.y - centre.y) < 1e-6);
  });

  it('never clamps to a zero radius', () => {
    const elsewhere = new THREE.Vector3(5, 2, 3);
    assert.ok(clampAnchorToNode(elsewhere, centre, 0).distanceTo(centre) > 0.04);
  });
});
