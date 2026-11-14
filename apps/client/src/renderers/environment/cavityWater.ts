/**
 * Water in the cavity: a real surface at the height of the local water table.
 *
 * The soil model keeps water in a below-ground store, and rain has to be
 * *visible* once it lands: a puddle that rises in the pit, reflects the sky at
 * grazing angles, and shows a bright meniscus line where it meets the dirt.
 * That is what this layer draws. It is not a full fluid simulation - the level
 * and the flow between tiles are the server's job - but the surface reads as
 * water rather than a blue disc:
 *
 * - Fresnel mixing: looking straight down the water is dark and deep; at a
 *   grazing angle it turns into the colour of the sky, which is what a real
 *   water surface does.
 * - Two travelling ripple trains break up the reflection so it is not a
 *   mirror-flat plate.
 * - A thin bright rim marks the water line, the surface-tension meniscus
 *   against the soil.
 * - The disc is clipped to the bowl mouth, so it pools inside the pit instead
 *   of hovering over the ground.
 */
import * as THREE from 'three';
import { CAVITY_MOUTH_FRACTION } from './cavityBowl.js';

export interface CavityWater {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

const WATER_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWaterWorld;
  varying vec2 vWaterLocal;

  void main() {
    vWaterLocal = position.xy;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWaterWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const WATER_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uDeepColor;
  uniform vec3 uSkyColor;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uRadius;
  varying vec3 vWaterWorld;
  varying vec2 vWaterLocal;

  // Ripples: two sine trains at right angles plus a slow swell. Enough to break
  // the reflection into moving highlights without pretending to be a wave solver.
  vec3 rippleNormal(vec2 p, float t) {
    float a = sin(p.x * 9.0 + t * 1.7) * 0.5 + sin(p.y * 7.0 - t * 1.3) * 0.5;
    float b = sin((p.x + p.y) * 13.0 + t * 2.3) * 0.35;
    float dx = cos(p.x * 9.0 + t * 1.7) * 0.5 + cos((p.x + p.y) * 13.0 + t * 2.3) * 0.35;
    float dy = cos(p.y * 7.0 - t * 1.3) * 0.5 + cos((p.x + p.y) * 13.0 + t * 2.3) * 0.35;
    return normalize(vec3(-dx * 0.12, 1.0, -dy * 0.12) * (0.75 + 0.25 * a + 0.1 * b));
  }

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWaterWorld);
    vec3 normal = rippleNormal(vWaterLocal, uTime);
    float facing = clamp(dot(normal, viewDir), 0.0, 1.0);
    // Schlick-ish fresnel: still water is transparent from above and mirror-like
    // from the side. The exponent is what makes the reflected sky appear at the
    // shallow angle a player actually looks into the pit from.
    float fresnel = pow(1.0 - facing, 3.0);
    float specular = pow(max(dot(reflect(-normalize(uSunDir), normal), viewDir), 0.0), 90.0);

    vec3 color = mix(uDeepColor, uSkyColor, clamp(0.25 + fresnel * 0.75, 0.0, 1.0));
    color += uSunColor * specular * 0.9;

    // Meniscus: the last few centimetres of water climb the soil wall and catch
    // light, which is the line players read as "the water level".
    float radial = length(vWaterLocal) / max(uRadius, 1e-4);
    float meniscus = smoothstep(0.82, 1.0, radial);
    color = mix(color, uSunColor, meniscus * 0.35);

    float alpha = uOpacity * mix(0.55, 1.0, fresnel);
    alpha = max(alpha, meniscus * 0.85);
    // Soft edge so the disc never ends on a hard polygon boundary against dirt.
    alpha *= 1.0 - smoothstep(0.97, 1.0, radial);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

export function createCavityWater(): CavityWater {
  const geometry = new THREE.CircleGeometry(1, 64);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0.72 },
      uDeepColor: { value: new THREE.Color(0x12262c) },
      uSkyColor: { value: new THREE.Color(0x8fb4c4) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
      uSunColor: { value: new THREE.Color(0xfff3d6) },
      uRadius: { value: 1 },
    },
    vertexShader: WATER_VERTEX_SHADER,
    fragmentShader: WATER_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'root-sight-water';
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  mesh.renderOrder = 2;
  return { mesh, material };
}

/**
 * Place the pool for this frame.
 *
 * `fraction` is how full the local soil cavity is (0 dry .. 1 saturated). An
 * empty cavity has its water table `maxDepthM` below the surface; a full one
 * reaches the surface. Anything below the bowl floor is clamped, so the pool
 * never floats below the dirt.
 */
export function updateCavityWater(
  water: CavityWater,
  centre: THREE.Vector3,
  radius: number,
  fraction: number,
  surfaceY: number,
  maxDepthM: number,
  timeSeconds: number,
): void {
  const full = Math.min(1, Math.max(0, fraction));
  const mouth = Math.max(0.12, radius * CAVITY_MOUTH_FRACTION);
  const floorY = surfaceY - Math.max(0.2, radius * 2.0);
  const depth = (1 - full) * maxDepthM;
  const levelY = Math.max(floorY, surfaceY - depth);

  water.mesh.position.set(centre.x, levelY, centre.z);
  water.mesh.scale.setScalar(mouth);
  water.mesh.visible = full > 0.02;
  water.material.uniforms.uRadius.value = mouth;
  water.material.uniforms.uTime.value = timeSeconds;
}
