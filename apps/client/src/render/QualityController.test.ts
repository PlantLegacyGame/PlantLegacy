import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createQualityState,
  effectivePixelRatio,
  nextQualityState,
  type QualityConfig,
} from './QualityController.ts';

const CONFIG: QualityConfig = {
  targetFps: 60,
  fpsWarningThreshold: 0.85,
  resolutionFloor: 0.5,
  emergencyResolutionFloor: 0.4,
  qualityEmergencyAfterMs: 4000,
  maxPixelRatio: 1.5,
  // The shipped behaviour: no warm-up and no smoothing, so the existing tests
  // exercise the levers themselves.
  warmupMs: 0,
  smoothing: 1,
  qualityTiers: [
    { name: 'low', pixelRatio: 1, shadowMapSize: 1024, maxTriangles: 50000, antialiasing: false },
    {
      name: 'medium',
      pixelRatio: 1.25,
      shadowMapSize: 2048,
      maxTriangles: 200000,
      antialiasing: true,
    },
    {
      name: 'high',
      pixelRatio: 1.5,
      shadowMapSize: 2048,
      maxTriangles: 500000,
      antialiasing: true,
    },
  ],
  gpuBandMinMs: 10,
  gpuBandMaxMs: 13.6,
  holdMs: 600,
  drawDistanceFloor: 0.5,
};

/** Arm the over-budget window, then decide one hold later: that is one spend. */
function spendSustained(
  state: ReturnType<typeof createQualityState>,
  sample: Parameters<typeof nextQualityState>[1],
  config: QualityConfig,
  now: number,
): void {
  nextQualityState(state, sample, config, now);
  nextQualityState(state, sample, config, now + config.holdMs);
}

test('a sustained over-band cost spends resolution first', () => {
  const state = createQualityState(CONFIG);
  spendSustained(state, { frameMs: 20, gpuMs: 20, triangles: 1000 }, CONFIG, 1000);
  assert.equal(state.pixelScale, 0.9);
  assert.equal(state.drawDistanceScale, 1);
  assert.equal(state.tier, 0);
  assert.equal(state.gpuMeasured, true);
});

test('resolution bottoms out before draw distance is spent', () => {
  const state = createQualityState(CONFIG);
  state.pixelScale = 0.5;
  spendSustained(state, { frameMs: 20, gpuMs: 20, triangles: 1000 }, CONFIG, 1000);
  assert.equal(state.pixelScale, 0.5);
  assert.equal(state.drawDistanceScale, 0.9);
});

test('draw distance bottoms out before the tier drops', () => {
  const state = createQualityState(CONFIG);
  state.tier = 2;
  // High tier base 1.5: the resolution floor of 0.5 is a scale of 0.33, so
  // 0.3 is already at/below the floor and the next lever must be draw distance.
  state.pixelScale = 0.3;
  state.drawDistanceScale = 0.5;
  const before = effectivePixelRatio(state, CONFIG);
  spendSustained(state, { frameMs: 20, gpuMs: 20, triangles: 1000 }, CONFIG, 1000);
  assert.equal(state.tier, 1);
  // The drop preserves what was already spent. Resetting pixelScale to 1 made
  // medium (1.25) draw more pixels than high had been drawing at the floor (0.5).
  assert.ok(effectivePixelRatio(state, CONFIG) <= before + 1e-9);
  assert.ok(state.pixelScale <= 0.41, `pixelScale ${state.pixelScale} gives pixels back`);
  assert.equal(state.drawDistanceScale, 0.5);
});

test('the emergency floor is used only after sustained overload', () => {
  const state = createQualityState(CONFIG);
  let now = 1000;
  // Three seconds over budget is not enough: the normal floor still applies.
  for (let i = 0; i < 180; i += 1) {
    nextQualityState(state, { frameMs: 30, gpuMs: 30, triangles: 1000 }, CONFIG, now);
    now += 16.7;
  }
  assert.equal(state.floorRatio, CONFIG.resolutionFloor);

  // Crossing the emergency window unlocks the lower floor.
  for (let i = 0; i < 120; i += 1) {
    nextQualityState(state, { frameMs: 30, gpuMs: 30, triangles: 1000 }, CONFIG, now);
    now += 16.7;
  }
  assert.equal(state.floorRatio, CONFIG.emergencyResolutionFloor);
  assert.ok(effectivePixelRatio(state, CONFIG) <= CONFIG.emergencyResolutionFloor + 1e-9);
});

test('the emergency floor is given back only after sustained headroom', () => {
  const state = createQualityState(CONFIG);
  state.floorRatio = CONFIG.emergencyResolutionFloor;
  state.tier = 0;
  state.pixelScale = CONFIG.emergencyResolutionFloor;
  state.lastChangeMs = 0;
  let now = 1000;

  // Mid-band frames are not headroom: the emergency floor stays.
  for (let i = 0; i < 300; i += 1) {
    nextQualityState(state, { frameMs: 12, gpuMs: 12, triangles: 1000 }, CONFIG, now);
    now += 16.7;
  }
  assert.equal(state.floorRatio, CONFIG.emergencyResolutionFloor);

  // A full headroom window restores the normal floor.
  for (let i = 0; i < 300; i += 1) {
    nextQualityState(state, { frameMs: 5, gpuMs: 5, triangles: 1000 }, CONFIG, now);
    now += 16.7;
  }
  assert.equal(state.floorRatio, CONFIG.resolutionFloor);
});

test('recovery waits for the hold window', () => {
  const state = createQualityState(CONFIG);
  state.pixelScale = 0.8;
  state.lastChangeMs = 1000;
  nextQualityState(state, { frameMs: 5, gpuMs: 5, triangles: 1000 }, CONFIG, 1200);
  assert.equal(state.pixelScale, 0.8);
  nextQualityState(state, { frameMs: 5, gpuMs: 5, triangles: 1000 }, CONFIG, 1600);
  assert.ok(state.pixelScale > 0.8);
});

test('headroom restores draw distance before raising the tier', () => {
  const state = createQualityState(CONFIG);
  state.tier = 1;
  state.pixelScale = 1.5;
  state.drawDistanceScale = 0.8;
  state.lastChangeMs = 0;
  nextQualityState(state, { frameMs: 5, gpuMs: 5, triangles: 1000 }, CONFIG, 1000);
  assert.equal(state.tier, 1);
  assert.ok(state.drawDistanceScale > 0.8);
});

test('a mid-band frame changes nothing', () => {
  const state = createQualityState(CONFIG);
  state.pixelScale = 0.9;
  state.drawDistanceScale = 0.9;
  nextQualityState(state, { frameMs: 12, gpuMs: 12, triangles: 1000 }, CONFIG, 1000);
  assert.equal(state.pixelScale, 0.9);
  assert.equal(state.drawDistanceScale, 0.9);
});

test('without GPU timing the CPU frame time drives the band', () => {
  const state = createQualityState(CONFIG);
  spendSustained(state, { frameMs: 30, gpuMs: null, triangles: 1000 }, CONFIG, 1000);
  assert.equal(state.gpuMeasured, false);
  assert.ok(state.pixelScale < 1);
});

test('estimated timing at vsync does not degrade a device hitting target fps', () => {
  const state = createQualityState(CONFIG);
  // 16.7 ms is 60 fps clamped by vsync, not an over-budget frame.
  nextQualityState(state, { frameMs: 16.7, gpuMs: null, triangles: 1000 }, CONFIG, 1000);
  assert.equal(state.pixelScale, 1);
  assert.equal(state.drawDistanceScale, 1);
});

test('estimated timing below the warning fraction of target fps degrades', () => {
  const state = createQualityState(CONFIG);
  // 30 ms is ~33 fps: clearly under the 51 fps warning line.
  spendSustained(state, { frameMs: 30, gpuMs: null, triangles: 1000 }, CONFIG, 1000);
  assert.ok(state.pixelScale < 1);
});

test('estimated timing recovers once the target rate is reached again', () => {
  const state = createQualityState(CONFIG);
  state.pixelScale = 0.7;
  state.lastChangeMs = 0;
  nextQualityState(state, { frameMs: 16.7, gpuMs: null, triangles: 1000 }, CONFIG, 1000);
  assert.ok(state.pixelScale > 0.7);
});

test('the levers are bounded relative to the tier pixel ratio', () => {
  const state = createQualityState(CONFIG);
  // Medium tier base 1.25 on a 1x display: the ceiling scale is 1 / 1.25 = 0.8.
  state.tier = 1;
  state.pixelScale = 0.8;
  state.drawDistanceScale = 0.9;
  state.lastChangeMs = 0;
  nextQualityState(state, { frameMs: 5, gpuMs: 5, triangles: 1000 }, CONFIG, 1000);
  // At the ceiling, further headroom goes to draw distance, not above the
  // display's density.
  assert.equal(state.pixelScale, 0.8);
  assert.ok(state.drawDistanceScale > 0.9);
  assert.equal(state.tier, 1);
});

test('estimated timing never recovers above native on any tier', () => {
  const state = createQualityState(CONFIG);
  // Medium tier base is above native, which is exactly how the ratio used to
  // sawtooth between ~0.94 and 1.25 on a 60 Hz display.
  state.tier = 1;
  state.pixelScale = 0.75;
  state.lastChangeMs = 0;
  nextQualityState(state, { frameMs: 16.7, gpuMs: null, triangles: 1000 }, CONFIG, 1000);
  assert.ok(state.pixelScale <= 1 / CONFIG.qualityTiers[1].pixelRatio + 1e-9);
  assert.ok(effectivePixelRatio(state, CONFIG) <= 1 + 1e-9);
});

test('a measured GPU sample does not supersample above the display', () => {
  const config: QualityConfig = { ...CONFIG, maxPixelRatio: 2, nativePixelRatio: 1.425 };
  const state = createQualityState(config);
  state.tier = 2; // base 1.5, so a full scale would be 1.5 and clamped
  state.pixelScale = 1.5;
  assert.ok(effectivePixelRatio(state, config) <= 1.425 + 1e-9);
});

test('measured recovery stops at the display density, not the configured ceiling', () => {
  const config: QualityConfig = { ...CONFIG, maxPixelRatio: 2, nativePixelRatio: 1.425 };
  const state = createQualityState(config);
  state.tier = 2; // base 1.5: the native ceiling is a scale of 0.95
  state.pixelScale = 0.6;
  state.lastChangeMs = 0;
  let clock = 1000;
  for (let i = 0; i < 60; i++) {
    nextQualityState(state, { frameMs: 5, gpuMs: 5, triangles: 1000 }, config, clock);
    clock += config.holdMs;
  }
  const ratio = effectivePixelRatio(state, config);
  assert.ok(ratio <= 1.425 + 1e-9, `recovered to ${ratio}, past the display`);
  assert.ok(ratio > 1.4, `recovered only to ${ratio}`);
});

test('a display whose own density is 2x may use 2x', () => {
  const config: QualityConfig = { ...CONFIG, maxPixelRatio: 2, nativePixelRatio: 2 };
  const state = createQualityState(config);
  state.tier = 2;
  state.pixelScale = 1.5;
  assert.equal(effectivePixelRatio(state, config), 2);
});

const SMOOTH_CONFIG: QualityConfig = { ...CONFIG, warmupMs: 4000, smoothing: 0.12 };

/** Feed `count` frames of `frameMs`, advancing the clock by `stepMs`. */
function feed(
  state: ReturnType<typeof createQualityState>,
  count: number,
  frameMs: number,
  config: QualityConfig,
  now: number,
  stepMs = 16.7,
): number {
  let clock = now;
  for (let i = 0; i < count; i++) {
    nextQualityState(state, { frameMs, gpuMs: null, triangles: 1000 }, config, clock);
    clock += stepMs;
  }
  return clock;
}

test('load costs during warm-up do not spend detail', () => {
  const state = createQualityState(SMOOTH_CONFIG);
  // 4 s of 120 ms frames: shader builds and uploads, not a steady-state frame.
  const afterWarmup = feed(state, 240, 120, SMOOTH_CONFIG, 1000);
  assert.equal(state.pixelScale, 1);
  assert.equal(state.drawDistanceScale, 1);

  // Once warm-up ends, the same cost is real and is spent.
  feed(state, 120, 120, SMOOTH_CONFIG, afterWarmup);
  assert.ok(state.pixelScale < 1);
});

test('one over-budget frame does not drop resolution', () => {
  const state = createQualityState(SMOOTH_CONFIG);
  let now = feed(state, 400, 16.7, SMOOTH_CONFIG, 1000);

  // A single GC-sized frame, then steady frames again.
  nextQualityState(state, { frameMs: 240, gpuMs: null, triangles: 1000 }, SMOOTH_CONFIG, now);
  now += 16.7;
  feed(state, 40, 16.7, SMOOTH_CONFIG, now);

  assert.equal(state.pixelScale, 1);
  assert.equal(state.drawDistanceScale, 1);
});

test('sustained over-budget frames still spend detail after the hold', () => {
  const state = createQualityState(SMOOTH_CONFIG);
  const now = feed(state, 400, 16.7, SMOOTH_CONFIG, 1000);
  feed(state, 120, 40, SMOOTH_CONFIG, now);
  assert.ok(state.pixelScale < 1);
});

test('estimated timing never promotes a tier on vsync alone', () => {
  const state = createQualityState(CONFIG);
  state.lastChangeMs = 0;
  nextQualityState(state, { frameMs: 16.7, gpuMs: null, triangles: 1000 }, CONFIG, 1000);
  assert.equal(state.tier, 0);
  assert.equal(state.pixelScale, 1);
});

test('a triangle overflow drops the tier without waiting for the hold', () => {
  const state = createQualityState(CONFIG);
  state.tier = 2;
  state.lastChangeMs = 1000;
  nextQualityState(state, { frameMs: 8, gpuMs: 8, triangles: 600000 }, CONFIG, 1010);
  assert.equal(state.tier, 1);
});
