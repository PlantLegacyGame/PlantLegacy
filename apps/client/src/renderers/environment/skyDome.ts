/**
 * C03 sky dome: zenith/horizon gradient, stars, cloud bands and the sun/moon
 * discs, all in one camera-centred sphere.
 *
 * The dome is centred on the camera and drawn first (renderOrder -100), so it
 * behaves like an infinite sky that never warps as the camera pans.
 */
import * as THREE from 'three';
import type { RenderConfig } from '../../config/clientConfig.js';

export interface SkyDome {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  zenithColor: THREE.Color;
  horizonColor: THREE.Color;
}

const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    // The dome is camera-centred, so the local position is the view direction.
    // Using the local vector keeps the sky perfectly stable while the camera
    // pans, orbits, zooms, or looks around.
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vDirection;
  uniform vec3 uZenithColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunIntensity;
  // 0 with the sun overhead, 1 with it on the horizon: the warm scattering that
  // makes golden hour look like light in the air rather than a tinted sky.
  uniform float uSunWarmth;
  uniform vec3 uMoonDir;
  uniform vec3 uMoonColor;
  // 0 at moonrise, 1 with the moon overhead: the halo grows instead of the moon
  // appearing at full brightness the instant the sun sets.
  uniform float uMoonIntensity;
  // Buried eyes see the earth in every direction except up through the opening.
  // Without this the dome paints sky downwards too, and that reads as a pale
  // floor under the ground instead of the inside of the earth.
  uniform float uEyeUnderGround;
  uniform vec3 uEarthColor;
  // Seconds since the world was entered: cloud bands drift, so the sky is not a
  // painted backdrop with a fixed picture on it.
  uniform float uCloudTime;
  // 0 in clear air, 1 in a full storm: overcast thickens and darkens the cloud
  // layer instead of the sky only changing colour.
  uniform float uStorm;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float valueNoise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vec3 dir = normalize(vDirection);
    // A buried eye is surrounded by soil, not by a sky that happens to be below
    // the horizon. Keep the cone overhead open for the Root Sight aperture; all
    // other directions are the inside of the earth. This also prevents the sky
    // from leaking between the remaining detail patch and the hidden distant
    // shells when the camera is underground.
    if (uEyeUnderGround > 0.5 && dir.y < 0.35) {
      gl_FragColor = vec4(uEarthColor, 1.0);
      #include <colorspace_fragment>
      return;
    }
    // Nothing below the horizon is sky. Either the ground covers it or the eye is
    // under it, and painting space down there is what put a black band across the
    // world whenever the eye sat below the surface or looked through a cut: the
    // band was this dome's lower half, proven by tagging its shader magenta and
    // watching exactly that region change.
    if (dir.y < 0.0) {
      // Nothing below the horizon is sky, and nothing there may read as a
      // surface either. This branch used to mix the soil's own tan into the
      // haze, which drew a flat tan wall behind the terrain wherever a ridge did
      // not cover it. Below the horizon is the horizon's own air, dimming with
      // depth: the ground cuts it off, and what shows past a ridge is haze.
      float below = clamp(-dir.y, 0.0, 1.0);
      gl_FragColor = vec4(uHorizonColor * (1.0 - 0.45 * below), 1.0);
      #include <colorspace_fragment>
      return;
    }
    float h = clamp(dir.y, 0.0, 1.0);
    float grad = pow(1.0 - h, 2.2);
    vec3 sky = mix(uZenithColor, uHorizonColor, grad);

    // Soft haze right at the horizon.
    sky = mix(sky, uHorizonColor, (1.0 - smoothstep(0.0, 0.18, h)) * 0.35);

    // Space above the atmosphere. During the day the sky colour still fills
    // the view; at night the high sky becomes the near-black of space while the
    // horizon retains a little airglow, so the planet reads as a body inside
    // space rather than a flat painted dome.
    float night = 1.0 - smoothstep(-0.15, 0.20, uSunDir.y);
    float spaceMask = smoothstep(0.02, 0.52, h) * night;
    sky = mix(sky, vec3(0.003, 0.005, 0.012), spaceMask * 0.97);

    // Stars are sampled in a 3D direction lattice. The old 2D atan/asin grid
    // collapsed near the celestial poles and stretched into large sideways
    // discs; a direction-space lattice keeps every star round and stable as the
    // camera turns. Star points are deliberately sub-pixel-small.
    if (night > 0.01 && dir.y > 0.005) {
      // Fewer, slightly larger cells than the first pass: at a normal orbit the
      // sky occupies only a narrow band above the horizon, and sub-pixel stars
      // disappeared there. These stay round points rather than the old stretched
      // 2D-polar discs.
      vec3 starSpace = dir * 105.0;
      vec3 cell = floor(starSpace);
      vec3 local = fract(starSpace) - 0.5;
      float present = smoothstep(0.972, 0.994, hash31(cell));
      vec3 jitter = vec3(
        hash31(cell + 1.7),
        hash31(cell + 9.1),
        hash31(cell + 17.3)
      ) - 0.5;
      float point = 1.0 - smoothstep(0.04, 0.12, length(local - jitter * 0.55));
      float twinkle = 0.65 + 0.35 * sin(hash31(cell + 3.0) * 80.0);
      vec3 starTint = mix(vec3(0.62, 0.75, 1.0), vec3(1.0, 0.9, 0.72), hash31(cell + 5.3));
      sky += starTint * present * point * twinkle * night * 1.35;
    }

    // Light, procedural cloud bands projected on a virtual plane. The plane
    // drifts with time and the bands are layered at two scales, so it reads as
    // moving air rather than a still pattern; a storm raises the coverage and
    // lowers the ceiling into an overcast instead of only tinting the sky.
    if (dir.y > 0.02) {
      vec2 drift = vec2(uCloudTime * 0.010, uCloudTime * 0.004);
      vec2 cloudUV = dir.xz / dir.y + drift;
      float storm = clamp(uStorm, 0.0, 1.0);
      float clouds =
        valueNoise2(cloudUV * 0.75) * 0.62 +
        valueNoise2(cloudUV * 1.8 + drift * 1.7) * 0.26 +
        valueNoise2(cloudUV * 4.3 - drift * 0.8) * 0.12;
      // Clear air keeps only the high wisps; rain and storm fill the ceiling.
      clouds = smoothstep(mix(0.70, 0.42, storm), mix(0.92, 0.62, storm), clouds);
      float cloudFade = smoothstep(0.0, mix(0.28, 0.10, storm), dir.y);
      vec3 cloudColor =
        mix(uHorizonColor, vec3(1.0), 0.55 * (1.0 - storm)) *
        (0.65 + 0.35 * clamp(uSunIntensity, 0.0, 1.0)) *
        (1.0 - storm * 0.55);
      float coverage = mix(0.30, 0.95, storm) * (1.0 - night * 0.65);
      sky = mix(sky, cloudColor, clouds * cloudFade * coverage);
    }

    // Golden-hour scattering: a wide warm lobe around the sun plus a band lying
    // along the horizon. The disc's own halo is tight; this is the air itself.
    if (uSunWarmth > 0.01 && uSunDir.y > -0.25) {
      float wide = max(0.0, dot(dir, normalize(uSunDir)));
      float lobe = pow(wide, 6.0) * 0.11;
      float band = pow(1.0 - smoothstep(0.0, 0.34, h), 3.0) * 0.07;
      sky += uSunColor * (lobe + band) * uSunWarmth;
    }

    // The solar disc.
    //
    // It used to be a high power of the dot product: a gaussian blob with no edge,
    // the sun read as a fuzzy ball of light. A body has a limb. This draws a disc
    // of about half a degree with a sharp, anti-aliased edge, darkens it towards
    // that edge (limb darkening, and a warm chromosphere right at it) and keeps
    // the glare in the air *around* the disc where scattering actually puts it.
    if (uSunDir.y > -0.1) {
      vec3 sunC = normalize(uSunDir);
      float sunAngle = acos(clamp(dot(dir, sunC), -1.0, 1.0));
      // Readable, not true-scale. At its real half a degree the sun is a tenth of
      // the width of the HUD text and still reads as a smudge; two degrees is the
      // size that says "sun" at a glance while staying a body with an edge.
      const float SUN_RADIUS = 0.034;
      float across = clamp(sunAngle / SUN_RADIUS, 0.0, 1.0);
      float disc = 1.0 - smoothstep(0.94, 1.0, across);
      float mu = sqrt(max(0.0, 1.0 - across * across));
      float limb = 0.42 + 0.58 * pow(mu, 0.6);
      vec3 discColor = mix(uSunColor * vec3(1.0, 0.70, 0.48), uSunColor, limb);
      float intensity = clamp(uSunIntensity, 0.0, 2.0);
      float glare =
        exp(-sunAngle * 130.0) * 0.55 +
        exp(-sunAngle * 16.0) * 0.11;
      sky += discColor * disc * limb * (2.4 + 0.8 * intensity);
      sky += uSunColor * glare * (0.55 + 0.45 * intensity);
    }

    // The lunar disc.
    //
    // Same story as the sun: it was a gaussian, so the moon was a pale smudge.
    // This is a disc with a local frame, maria (broad dark basins) and craters
    // sampled on that frame, so they stay put on the moon instead of swimming as
    // the sky turns; a dusty surface darkens to the limb, and the highlands catch
    // a little more light there than the maria do.
    if (uMoonDir.y > -0.1) {
      vec3 moonC = normalize(uMoonDir);
      float moonAngle = acos(clamp(dot(dir, moonC), -1.0, 1.0));
      const float MOON_RADIUS = 0.027;
      float moonAcross = clamp(moonAngle / MOON_RADIUS, 0.0, 1.0);
      float moonDisc = 1.0 - smoothstep(0.93, 1.0, moonAcross);
      float moonLevel = clamp(uMoonIntensity, 0.0, 1.0);
      if (moonDisc > 0.002 && moonLevel > 0.002) {
        vec3 pole = abs(moonC.y) > 0.97 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
        vec3 right = normalize(cross(pole, moonC));
        vec3 faceUp = cross(moonC, right);
        vec2 moonUv = vec2(dot(dir, right), dot(dir, faceUp)) / MOON_RADIUS;
        float radius2 = dot(moonUv, moonUv);
        float basins = valueNoise2(moonUv * 2.1 + 17.0);
        float craters =
          valueNoise2(moonUv * 6.5 - 4.0) * 0.55 + valueNoise2(moonUv * 17.0) * 0.45;
        float albedo = 0.58 + 0.30 * craters + 0.24 * smoothstep(0.42, 0.86, basins);
        float dustLimb = 0.55 + 0.45 * sqrt(max(0.0, 1.0 - radius2));
        float highlands = smoothstep(0.55, 1.0, sqrt(min(1.0, radius2))) * 0.28;
        // A moon is grey rock, not blue light: the night colour is a tint on it,
        // not its albedo.
        vec3 moonRock = mix(uMoonColor, vec3(1.0, 0.98, 0.94), 0.55);
        vec3 moonSurface = moonRock * (albedo * dustLimb + highlands) * 1.9;
        sky = mix(sky, moonSurface, moonDisc * moonLevel);
      }
      float moonGlow =
        exp(-moonAngle * 60.0) * 0.20 + exp(-moonAngle * 11.0) * 0.055;
      sky += uMoonColor * moonGlow * moonLevel;
    }

    gl_FragColor = vec4(sky, 1.0);
    // Three.js uniforms are in linear working space; convert back to the
    // renderer's output color space so the sky is not displayed dark.
    #include <colorspace_fragment>
  }
`;

/**
 * Build the dome and add it to the scene.
 *
 * The returned `zenithColor` / `horizonColor` are the live colours the update
 * loop lerps; the shader reads the same instances.
 */
export function createSkyDome(
  scene: THREE.Scene,
  camera: THREE.Camera,
  config: RenderConfig,
  sunDir: THREE.Vector3,
  moonDir: THREE.Vector3,
): SkyDome {
  const radius = Math.max(300, config.terrainRadius * 1.5);
  const geometry = new THREE.SphereGeometry(radius, 32, 16);

  const zenithColor = new THREE.Color(config.skyZenithDay);
  const horizonColor = new THREE.Color(config.skyHorizonDay);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uZenithColor: { value: zenithColor },
      uHorizonColor: { value: horizonColor },
      // Copies, not the caller's vectors. The renderer blanks these uniforms at
      // night to hide the sun's disc and show the moon; while they aliased
      // `bodies.sunDir` / `bodies.moonDir`, that blanking also overwrote the real
      // sun direction, so every reader after it - the fog, the fill light, the
      // water, the sky's own hour grading - saw a sun pointing straight down
      // instead of the one below the horizon.
      uSunDir: { value: sunDir.clone() },
      uSunColor: { value: new THREE.Color(config.sunColorDay) },
      uSunIntensity: { value: config.sunIntensityDay },
      uSunWarmth: { value: 0 },
      uMoonDir: { value: moonDir.clone() },
      uMoonColor: { value: new THREE.Color(config.sunColorNight) },
      uMoonIntensity: { value: 0 },
      uEyeUnderGround: { value: 0 },
      uCloudTime: { value: 0 },
      uStorm: { value: 0 },
      // The earth tone as configured, not quartered. At a quarter it was #0e0a07
      // - black to any eye - and every patch of "ground" painted with it read as
      // a hole in the world.
      uEarthColor: { value: new THREE.Color(config.undergroundViewColor) },
    },
    vertexShader: SKY_VERTEX_SHADER,
    fragmentShader: SKY_FRAGMENT_SHADER,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -100;
  mesh.frustumCulled = false;
  mesh.position.copy(camera.position);
  scene.add(mesh);

  return { mesh, material, zenithColor, horizonColor };
}
