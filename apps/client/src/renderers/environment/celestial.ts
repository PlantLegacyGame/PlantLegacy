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
/** Scratch colour for the dusk end of the grade, reused per frame. */
const scratchDusk = new THREE.Color();

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

/**
 * How far the moon orbits, in planet radii.
 *
 * The real Moon is sixty Earth radii out, which puts it past any far plane a
 * planet view can afford. Six radii keeps it a body with a disc rather than a
 * point, and it fits inside the orbit view's own far plane.
 */
export const MOON_ORBIT_RADII = 6;
/** The Moon's radius as a fraction of Earth's, i.e. its real proportion. */
export const MOON_RADIUS_RATIO = 0.27;

export interface MoonBody {
  mesh: THREE.Mesh;
}

/**
 * A moon with a body, not just a disc in the sky dome.
 *
 * The dome's lunar disc is what a surface eye sees, and it is real: it rises,
 * it is lit from the sun and it has maria. From planet view the same body has
 * to be an object in space, or the planet is a ball with a sun and nothing
 * else. It is a plain lit sphere - the directional light already points at the
 * sun (and at the moon after dark), so its phase comes from the same fact the
 * ground's lighting does.
 */
/**
 * The moon's own face: maria and craters, drawn once into a canvas.
 *
 * A plain sphere is not a moon; at six planet radii it read as a second, duller
 * world, and the whole point of putting it in the sky is that the eye can tell
 * it is not one. Craters are cheap and unmistakable: a dark rim with a bright
 * floor, plus a few broad maria, is the shape the dome's disc already draws and
 * the body in space should agree with it.
 *
 * Null where there is no DOM (a unit test): the body still builds, untextured.
 */
function moonAlbedoTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const width = 512;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  let state = 0x9e3779b9;
  const random = (): number => {
    state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x9e3779b9) | 0;
    return ((state >>> 8) & 0xffffff) / 0x1000000;
  };
  ctx.fillStyle = '#efece4';
  ctx.fillRect(0, 0, width, height);
  // Maria: a handful of soft dark seas, kept away from the poles so the sphere's
  // UV pinch does not stretch them into streaks.
  for (let i = 0; i < 7; i += 1) {
    const x = random() * width;
    const y = height * (0.22 + random() * 0.56);
    const rx = 26 + random() * 54;
    const ry = rx * (0.5 + random() * 0.5);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    gradient.addColorStop(0, 'rgba(150, 148, 143, 0.85)');
    gradient.addColorStop(1, 'rgba(150, 148, 143, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // Craters: the rim is the shadowed wall, the floor is lit by the same sun.
  for (let i = 0; i < 90; i += 1) {
    const x = random() * width;
    const y = height * (0.06 + random() * 0.88);
    const r = 1.6 + random() ** 2.4 * 12;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(120, 118, 114, ${0.18 + random() * 0.3})`;
    ctx.fill();
    ctx.lineWidth = Math.max(0.6, r * 0.22);
    ctx.strokeStyle = 'rgba(255, 253, 246, 0.45)';
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

export function createMoonBody(planetRadiusM: number, surfaceColor: THREE.Color): MoonBody {
  const radius = Math.max(1, Math.max(1, planetRadiusM) * MOON_RADIUS_RATIO);
  const geometry = new THREE.SphereGeometry(radius, 48, 24);
  const material = new THREE.MeshStandardMaterial({
    // The soil's own warmth, paled almost to white: a moon is not a brown body.
    color: surfaceColor.clone().lerp(new THREE.Color(0xffffff), 0.74),
    map: moonAlbedoTexture(),
    roughness: 0.95,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'planet-moon';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.visible = false;
  return { mesh };
}

/** Reused by `placeMoonBody`, so a per-frame placement allocates nothing. */
const moonOrbitScratch = new THREE.Vector3();
const moonSideScratch = new THREE.Vector3();

/**
 * Put the moon on its orbit around the planet's centre.
 *
 * It rides the opposite direction to the sun, which is the same fact the sky
 * dome's lunar disc is drawn from: a full moon at midnight and a new moon at
 * noon. It is nudged up out of the anti-solar line by `lift` so a camera on the
 * lit face can still see it clear of the planet's limb.
 */
export function placeMoonBody(
  body: MoonBody,
  planetCentre: THREE.Vector3,
  moonDir: THREE.Vector3,
  planetRadiusM: number,
  lift = 0.34,
): void {
  const distance = Math.max(1, planetRadiusM) * MOON_ORBIT_RADII;
  // The lift is an angle, not an extra radius: the direction is normalised
  // after it, so the body stays on its 6R orbit instead of drifting outwards.
  //
  // The vertical lift alone did nothing when the moon was on the pole - at
  // noon and at midnight it is exactly the anti-solar axis - so the moon sat
  // dead behind the planet in the two views that most want a moon. Step it
  // sideways instead, about 45-50 degrees off that axis: enough that the
  // planet's 24.6-degree limb at 2.4R no longer covers it, and still inside
  // the horizontal field when the eye is on the daylight side. The tiny lift
  // keeps it a little above the orbital plane rather than on the line.
  moonSideScratch.set(0, 1, 0).cross(moonDir);
  if (moonSideScratch.lengthSq() < 1e-6) moonSideScratch.set(1, 0, 0);
  else moonSideScratch.normalize();
  moonOrbitScratch.copy(moonDir).addScaledVector(moonSideScratch, 1.1);
  moonOrbitScratch.y += Math.min(Math.max(lift, 0), 0.08);
  if (moonOrbitScratch.lengthSq() < 1e-9) moonOrbitScratch.set(0, 1, 0);
  moonOrbitScratch.normalize();
  body.mesh.position.copy(planetCentre).addScaledVector(moonOrbitScratch, distance);
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
  /** Orbit radius that puts the directional light on the visual sun. */
  sunOrbitalDistance: number;
  /**
   * Ambient intensity for this frame: the smoothed baseline plus the lightning
   * flash. Composed by `stepAmbientLighting`, never accumulated into the value
   * the next frame smooths from.
   */
  ambientIntensity: number;
  /**
   * The weather's light multiplier (`clear_light_multiplier` and friends). The
   * broadcast's `sunIntensity` already carries it, so this is what grades the
   * parts that number does not reach: the direct beam and its sky disk.
   */
  lightMultiplier: number;
}

/**
 * How warm the direct light is, from 0 (noon white) to 1 (full sunset orange).
 *
 * The old code switched colour at `duskFactor > 0.2`, so the light jumped from
 * noon-white to sunset-orange in one frame. Golden hour is the best-looking part
 * of a day cycle, and it needs a ramp: the sun only turns warm once it is low,
 * and it keeps warming until it is on the horizon.
 */
export function sunWarmth(sunElev: number): number {
  // Warm as the sun drops to the horizon, and back to nothing once it is under
  // it: at night the light is moonlight, not a very late sunset. Without the
  // second ramp, warmth was 1 all night, which put golden-hour mist in, and a
  // warm backlight on, every dark hour.
  const low = 1 - THREE.MathUtils.smoothstep(sunElev, 0.02, 0.45);
  const above = THREE.MathUtils.smoothstep(sunElev, -0.16, 0.02);
  return THREE.MathUtils.clamp(low * above, 0, 1);
}

/** Grades the direct beam between the configured day and dusk colours. */
export function gradeSunColor(
  sunElev: number,
  cfg: Pick<RenderConfig, 'sunColorDay' | 'sunColorDusk'>,
  out: THREE.Color,
): THREE.Color {
  const warmth = sunWarmth(sunElev);
  return out.set(cfg.sunColorDay).lerp(scratchDusk.set(cfg.sunColorDusk), warmth);
}

/**
 * Moonlight strength for this frame.
 *
 * It used to be a constant `sun_intensity_night` the moment the sun crossed the
 * horizon, so the world was as moonlit at moonrise as at midnight. Scaling by the
 * moon's own elevation gives the slow build people actually notice.
 */
export function moonStrength(sunElev: number): number {
  // The moon is opposite the sun, so its elevation is the negated sine.
  return THREE.MathUtils.clamp(-sunElev, 0, 1) ** 0.6;
}

export function moonIntensity(
  sunElev: number,
  cfg: Pick<RenderConfig, 'sunIntensityNight'>,
  weatherLight: number,
): number {
  return Math.max(0.02, cfg.sunIntensityNight * moonStrength(sunElev) * weatherLight);
}

/**
 * Renderer exposure for the hour: a slight lift at golden hour and a slight crush
 * at night. Exposure cannot tint, but it is what makes a dusk `sunset` read as
 * brighter *air* and a night as actual darkness rather than flat grey.
 */
export function gradeExposure(
  sunElev: number,
  cfg: Pick<RenderConfig, 'exposureDay' | 'exposureHorizon' | 'exposureNight'>,
): number {
  const warmth = sunWarmth(sunElev);
  const night = THREE.MathUtils.clamp(-sunElev, 0, 1);
  // Warmth first (dawn/dusk lift), then the night crush, so the two never fight
  // over the same hour: they are disjoint at the horizon.
  const day = THREE.MathUtils.lerp(cfg.exposureDay, cfg.exposureHorizon, warmth);
  return THREE.MathUtils.lerp(day, cfg.exposureNight, night);
}

/** The ambient fields `stepAmbientLighting` needs from `render.json`. */
export type AmbientLightingConfig = Pick<
  RenderConfig,
  'ambientIntensityDay' | 'ambientIntensityNight' | 'lightningIntensityBoost' | 'ambientFadeTauS'
>;

export interface AmbientLightingStep {
  /** Smoothed ambient level without any lightning. */
  baseline: number;
  /** Extra intensity for this frame's strike, already boosted by config. */
  flash: number;
  /** Value to assign to the AmbientLight this frame. */
  intensity: number;
}

/**
 * One frame of ambient lighting: smooth the day/night baseline, then add the
 * storm's flash on top.
 *
 * The flash used to be added straight into the light's intensity, which is also
 * the value `applyCelestialLighting` lerps toward the day/night target. A strike
 * therefore re-entered the smoother every frame: the lerp only removes 30% of
 * it per frame, so a 120 ms flash was drawn several times brighter than the
 * weather machine asked for and lingered after it ended. Keeping the baseline
 * in its own number makes the flash a pure per-frame contribution.
 */
export function stepAmbientLighting(params: {
  currentBaseline: number;
  config: AmbientLightingConfig;
  elevation: CelestialElevation;
  sunIntensity: number;
  lightningIntensity: number;
  /** How much of the distance to the day/night target to close this frame. */
  alpha: number;
}): AmbientLightingStep {
  // Blend, do not switch. The target used to flip at `dayFactor > 0.1` from the
  // night value to `ambient_intensity_day x sunIntensity`, which at first light
  // is about 0.02 - darker than the night value it replaced, so dawn began with
  // a dip. Blending by `dayFactor` is continuous and reaches both ends exactly.
  const dayTarget = params.config.ambientIntensityDay * params.sunIntensity;
  const target = THREE.MathUtils.lerp(
    params.config.ambientIntensityNight,
    dayTarget,
    THREE.MathUtils.clamp(params.elevation.dayFactor, 0, 1),
  );
  const alpha = Math.min(1, Math.max(0, params.alpha));
  const baseline = THREE.MathUtils.lerp(params.currentBaseline, Math.max(0.1, target), alpha);
  // `lightning_intensity_boost` is a peak multiplier on the ambient level, so
  // only the part above 1 is the flash. `lightning_max_intensity` normalises the
  // machine's strike to 0..1 as it fades.
  const boost = Math.max(1, params.config.lightningIntensityBoost);
  const lightning = Math.max(0, params.lightningIntensity);
  const flash = baseline * (boost - 1) * lightning;
  return { baseline, flash, intensity: baseline + flash };
}

/**
 * Point the directional light at the sun (or the moon at night) and grade the
 * sky's celestial uniforms.
 */
export function applyCelestialLighting(targets: CelestialLightingTargets): void {
  const { config: cfg, sunLight, skyMaterial, bodies, elevation } = targets;
  const orbit = targets.sunOrbitalDistance;
  const { sunDir, moonDir } = bodies;
  const { sunElev } = elevation;
  // A storm dims the ambient, the fog and the sky colours; without this it left
  // the direct beam and its disk at clear-sky brightness, so the world was
  // grey-blue around a full-strength sun.
  const weatherLight = Math.min(1, Math.max(0, targets.lightMultiplier));

  if (sunElev >= -0.1) {
    // A DirectionalLight shines from its position toward its target (the
    // origin), so the position must sit on the same side as the visual sun.
    sunLight.position.set(sunDir.x * orbit, Math.max(8, sunDir.y * orbit), sunDir.z * orbit);
    // Warm, continuous grade: white at noon, orange as the sun approaches the
    // horizon. Not a threshold switch, so dusk actually fades.
    const sunBaseColor = gradeSunColor(sunElev, cfg, scratchSunColor);
    sunLight.color.copy(sunBaseColor);
    sunLight.intensity = Math.max(
      0.05,
      cfg.sunIntensityDay * Math.max(0.2, sunElev) * weatherLight,
    );
    skyMaterial.uniforms.uSunDir.value.copy(sunDir);
    skyMaterial.uniforms.uSunColor.value.copy(sunBaseColor);
    skyMaterial.uniforms.uSunIntensity.value = sunLight.intensity;
    // The sky's warm scattering follows the same ramp as the beam's colour.
    skyMaterial.uniforms.uSunWarmth.value = sunWarmth(sunElev) * weatherLight;
    // The moon is not drawn by the day's own uniforms: blanking the direction
    // keeps its disc out of a daylit sky without faking a second light.
    skyMaterial.uniforms.uMoonDir.value.set(0, -1, 0);
    skyMaterial.uniforms.uMoonIntensity.value = 0;
  } else {
    sunLight.position.set(moonDir.x * orbit, Math.max(12, moonDir.y * orbit), moonDir.z * orbit);
    sunLight.color.set(cfg.sunColorNight);
    sunLight.intensity = moonIntensity(sunElev, cfg, weatherLight);
    skyMaterial.uniforms.uSunDir.value.set(0, -1, 0);
    skyMaterial.uniforms.uMoonDir.value.copy(moonDir);
    // The halo follows the same ramp as the light it casts.
    skyMaterial.uniforms.uMoonIntensity.value = moonStrength(sunElev) * weatherLight;
    skyMaterial.uniforms.uSunColor.value.set(cfg.sunColorNight);
    skyMaterial.uniforms.uSunIntensity.value = sunLight.intensity;
  }

  targets.ambientLight.intensity = targets.ambientIntensity;
}
