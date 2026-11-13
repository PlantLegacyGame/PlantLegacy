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

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
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
    if (uEyeUnderGround > 0.5 && dir.y < -0.02) {
      gl_FragColor = vec4(uEarthColor, 1.0);
      #include <colorspace_fragment>
      return;
    }
    float h = clamp(dir.y, 0.0, 1.0);
    float grad = pow(1.0 - h, 2.2);
    vec3 sky = mix(uZenithColor, uHorizonColor, grad);

    // Soft haze right at the horizon.
    sky = mix(sky, uHorizonColor, (1.0 - smoothstep(0.0, 0.18, h)) * 0.35);

    // Stars appear only at night and only above the horizon. Distribute them in
    // spherical angle space and draw small round points instead of filling whole
    // grid cells (which looked like white squares).
    float night = 1.0 - smoothstep(-0.15, 0.20, uSunDir.y);
    if (night > 0.01 && dir.y > 0.0) {
      vec2 starUV = vec2(atan(dir.z, dir.x) * 5.0, asin(clamp(dir.y, -1.0, 1.0)) * 10.0);
      vec2 cell = floor(starUV);
      vec2 local = fract(starUV) - 0.5;
      float present = step(0.965, hash21(cell));
      float point = smoothstep(0.16, 0.0, length(local));
      float twinkle = 0.6 + 0.4 * sin(hash21(cell + 7.0) * 40.0);
      sky += vec3(0.82, 0.87, 1.0) * present * point * twinkle * night * 0.85;
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
      uEarthColor: { value: new THREE.Color(config.undergroundViewColor).multiplyScalar(0.25) },
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
