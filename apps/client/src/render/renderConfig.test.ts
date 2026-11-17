import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * A quality lever that cannot move is worse than no lever: the band controller
 * would report a decision the renderer silently ignores. These are the shipped
 * defaults, so a config edit that collapses the range fails here instead of in
 * a browser.
 */
const raw = readFileSync(new URL('../../../../config/render.json', import.meta.url), 'utf8');
const config = JSON.parse(raw) as {
  values: Record<string, { value: unknown }>;
};

const numberValue = (key: string): number => {
  const entry = config.values[key];
  assert.ok(entry, `render.json is missing ${key}`);
  const value = Number(entry.value);
  assert.ok(Number.isFinite(value), `${key} is not a number`);
  return value;
};

test('the resolution lever has room below and above the tier base', () => {
  const floor = numberValue('resolution_floor');
  const ceiling = numberValue('max_pixel_ratio');
  assert.ok(floor < 1, `resolution_floor ${floor} leaves no room to degrade`);
  assert.ok(ceiling > 1, `max_pixel_ratio ${ceiling} leaves no room to recover`);
  assert.ok(floor < ceiling, 'the pixel-ratio range is inverted');
});

test('the quality band is ordered and non-zero', () => {
  const min = numberValue('gpu_band_min_ms');
  const max = numberValue('gpu_band_max_ms');
  assert.ok(min > 0, 'gpu_band_min_ms must be positive');
  assert.ok(min < max, 'gpu_band_min_ms must be below gpu_band_max_ms');
  assert.ok(numberValue('quality_hold_ms') > 0, 'quality_hold_ms must be positive');
  // Load-time costs must not spend detail, and one hitch must not either.
  assert.ok(numberValue('quality_warmup_ms') > 0, 'quality_warmup_ms must skip load costs');
  const smoothing = numberValue('quality_smoothing');
  assert.ok(smoothing > 0 && smoothing < 1, 'quality_smoothing must be an EMA weight');
  const drawFloor = numberValue('draw_distance_floor');
  assert.ok(drawFloor > 0 && drawFloor <= 1, 'draw_distance_floor must be 0..1');
});

test('every size class can be resolved', () => {
  const sizeClasses = config.values.size_classes?.value;
  assert.ok(Array.isArray(sizeClasses) && sizeClasses.length > 0, 'size_classes is empty');
  const ids = new Set<string>();
  for (const entry of sizeClasses as Array<Record<string, unknown>>) {
    const id = String(entry.id);
    assert.ok(id.length > 0, 'a size class has no id');
    ids.add(id);
    const multiplier = Number(entry.camera_max_distance_multiplier);
    assert.ok(multiplier >= 1, `${id} cannot frame further than the base class`);
  }
  assert.ok(ids.has('giant'), 'the giant size class is required for large organisms');
});
