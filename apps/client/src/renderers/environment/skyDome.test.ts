import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as THREE from 'three';
import type { RenderConfig } from '../../config/clientConfig.ts';
import { createSkyDome } from './skyDome.ts';

const CONFIG = {
  terrainRadius: 120,
  skyZenithDay: '#4A7A96',
  skyHorizonDay: '#C8D6D4',
  sunColorDay: '#FFFFFF',
  sunColorNight: '#7088A8',
  sunIntensityDay: 1.4,
  undergroundViewColor: '#241d16',
} as unknown as RenderConfig;

describe('createSkyDome', () => {
  it('keeps its sun and moon uniforms clear of the caller vectors', () => {
    // The celestial pass blanks these uniforms at night - the sun is hidden
    // below the horizon and the moon takes its place. While they aliased
    // `bodies.sunDir` / `bodies.moonDir`, that blanking also overwrote the real
    // sun direction for every reader after it, so the sky's hour grade saw a sun
    // straight down instead of one just below the horizon, and a 4 am sky came
    // out warm red.
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const sunDir = new THREE.Vector3(0.3, -0.9, 0.2);
    const moonDir = new THREE.Vector3(-0.3, 0.9, -0.2);
    const dome = createSkyDome(scene, camera, CONFIG, sunDir, moonDir);
    const uniforms = dome.material.uniforms as {
      uSunDir: { value: THREE.Vector3 };
      uMoonDir: { value: THREE.Vector3 };
    };

    assert.notEqual(uniforms.uSunDir.value, sunDir);
    assert.notEqual(uniforms.uMoonDir.value, moonDir);

    uniforms.uSunDir.value.set(0, -1, 0);
    uniforms.uMoonDir.value.set(0, 1, 0);

    assert.deepEqual(sunDir.toArray(), [0.3, -0.9, 0.2]);
    assert.deepEqual(moonDir.toArray(), [-0.3, 0.9, -0.2]);
  });
});
