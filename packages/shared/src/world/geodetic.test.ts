import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  directionToGeodetic,
  formatGeodetic,
  geodeticDistanceM,
  geodeticToDirection,
  geodeticToLocal,
  localToGeodetic,
  parseGeodeticPair,
  parseLatitude,
  parseLongitude,
  wrapLongitude,
} from './geodetic.ts';

const RADIUS = 100_000;

describe('geodetic coordinates', () => {
  it('puts the north pole at +90 and the antimeridian at 180', () => {
    const pole = directionToGeodetic(geodeticToDirection(90, 123));
    assert.ok(Math.abs(pole.latitudeDeg - 90) < 1e-9);
    assert.equal(pole.longitudeDeg, 0);
    assert.equal(wrapLongitude(180), 180);
    assert.equal(wrapLongitude(-180), -180);
    assert.equal(wrapLongitude(181), -179);
  });

  it('round-trips a play-area point to under a millimetre', () => {
    const local = geodeticToLocal(
      { latitudeDeg: 89.64, longitudeDeg: 45.2, altitudeM: 14 },
      RADIUS,
    );
    const back = localToGeodetic(local, RADIUS);
    const again = geodeticToLocal(back, RADIUS);
    assert.ok(Math.hypot(again.x - local.x, again.z - local.z) < 0.001);
    assert.ok(Math.abs(again.y - local.y) < 0.001);
  });

  it('measures a known great-circle separation', () => {
    const distance = geodeticDistanceM(
      { latitudeDeg: 0, longitudeDeg: 0 },
      { latitudeDeg: 0, longitudeDeg: 1 },
      RADIUS,
    );
    assert.ok(Math.abs(distance - (Math.PI / 180) * RADIUS) < 1e-6);
  });

  it('formats hemispheres, not signs', () => {
    assert.equal(
      formatGeodetic({ latitudeDeg: -12.3456, longitudeDeg: 45.6789, altitudeM: 14 }),
      '12.3456° S, 45.6789° E · 14 m',
    );
  });

  it('parses decimal and DMS input and rejects impossible minutes', () => {
    assert.equal(parseLatitude('12.5 N'), 12.5);
    assert.equal(parseLatitude('12° 30\' 0" S'), -12.5);
    assert.equal(parseLongitude('45.25 W'), -45.25);
    assert.equal(parseLatitude("12° 75' N"), null);
    assert.equal(parseLongitude('181'), null);
    assert.deepEqual(parseGeodeticPair('12.5 N, 45.25 W'), {
      latitudeDeg: 12.5,
      longitudeDeg: -45.25,
    });
  });
});
