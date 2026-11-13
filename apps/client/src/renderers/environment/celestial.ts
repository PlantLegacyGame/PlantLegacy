/**
 * C03 celestial motion: where the sun and moon are, and what that does to the
 * directional light, the ambient light and the sky's celestial uniforms.
 *
 * Time of day is a single normalised number; everything here is a pure
 * derivation from it plus `render.json`, so the sky, the ground lighting and the
 * plant's sun uniforms always agree.
 */
import * as THREE from 'three';
import type { RenderConfig } from '../../config/clientConfig.js';

// Scratch colour reused for the graded sun tint, so the per-frame update does
// not allocate two THREE.Color objects every tick. The value is copied into the
// light and the sky uniform before the next call, so sharing it is safe.
const scratchSunColor = new THREE.Color();

/** Live directions, updated in place so shader uniforms keep their reference. */
export interface CelestialBodies {
  sunDir: THREE.Vector3;
  moonDir: THREE.Vector3;
}

export interface CelestialElevation {
  /** Sine of the sun's elevation, -1 (nadir) to 1 (zenith). */
  sunElev: number;
  /** 0 at night, 1 in full day. */
  dayFactor: number;
  /** Peaks at the horizon and fades by mid-morning. */
  duskFactor: number;
}

/** Move the sun and moon to their position for `timeOfDay` (0..1). */
export function updateCelestialBodies(
  bodies: CelestialBodies,
  timeOfDay: number,
): CelestialElevation {
  const sunAngle = timeOfDay * Math.PI * 2 - Math.PI / 2;
  const sunElev = Math.sin(sunAngle);

  bodies.sunDir.set(Math.cos(sunAngle) * 0.8, sunElev, Math.sin(sunAngle) * 0.4).normalize();
  bodies.moonDir.set(-bodies.sunDir.x, -bodies.sunDir.y, -bodies.sunDir.z).normalize();

  const dayFactor = THREE.MathUtils.smoothstep(sunElev, -0.05, 0.35);
  const duskFactor = (1.0 - Math.abs(sunElev * 3.0)) * (1.0 - dayFactor);

  return { sunElev, dayFactor, duskFactor };
}

export interface CelestialLightingTargets {
  config: RenderConfig;
  sunLight: THREE.DirectionalLight;
  ambientLight: THREE.AmbientLight;
  skyMaterial: THREE.ShaderMaterial;
  bodies: CelestialBodies;
  elevation: CelestialElevation;
  /** Server-provided sun intensity multiplier for the time of day. */
  sunIntensity: number;
  /** Orbit radius that puts the directional light on the visual sun. */
  sunOrbitalDistance: number;
}

/**
 * Point the directional light at the sun (or the moon at night) and grade the
 * sky's celestial uniforms.
 */
export function applyCelestialLighting(targets: CelestialLightingTargets): void {
  const { config: cfg, sunLight, skyMaterial, bodies, elevation, sunIntensity } = targets;
  const orbit = targets.sunOrbitalDistance;
  const { sunDir, moonDir } = bodies;
  const { sunElev } = elevation;

  if (sunElev >= -0.1) {
    // A DirectionalLight shines from its position toward its target (the
    // origin), so the position must sit on the same side as the visual sun.
    sunLight.position.set(sunDir.x * orbit, Math.max(8, sunDir.y * orbit), sunDir.z * orbit);
    const duskFactor = (1.0 - Math.abs(sunElev * 3.0)) * 0.5;
    const sunBaseColor = scratchSunColor.set(duskFactor > 0.2 ? cfg.sunColorDusk : cfg.sunColorDay);
    sunLight.color.copy(sunBaseColor);
    sunLight.intensity = Math.max(0.05, cfg.sunIntensityDay * Math.max(0.2, sunElev));
    skyMaterial.uniforms.uSunDir.value.copy(sunDir);
    skyMaterial.uniforms.uSunColor.value.copy(sunBaseColor);
    skyMaterial.uniforms.uSunIntensity.value = sunLight.intensity;
    skyMaterial.uniforms.uMoonDir.value.set(0, -1, 0);
  } else {
    sunLight.position.set(moonDir.x * orbit, Math.max(12, moonDir.y * orbit), moonDir.z * orbit);
    sunLight.color.set(cfg.sunColorNight);
    sunLight.intensity = cfg.sunIntensityNight;
    skyMaterial.uniforms.uSunDir.value.set(0, -1, 0);
    skyMaterial.uniforms.uMoonDir.value.copy(moonDir);
    skyMaterial.uniforms.uSunColor.value.set(cfg.sunColorNight);
    skyMaterial.uniforms.uSunIntensity.value = sunLight.intensity;
  }

  const ambientTarget =
    elevation.dayFactor > 0.1 ? cfg.ambientIntensityDay * sunIntensity : cfg.ambientIntensityNight;
  targets.ambientLight.intensity = THREE.MathUtils.lerp(
    targets.ambientLight.intensity,
    Math.max(0.1, ambientTarget),
    0.3,
  );
}
