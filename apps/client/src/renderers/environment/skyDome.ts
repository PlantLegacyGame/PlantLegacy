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
  uniform vec3 uMoonDir;
  uniform vec3 uMoonColor;
  // Buried eyes see the earth in every direction except up through the opening.
  // Without this the dome paints sky downwards too, and that reads as a pale
  // floor under the ground instead of the inside of the earth.
  uniform float uEyeUnderGround;
  uniform vec3 uEarthColor;
  // Distant ground below the horizon. Mixing the earth tone with the sky's pale
  // horizon made a grey-green band; soil hazed toward the horizon reads as land
  // running away from the viewer instead.
  uniform vec3 uSoilColor;

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
      // Distant ground, hazed: soil running to the horizon, so the two meet
      // without a seam and neither of them is black.
      gl_FragColor = vec4(mix(uSoilColor, uHorizonColor, 0.35), 1.0);
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

    // Light, procedural cloud bands projected on a virtual plane.
    if (dir.y > 0.02) {
      vec2 cloudUV = dir.xz / dir.y;
      float clouds =
        valueNoise2(cloudUV * 0.75) * 0.65 + valueNoise2(cloudUV * 1.8) * 0.35;
      clouds = smoothstep(0.58, 0.88, clouds);
      float cloudFade = smoothstep(0.0, 0.28, dir.y);
      vec3 cloudColor =
        mix(uHorizonColor, vec3(1.0), 0.55) *
        (0.65 + 0.35 * clamp(uSunIntensity, 0.0, 1.0));
      sky = mix(sky, cloudColor, clouds * cloudFade * 0.30 * (1.0 - night));
    }

    // Solar disc and corona
    if (uSunDir.y > -0.1) {
      float sunDot = max(0.0, dot(dir, normalize(uSunDir)));
      float sunCore = pow(sunDot, 512.0) * 1.8;
      float sunHalo = pow(sunDot, 24.0) * 0.35;
      sky += uSunColor * (sunCore + sunHalo) * clamp(uSunIntensity, 0.0, 1.5);
    }

    // Lunar disc and soft glow
    if (uMoonDir.y > -0.1) {
      float moonDot = max(0.0, dot(dir, normalize(uMoonDir)));
      float moonCore = pow(moonDot, 384.0) * 0.9;
      float moonHalo = pow(moonDot, 20.0) * 0.15;
      sky += uMoonColor * (moonCore + moonHalo);
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
      uSunDir: { value: sunDir },
      uSunColor: { value: new THREE.Color(config.sunColorDay) },
      uSunIntensity: { value: config.sunIntensityDay },
      uMoonDir: { value: moonDir },
      uMoonColor: { value: new THREE.Color(config.sunColorNight) },
      uEyeUnderGround: { value: 0 },
      // The earth tone as configured, not quartered. At a quarter it was #0e0a07
      // - black to any eye - and every patch of "ground" painted with it read as
      // a hole in the world.
      uEarthColor: { value: new THREE.Color(config.undergroundViewColor) },
      uSoilColor: { value: new THREE.Color(config.soilDryColor) },
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
