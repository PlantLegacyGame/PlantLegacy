import * as THREE from 'three';

/**
 * PlantNodeData represents a single node in a plant's graph.
 */
export interface PlantNodeData {
  id: string;
  position: THREE.Vector3;
  type: number; // 0 = root, 1 = stem/trunk/branch, 2 = leaf
  radius: number;
  parentId: string | null;
  age: number;
  health: number;
  mutationFlags: number;
  biomass: number;
  isOwnPlant?: boolean;
  spawnTime?: number;
}

/**
 * PlantRendererConfig tunables loaded from config/plant_renderer.json
 */
export interface PlantRendererConfig {
  maxNodesPerPlant: number;
  tubeRingCount: number;
  tubeLengthSegments: number;
  leafCountPerNode: number;
  leafSize: number;
  leafLengthWidthRatio: number;
  petioleLength: number;
  petioleThickness: number;
  l0Distance: number;
  l1Distance: number;
  l2Distance: number;
  triangleBudgetL0: number;
  triangleBudgetL1: number;
  windStrength: number;
  windSpeed: number;
  healthTintStrength: number;
  mutation0Param: number;
  mutation1Param: number;
  mutation2Param: number;
  rootSightEnabled: boolean;
  rootSightOpacity: number;
  canopySightEnabled: boolean;
  photosynthesisViz: boolean;
  waterFlowViz: boolean;
  nutrientFlowViz: boolean;
  nodeSize: number;
  // C02 SDF Organism Fusion Tunables
  sminBlendRadius: number;
  maxRaymarchSteps: number;
  raymarchHitEpsilon: number;
  boundingBoxPadding: number;
  // T02: Root Sight specific
  rootSightCutawayRadius: number;
  rootSightSoilOpacity: number;
  ownRootHighlightColor: string;
  rivalRootHighlightColor: string;
}

export const DEFAULT_CONFIG: PlantRendererConfig = {
  maxNodesPerPlant: 1000,
  tubeRingCount: 8,
  tubeLengthSegments: 8,
  leafCountPerNode: 1,
  leafSize: 1.2,
  leafLengthWidthRatio: 2.5,
  petioleLength: 0.25,
  petioleThickness: 0.015,
  l0Distance: 50.0,
  l1Distance: 150.0,
  l2Distance: 500.0,
  triangleBudgetL0: 1500,
  triangleBudgetL1: 800,
  windStrength: 0.3,
  windSpeed: 1.0,
  healthTintStrength: 0.5,
  mutation0Param: 0.0,
  mutation1Param: 1.5,
  mutation2Param: 0.3,
  rootSightEnabled: false,
  rootSightOpacity: 0.6,
  canopySightEnabled: true,
  photosynthesisViz: true,
  waterFlowViz: true,
  nutrientFlowViz: true,
  nodeSize: 1.0,
  // C02 SDF Organism Fusion Tunables
  sminBlendRadius: 0.08,
  maxRaymarchSteps: 32,
  raymarchHitEpsilon: 0.005,
  boundingBoxPadding: 1.2,
  // T02: Root Sight specific
  rootSightCutawayRadius: 50.0,
  rootSightSoilOpacity: 0.3,
  ownRootHighlightColor: '#4CAF50',
  rivalRootHighlightColor: '#FF5722',
};

const MAX_PRIMITIVES = 256;

// ============================================================================
// GLSL 3.0 ES Shaders for Raymarched Signed Distance Field Organism
// ============================================================================

const organismVert = `
out vec3 vWorldPos;

void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const organismFrag = `
precision highp float;
precision highp int;

in vec3 vWorldPos;
out vec4 fragColor;

#define MAX_PRIMITIVES 256

uniform vec3 uCameraPosition;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform int uPrimitiveCount;
uniform sampler2D uPrimTex;

uniform float uTime;
uniform float uSminBlendRadius;
uniform int uMaxRaymarchSteps;
uniform float uRaymarchHitEpsilon;

uniform float uWindStrength;
uniform float uWindSpeed;
uniform float uHealthTintStrength;
uniform float uMutation0Param;
uniform float uMutation1Param;
uniform float uMutation2Param;

uniform vec3 uSunDirection;
uniform vec3 uRootColor;
uniform vec3 uSeedColor;
uniform vec3 uCanopyColor;
uniform vec3 uLeafColor;

// T02 Root Sight uniforms
uniform bool uRootSightEnabled;
uniform vec3 uRootSightSphereCenter;
uniform float uRootSightSphereRadius;
uniform float uRootSightProgress;
uniform vec3 uOwnRootHighlightColor;
uniform vec3 uRivalRootHighlightColor;

// Three.js only injects projectionMatrix into vertex prefix, not fragment.
// We declare it here so gl_FragDepth can be computed from the hit position.
uniform mat4 projectionMatrix;

// Safe AABB Ray intersection
vec2 intersectAABB(vec3 ro, vec3 rd, vec3 boxMin, vec3 boxMax) {
    vec3 safeRd = vec3(
        abs(rd.x) < 1e-6 ? (rd.x >= 0.0 ? 1e-6 : -1e-6) : rd.x,
        abs(rd.y) < 1e-6 ? (rd.y >= 0.0 ? 1e-6 : -1e-6) : rd.y,
        abs(rd.z) < 1e-6 ? (rd.z >= 0.0 ? 1e-6 : -1e-6) : rd.z
    );
    vec3 invD = 1.0 / safeRd;
    vec3 t0 = (boxMin - ro) * invD;
    vec3 t1 = (boxMax - ro) * invD;
    vec3 tmin = min(t0, t1);
    vec3 tmax = max(t0, t1);
    float tNear = max(max(tmin.x, tmin.y), tmin.z);
    float tFar = min(min(tmax.x, tmax.y), tmax.z);
    return vec2(tNear, tFar);
}

// Swept tapered segment / joint / natural organic leaf blade SDF (Lipschitz 1-continuous)
// Supports cylindrical stems/roots/petioles, and parabolic tapered leaf lamina with realistic sharp edges
float sdOrganicSegment(vec3 p, vec3 a, vec3 b, float rA, float rB, float flatness, vec3 flatAxis) {
    vec3 ba = b - a;
    float l2 = dot(ba, ba);
    if (l2 < 0.0001) {
        vec3 pa = p - a;
        if (flatness > 1.05) {
            float proj = dot(pa, flatAxis);
            vec3 planarComp = pa - flatAxis * proj;
            float targetR = rA;
            // Realistic organic leaf: razor-thin edge (2.5mm) with subtle natural midrib camber
            float thickness = max(0.0035, (targetR / flatness) * 0.35);
            vec2 d2 = vec2(length(planarComp) - targetR, abs(proj) - thickness);
            return min(max(d2.x, d2.y), 0.0) + length(max(d2, 0.0));
        }
        return length(pa) - rA;
    }
    vec3 pa = p - a;
    float h = clamp(dot(pa, ba) / l2, 0.0, 1.0);
    vec3 closest = pa - ba * h;

    if (flatness > 1.05) {
        // Planar leaf blade: project distance relative to leaf plane normal (flatAxis)
        float proj = dot(closest, flatAxis);
        vec3 planarComp = closest - flatAxis * proj;

        // Botanical Leaf Lamina: widest in middle/petiole junction, tapering smoothly to razor tip
        float targetR = mix(rA, rB, h);

        // Razor-thin natural leaf cross section (2.5 - 4.5mm), eliminating the "hockey puck" thickness
        float thickness = max(0.0035, (targetR / flatness) * 0.35);

        // Distance along blade plane + out-of-plane thickness
        vec2 d2 = vec2(length(planarComp) - targetR, abs(proj) - thickness);
        return min(max(d2.x, d2.y), 0.0) + length(max(d2, 0.0));
    }
    return length(closest) - mix(rA, rB, h);
}

// Procedural 3D wind displacement (roots underground are firmly anchored; canopy sways)
vec3 applyWind(vec3 p) {
    float height = max(0.0, p.y);
    if (height < 0.1 || uWindStrength < 0.01) return p;

    // Smooth asymptotic height response: zero at ground, gradual deflection aloft
    float factor = (height * height) / (height * height + 64.0);
    float time = uTime * uWindSpeed;
    float swayX = sin(time * 1.1 + p.y * 0.06) * uWindStrength * 0.22 * factor;
    float swayZ = cos(time * 0.85 + p.y * 0.06) * uWindStrength * 0.15 * factor;
    return vec3(p.x - swayX, p.y, p.z - swayZ);
}

// Lightweight procedural surface noise for organic bark and leaf textures
float fastNoise(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

struct HitInfo {
    float dist;
    float nodeType;   // 0 = root, 1 = stem/canopy, 2 = leaf
    float health;
    float isOwnPlant;
    float biomass;
};

// Distance field and anatomical property evaluation
HitInfo map(vec3 p) {
    vec3 q = applyWind(p);

    float minDist = 1e6;
    float blendNodeType = 0.0;
    float blendHealth = 1.0;
    float blendIsOwnPlant = 1.0;
    float blendBiomass = 5.0;

    float k = max(0.02, uSminBlendRadius);

    for (int i = 0; i < MAX_PRIMITIVES; i++) {
        if (i >= uPrimitiveCount) break;

        vec4 a_rA = texelFetch(uPrimTex, ivec2(0, i), 0);
        vec4 b_rB = texelFetch(uPrimTex, ivec2(1, i), 0);
        vec4 props = texelFetch(uPrimTex, ivec2(2, i), 0);
        vec4 flatData = texelFetch(uPrimTex, ivec2(3, i), 0);

        float d = sdOrganicSegment(q, a_rA.xyz, b_rB.xyz, a_rA.w, b_rB.w, flatData.x, flatData.yzw);

        if (i == 0) {
            minDist = d;
            blendNodeType = props.x;
            blendHealth = props.y;
            blendIsOwnPlant = props.z;
            blendBiomass = props.w;
        } else {
            // Crisp clean union for leaf foliage so leaves sit on branches without deforming
            // or subtracting from the distance field of branches or other leaves behind them (eliminates see-through holes)
            if (props.x >= 1.7 || blendNodeType >= 1.7) {
                if (d < minDist) {
                    minDist = d;
                    blendNodeType = props.x;
                    blendHealth = props.y;
                    blendIsOwnPlant = props.z;
                    blendBiomass = props.w;
                }
            } else {
                // Polynomial smooth minimum (smin) for continuous woody branches and root junctions
                float h = clamp(0.5 + 0.5 * (minDist - d) / k, 0.0, 1.0);
                minDist = mix(minDist, d, h) - k * h * (1.0 - h);
                blendNodeType = mix(blendNodeType, props.x, h);
                blendHealth = mix(blendHealth, props.y, h);
                blendIsOwnPlant = mix(blendIsOwnPlant, props.z, h);
                blendBiomass = mix(blendBiomass, props.w, h);
            }
        }
    }

    return HitInfo(minDist, blendNodeType, blendHealth, blendIsOwnPlant, blendBiomass);
}

// Central differences surface normal
vec3 calcNormal(vec3 p) {
    float eps = uRaymarchHitEpsilon;
    vec2 e = vec2(eps, -eps);
    return normalize(
        e.xyy * map(p + e.xyy).dist +
        e.yyx * map(p + e.yyx).dist +
        e.yxy * map(p + e.yxy).dist +
        e.xxx * map(p + e.xxx).dist
    );
}

// Inigo Quilez Ambient Occlusion (AO)
// Samples distance outward along the surface normal at multi-scale intervals.
// Captures realistic darkening in crevices, branch collars, and leaf axils with zero raymarching penalty.
float calcAO(vec3 p, vec3 n) {
    float occ = 0.0;
    float sca = 1.0;
    for (int i = 0; i < 4; i++) {
        float h = 0.02 + 0.12 * float(i) / 3.0;
        float d = map(p + h * n).dist;
        occ += max(0.0, h - d) * sca;
        sca *= 0.85;
    }
    return clamp(1.0 - 2.8 * occ, 0.15, 1.0);
}

void main() {
    if (uPrimitiveCount <= 0) {
        discard;
    }

    vec3 ro = uCameraPosition;
    vec3 rd = normalize(vWorldPos - ro);

    vec2 aabb = intersectAABB(ro, rd, uBoxMin, uBoxMax);
    if (aabb.y < aabb.x || aabb.y < 0.0) {
        discard;
    }

    float t = max(aabb.x, 0.0);
    float tMax = aabb.y + 0.6;
    bool hit = false;
    HitInfo hitInfo;

    for (int step = 0; step < 128; step++) {
        if (step >= uMaxRaymarchSteps || t > tMax) break;

        vec3 p = ro + rd * t;
        hitInfo = map(p);

        // Hit surface or stepped inside geometry:
        if (hitInfo.dist < uRaymarchHitEpsilon) {
            hit = true;
            break;
        }

        // Catch boundary grazing: if on the last step we are within 2.5cm of surface, count as a hit
        if (step == uMaxRaymarchSteps - 1 && hitInfo.dist < 0.025) {
            hit = true;
            break;
        }

        // Safe step scaling to guarantee sphere tracing convergence across thin leaves
        float stepFactor = hitInfo.dist > 0.6 ? 0.90 : 0.65;
        t += max(hitInfo.dist * stepFactor, uRaymarchHitEpsilon * 0.4);
    }

    if (!hit) {
        discard;
    }

    vec3 pHit = ro + rd * t;
    vec3 normal = calcNormal(pHit);

    // Botanical anatomical color continuum:
    // 0.0 = Subterranean Root, 0.5 = Embryonic Seed Coat, 1.0 = Woody Stem/Branch,
    // 1.5 = Apical Sprout/Petiole, 2.0 = Foliage Lamina
    vec3 rootCol = uRootColor;
    vec3 seedCol = uSeedColor;
    vec3 stemCol = uCanopyColor;
    vec3 sproutCol = vec3(0.48, 0.76, 0.22);
    vec3 leafCol = uLeafColor;

    vec3 baseColor;
    if (hitInfo.nodeType < 0.5) {
        baseColor = mix(rootCol, seedCol, smoothstep(0.0, 0.5, hitInfo.nodeType));
    } else if (hitInfo.nodeType < 1.0) {
        baseColor = mix(seedCol, stemCol, smoothstep(0.5, 1.0, hitInfo.nodeType));
    } else if (hitInfo.nodeType < 1.6) {
        baseColor = mix(stemCol, sproutCol, smoothstep(1.0, 1.6, hitInfo.nodeType));
    } else {
        baseColor = mix(sproutCol, leafCol, smoothstep(1.6, 2.0, hitInfo.nodeType));
    }

    // 3D Procedural anatomical surface details:
    if (hitInfo.nodeType > 1.6) {
        // LEAF BLADE: Translucent chlorophyll lamina + subtle midrib venation
        float leafTexture = (fastNoise(pHit * 6.0) - 0.5) * 0.12;
        baseColor = (baseColor + leafTexture);
    } else if (hitInfo.nodeType < 0.7) {
        // ROOT & SEED: Rich earthy bark grain and seed coat texture
        float barkTexture = (fastNoise(pHit * 4.0) - 0.5) * 0.18;
        baseColor *= (0.90 + barkTexture);
    } else {
        // STEM / TRUNK: Longitudinal wood fiber grain
        float fiber = sin(pHit.x * 16.0 + pHit.z * 16.0) * 0.10 + (fastNoise(pHit * 3.0) - 0.5) * 0.10;
        baseColor *= (0.90 + fiber);
    }

    // Health tint: natural autumn wither/desiccation, NOT chalky white/grey
    float health = clamp(hitInfo.health, 0.0, 1.0);
    vec3 witheredColor = vec3(0.42, 0.30, 0.16);
    float healthFactor = mix(1.0 - uHealthTintStrength * 0.7, 1.0, health);
    baseColor = mix(witheredColor, baseColor, healthFactor);

    // Mutation 2: Variegated foliage pigmentation
    if (hitInfo.nodeType > 1.6) {
        float varPattern = smoothstep(0.4, 0.6, sin(pHit.x * 10.0 + pHit.z * 10.0));
        baseColor = mix(baseColor, baseColor * vec3(1.35, 1.25, 0.65), varPattern * uMutation2Param * 0.45);
    }

    // Stylized naturalism lighting + Inigo Quilez Ambient Occlusion
    float ao = calcAO(pHit, normal);
    float NdotL = max(dot(normal, uSunDirection), 0.0);
    vec3 lit = baseColor * (0.28 * ao + 0.72 * NdotL * ao);

    // Leaves: Backlit chlorophyll transmission & waxy cuticle specular shine
    if (hitInfo.nodeType > 1.6) {
        // Translucent glow when looking toward light through leaf
        float backlight = pow(max(0.0, dot(-rd, uSunDirection)), 2.0) * 0.65;
        lit += leafCol * backlight * 1.5;

        // Waxy cuticle specular sheen
        vec3 halfVec = normalize(uSunDirection - rd);
        float leafSpec = pow(max(dot(normal, halfVec), 0.0), 28.0) * 0.50;
        lit += vec3(0.85, 1.0, 0.85) * leafSpec;
    } else if (hitInfo.nodeType > 0.7) {
        // Subtle branch subsurface transmission
        float sss = max(0.0, dot(-rd, uSunDirection)) * 0.20;
        lit += stemCol * sss;
    }

    // Rim lighting (fresnel)
    vec3 viewDir = -rd;
    float rim = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0) * 0.22;
    lit += vec3(0.2, 0.35, 0.2) * rim;

    // Mutation 0: Bioluminescent glow - only active if plant has bioluminescence
    if (uMutation0Param > 0.01) {
        float emissive = uMutation0Param * 0.25;
        // Organic soft moss/chlorophyll phosphorescence, NOT super saiyan neon blue
        vec3 glowColor = vec3(0.2, 0.75, 0.45);
        lit += glowColor * (emissive * (0.6 + 0.4 * sin(uTime * 2.0 + pHit.y * 0.5)));
    }

    // T02 Root Sight: highlight subterranean roots with distinctive light-white outline
    if (uRootSightEnabled && hitInfo.nodeType < 0.8) {
        float distFromCenter = distance(pHit, uRootSightSphereCenter);
        float insideCutaway = 1.0 - smoothstep(
            uRootSightSphereRadius * 0.85,
            uRootSightSphereRadius,
            distFromCenter
        );
        float highlightStrength = insideCutaway * uRootSightProgress;
        vec3 highlightColor = mix(uRivalRootHighlightColor, uOwnRootHighlightColor, hitInfo.isOwnPlant);
        lit = mix(lit, highlightColor, 0.70 * highlightStrength);

        // Distinctive crisp light-white / silver outline on player's own roots
        if (hitInfo.isOwnPlant > 0.5) {
            float rootRim = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.2);
            vec3 outlineColor = vec3(0.95, 0.98, 1.0); // crisp light white/silver
            lit = mix(lit, outlineColor, rootRim * 0.85 * uRootSightProgress);
            lit += outlineColor * (rootRim * 0.35 * uRootSightProgress);
        }
    }

    // Screen-space depth writing
    vec4 clipPos = projectionMatrix * viewMatrix * vec4(pHit, 1.0);
    float ndc = clipPos.z / clipPos.w;
    #ifdef USE_REVERSED_DEPTH_BUFFER
        float depthVal = 1.0 - (ndc * 0.5 + 0.5);
    #else
        float depthVal = ndc * 0.5 + 0.5;
    #endif

    // In Root Sight, pull player's own roots slightly forward in depth so they are seeable through the ground plane
    if (uRootSightEnabled && hitInfo.nodeType < 0.8 && hitInfo.isOwnPlant > 0.5 && pHit.y < 0.0) {
        depthVal -= 0.003 * uRootSightProgress;
    }
    gl_FragDepth = clamp(depthVal, 0.0, 1.0);

    fragColor = linearToOutputTexel(vec4(lit, 1.0));
}
`;

function mulberry32(a: number): () => number {
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PlantInstance {
  rootId: string;
  rootNode: PlantNodeData;
  plantNodes: PlantNodeData[];
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  texture: THREE.DataTexture;
  texData: Float32Array;
  primitiveCount: number;
  boxMin: THREE.Vector3;
  boxMax: THREE.Vector3;
  worldBoundingBox: THREE.Box3;
  center: THREE.Vector3;
}

/**
 * PlantRenderer
 * Renders player plants as unified organic living bodies using Raymarched
 * Signed Distance Fields (SDF) with polynomial smooth minimum (smin) blending.
 */
export class PlantRenderer {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private config: PlantRendererConfig;

  private boxGeometry: THREE.BoxGeometry;
  private plantInstances = new Map<string, PlantInstance>();
  private knownNodes = new Map<string, PlantNodeData>();

  private time = 0;
  private rootSightEnabled = false;
  private rootSightProgress = 0;
  private rootSightCenter = new THREE.Vector3();

  // Optimization: shared frustum and projection matrix for multi-plant culling
  private frustum = new THREE.Frustum();
  private projScreenMatrix = new THREE.Matrix4();

  constructor(
    _renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    config: Partial<PlantRendererConfig> = {},
  ) {
    this.scene = scene;
    this.camera = camera;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rootSightEnabled = this.config.rootSightEnabled;

    // Unit bounding box shared across all plant instances
    this.boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  }

  private createPlantInstance(rootId: string): PlantInstance {
    const width = 4;
    const height = MAX_PRIMITIVES;
    const texData = new Float32Array(width * height * 4);

    const texture = new THREE.DataTexture(
      texData,
      width,
      height,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    const material = new THREE.ShaderMaterial({
      vertexShader: organismVert,
      fragmentShader: organismFrag,
      glslVersion: THREE.GLSL3,
      side: THREE.BackSide,
      transparent: false,
      depthTest: true,
      depthWrite: true,
      uniforms: {
        uCameraPosition: { value: this.camera.position },
        uBoxMin: { value: new THREE.Vector3() },
        uBoxMax: { value: new THREE.Vector3() },
        uPrimitiveCount: { value: 0 },
        uPrimTex: { value: texture },
        uTime: { value: this.time },
        uSminBlendRadius: { value: this.config.sminBlendRadius },
        uMaxRaymarchSteps: { value: this.config.maxRaymarchSteps },
        uRaymarchHitEpsilon: { value: this.config.raymarchHitEpsilon },
        uWindStrength: { value: this.config.windStrength },
        uWindSpeed: { value: this.config.windSpeed },
        uHealthTintStrength: { value: this.config.healthTintStrength },
        uMutation0Param: { value: this.config.mutation0Param },
        uMutation1Param: { value: this.config.mutation1Param },
        uMutation2Param: { value: this.config.mutation2Param },
        uSunDirection: { value: new THREE.Vector3(0.5, 1.0, 0.5).normalize() },
        uSeedColor: { value: new THREE.Color(0x3e2312) },
        uRootColor: { value: new THREE.Color(0x5c4033) },
        uCanopyColor: { value: new THREE.Color(0x2d4f1e) },
        uLeafColor: { value: new THREE.Color(0x43b82a) },
        uRootSightEnabled: { value: this.rootSightEnabled },
        uRootSightSphereCenter: { value: this.rootSightCenter.clone() },
        uRootSightSphereRadius: { value: this.config.rootSightCutawayRadius },
        uRootSightProgress: { value: this.rootSightProgress },
        uOwnRootHighlightColor: { value: new THREE.Color(this.config.ownRootHighlightColor) },
        uRivalRootHighlightColor: { value: new THREE.Color(this.config.rivalRootHighlightColor) },
      },
    });

    const mesh = new THREE.Mesh(this.boxGeometry, material);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.scene.add(mesh);

    const instance: PlantInstance = {
      rootId,
      rootNode: {
        id: rootId,
        position: new THREE.Vector3(),
        type: 0,
        radius: 0.05,
        parentId: null,
        age: 0,
        health: 1,
        mutationFlags: 0,
        biomass: 10,
      },
      plantNodes: [],
      mesh,
      material,
      texture,
      texData,
      primitiveCount: 0,
      boxMin: new THREE.Vector3(),
      boxMax: new THREE.Vector3(),
      worldBoundingBox: new THREE.Box3(),
      center: new THREE.Vector3(),
    };

    this.plantInstances.set(rootId, instance);
    return instance;
  }

  /**
   * Updates all active plant node graphs, builds organic SDF primitives,
   * updates bounding volumes, and uploads texture data.
   */
  updatePlantData(nodes: PlantNodeData[]): void {
    const currentIds = new Set<string>();
    for (const node of nodes) {
      currentIds.add(node.id);
      this.knownNodes.set(node.id, {
        ...node,
        position: node.position.clone(),
      });
    }

    // Clean up removed nodes
    for (const id of this.knownNodes.keys()) {
      if (!currentIds.has(id)) {
        this.knownNodes.delete(id);
      }
    }

    if (this.knownNodes.size === 0) {
      this.rebuild();
      return;
    }

    // Build children mapping
    const childrenMap = new Map<string, PlantNodeData[]>();
    for (const node of this.knownNodes.values()) {
      if (node.parentId) {
        if (!childrenMap.has(node.parentId)) {
          childrenMap.set(node.parentId, []);
        }
        childrenMap.get(node.parentId)?.push(node);
      }
    }

    // Find roots of each connected tree
    const rootNodes: PlantNodeData[] = [];
    for (const node of this.knownNodes.values()) {
      if (!node.parentId || !this.knownNodes.has(node.parentId)) {
        rootNodes.push(node);
      }
    }

    const activeRootIds = new Set<string>();

    for (const root of rootNodes) {
      activeRootIds.add(root.id);
      let instance = this.plantInstances.get(root.id);
      if (!instance) {
        instance = this.createPlantInstance(root.id);
      }

      // Collect all nodes in this plant's tree
      const plantNodes: PlantNodeData[] = [];
      const queue: PlantNodeData[] = [root];
      const visited = new Set<string>([root.id]);

      while (queue.length > 0) {
        const curr = queue.shift();
        if (!curr) break;
        plantNodes.push(curr);
        const children = childrenMap.get(curr.id);
        if (children) {
          for (const ch of children) {
            if (!visited.has(ch.id)) {
              visited.add(ch.id);
              queue.push(ch);
            }
          }
        }
      }

      // Store current nodes for continuous growth animation
      instance.rootNode = root;
      instance.plantNodes = plantNodes;

      // Build primitives for this plant
      this.buildPlantPrimitives(instance, root, plantNodes);
    }

    // Dispose removed plant instances
    for (const [id, instance] of this.plantInstances.entries()) {
      if (!activeRootIds.has(id)) {
        this.scene.remove(instance.mesh);
        instance.texture.dispose();
        instance.material.dispose();
        this.plantInstances.delete(id);
      }
    }
  }

  private buildPlantPrimitives(
    instance: PlantInstance,
    root: PlantNodeData,
    nodes: PlantNodeData[],
  ): void {
    const texData = instance.texData;
    texData.fill(0);

    let primCount = 0;

    const boxMin = new THREE.Vector3(Infinity, Infinity, Infinity);
    const boxMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

    function includePoint(p: THREE.Vector3, radius: number): void {
      boxMin.x = Math.min(boxMin.x, p.x - radius);
      boxMin.y = Math.min(boxMin.y, p.y - radius);
      boxMin.z = Math.min(boxMin.z, p.z - radius);
      boxMax.x = Math.max(boxMax.x, p.x + radius);
      boxMax.y = Math.max(boxMax.y, p.y + radius);
      boxMax.z = Math.max(boxMax.z, p.z + radius);
    }

    function packPrimitive(
      a: THREE.Vector3,
      rA: number,
      b: THREE.Vector3,
      rB: number,
      nodeType: number,
      health: number,
      isOwnPlant: number,
      biomass: number,
      flatness: number,
      flatAxis: THREE.Vector3,
    ): void {
      if (primCount >= MAX_PRIMITIVES) return;
      const base = primCount * 16;

      // Texel 0: a.x, a.y, a.z, rA
      texData[base + 0] = a.x;
      texData[base + 1] = a.y;
      texData[base + 2] = a.z;
      texData[base + 3] = rA;

      // Texel 1: b.x, b.y, b.z, rB
      texData[base + 4] = b.x;
      texData[base + 5] = b.y;
      texData[base + 6] = b.z;
      texData[base + 7] = rB;

      // Texel 2: nodeType, health, isOwnPlant, biomass
      texData[base + 8] = nodeType;
      texData[base + 9] = health;
      texData[base + 10] = isOwnPlant;
      texData[base + 11] = biomass;

      // Texel 3: flatness, flatAxis.x, flatAxis.y, flatAxis.z
      texData[base + 12] = flatness;
      texData[base + 13] = flatAxis.x;
      texData[base + 14] = flatAxis.y;
      texData[base + 15] = flatAxis.z;

      includePoint(a, rA);
      includePoint(b, rB);
      primCount += 1;
    }

    const defaultAxis = new THREE.Vector3(0, 1, 0);

    // 1. Embryonic seed body resting directly ON the soil surface (y >= 0.01)
    // Sized botanically: 4-7cm acorn/pod, resting on top of ground (not halfway submerged)
    const seedRadius = Math.max(0.04, Math.min(0.07, root.radius * 0.45));
    const isOwn = root.isOwnPlant !== false ? 1.0 : 0.0;

    // Check if seed has sprouted: if root has children, seed coat splits
    const hasSprouted = nodes.some((n) => n.parentId === root.id && n.type >= 1);
    const nowMs = performance.now();
    const seedSpawn = root.spawnTime ?? nowMs - 5000;
    const seedAgeMs = nowMs - seedSpawn;
    const seedEase = Math.min(1.0, Math.max(0.2, seedAgeMs / 800));

    // When sprouted, seed splits into two distinct cotyledon halves (husk split)
    const splitFlatness = hasSprouted ? 1.55 : 1.25;

    const seedBottom = new THREE.Vector3(root.position.x, 0.01, root.position.z);
    const seedTop = new THREE.Vector3(
      root.position.x,
      0.01 + seedRadius * 1.8 * seedEase,
      root.position.z,
    );
    const seedAxis = new THREE.Vector3(0, 0, 1);
    packPrimitive(
      seedBottom,
      seedRadius * seedEase,
      seedTop,
      seedRadius * 0.8 * seedEase,
      0.5, // Seed coat tissue (nodeType 0.5)
      root.health,
      isOwn,
      root.biomass,
      splitFlatness, // Organic ovoid seed / split husk
      seedAxis,
    );

    // 2. Segments connecting parent to child & joints
    for (const node of nodes) {
      if (!node.parentId) continue;
      const parent = this.knownNodes.get(node.parentId);
      if (!parent) continue;

      // Real-time growth interpolation (0.9s smooth easing from parent outward)
      const spawnTime = node.spawnTime ?? nowMs - 5000;
      const elapsed = Math.max(0, nowMs - spawnTime);
      const rawT = Math.min(1.0, elapsed / 900);
      // Smoothstep easing for natural biological elongation
      const growthEase = rawT * rawT * (3.0 - 2.0 * rawT);

      const animNodePos = parent.position.clone().lerp(node.position, growthEase);

      const isNodeOwn = node.isOwnPlant !== false ? 1.0 : 0.0;
      const isBark = node.type >= 1 && (node.mutationFlags & 2) !== 0;
      const barkMult = isBark ? this.config.mutation1Param : 1.0;

      const rA = Math.max(0.02, parent.radius * barkMult);
      const targetRB = Math.max(0.015, node.radius * barkMult);
      // Child tip radius scales with growth
      const rB = Math.max(0.012, targetRB * Math.max(0.25, growthEase));
      const isLeafNode = node.type === 3;
      const segType = node.type === 0 ? 0.0 : isLeafNode ? 2.0 : 1.0;
      const avgHealth = (parent.health + node.health) * 0.5;
      const avgBiomass = (parent.biomass + node.biomass) * 0.5;
      const flatness = isLeafNode ? 3.5 : 1.0;

      // Swept tapered branch/root/leaf capsule
      packPrimitive(
        parent.position,
        rA,
        animNodePos,
        rB,
        segType,
        avgHealth,
        isNodeOwn,
        avgBiomass,
        flatness,
        defaultAxis,
      );

      // 3. Parametric Foliage / Leaves attached to canopy nodes (unfurl with growth ease)
      if (
        node.type >= 1 &&
        node.position.y > 0.3 &&
        this.config.leafCountPerNode > 0 &&
        growthEase > 0.15
      ) {
        const leafEase = Math.min(1.0, (growthEase - 0.15) / 0.85);
        const leafCount = this.config.leafCountPerNode;
        const hash = node.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));

        for (let l = 0; l < leafCount; l++) {
          const angle = (hash * goldenAngle + l * ((Math.PI * 2) / leafCount)) % (Math.PI * 2);
          const leafDir = new THREE.Vector3(
            Math.cos(angle) * 0.85,
            0.32,
            Math.sin(angle) * 0.85,
          ).normalize();
          const leafNormal = new THREE.Vector3(
            -Math.sin(angle) * 0.3,
            0.95,
            Math.cos(angle) * 0.3,
          ).normalize();

          const totalLength = this.config.leafSize * 0.85 * leafEase;
          const petioleLength = totalLength * 0.28;
          const bladeLength = totalLength * 0.72;

          // 1. Petiole (leaf stalk): delicate, slender cylindrical attachment
          const petioleStart = animNodePos.clone().addScaledVector(leafDir, rB * 0.4);
          const petioleEnd = petioleStart.clone().addScaledVector(leafDir, petioleLength);
          const petioleRadius = Math.max(0.008, Math.min(0.018, rB * 0.18 * leafEase));

          packPrimitive(
            petioleStart,
            petioleRadius,
            petioleEnd,
            petioleRadius * 0.85,
            1.4, // Transition tissue (petiole stalk)
            node.health,
            isNodeOwn,
            node.biomass,
            1.0, // Petiole is cylindrical (round)
            defaultAxis,
          );

          // 2. Leaf blade body: slender elliptical lancet/ovate lamina with sharp pointed tip
          const bladeMid = petioleEnd.clone().addScaledVector(leafDir, bladeLength * 0.45);
          const bladeTip = petioleEnd.clone().addScaledVector(leafDir, bladeLength);
          // Realistic width: 12 - 20cm max width, gracefully proportional
          const bladeMaxRadius = Math.max(0.035, this.config.leafSize * 0.16 * leafEase);

          // Blade segment 1: expanding from petiole into graceful elliptic leaf blade
          packPrimitive(
            petioleEnd,
            petioleRadius * 1.0,
            bladeMid,
            bladeMaxRadius,
            2.0, // Leaf tissue
            node.health,
            isNodeOwn,
            node.biomass,
            5.2, // High flatness: thin natural lamina
            leafNormal,
          );

          // Blade segment 2: tapering from elliptic body to pointed apex
          packPrimitive(
            bladeMid,
            bladeMaxRadius,
            bladeTip,
            0.006, // Razor sharp pointed leaf tip
            2.0, // Leaf tissue
            node.health,
            isNodeOwn,
            node.biomass,
            4.8, // Flat blade
            leafNormal,
          );
        }
      }
    }

    instance.primitiveCount = primCount;
    instance.texture.needsUpdate = true;

    // Apply bounding box padding proportional to the organism's size
    const hasLeaves = primCount > 4;
    const leafPad = hasLeaves ? this.config.leafSize * 0.75 : 0.0;
    const padding = Math.max(0.25, Math.min(1.2, this.config.sminBlendRadius * 2.0 + leafPad));
    boxMin.subScalar(padding);
    boxMax.addScalar(padding);

    // Enforce tight minimum box dimensions around small seedlings
    if (boxMax.x - boxMin.x < 0.3) {
      boxMin.x -= 0.15;
      boxMax.x += 0.15;
    }
    if (boxMax.y - boxMin.y < 0.3) {
      boxMin.y -= 0.15;
      boxMax.y += 0.15;
    }
    if (boxMax.z - boxMin.z < 0.3) {
      boxMin.z -= 0.15;
      boxMax.z += 0.15;
    }

    instance.boxMin.copy(boxMin);
    instance.boxMax.copy(boxMax);
    instance.worldBoundingBox.set(boxMin, boxMax);

    // Update mesh transform to tightly fit the plant
    const center = new THREE.Vector3().addVectors(boxMin, boxMax).multiplyScalar(0.5);
    const size = new THREE.Vector3().subVectors(boxMax, boxMin);

    instance.center.copy(center);
    instance.mesh.position.copy(center);
    instance.mesh.scale.copy(size);
    instance.mesh.updateMatrixWorld(true);

    // Update uniforms
    const uniforms = instance.material.uniforms;
    uniforms.uBoxMin.value.copy(boxMin);
    uniforms.uBoxMax.value.copy(boxMax);
    uniforms.uPrimitiveCount.value = primCount;
    uniforms.uSminBlendRadius.value = this.config.sminBlendRadius;
    uniforms.uMaxRaymarchSteps.value = this.config.maxRaymarchSteps;
    uniforms.uRaymarchHitEpsilon.value = this.config.raymarchHitEpsilon;
  }

  /**
   * Per-frame animation, camera culling, and 3-Tier Distance LOD.
   * Enables rendering thousands of plants smoothly at 60 FPS by
   * frustum culling off-screen organisms and scaling raymarch budgets.
   */
  update(deltaTime: number): void {
    this.time += deltaTime;

    // 1. Compute view frustum for GPU culling
    this.projScreenMatrix.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

    const camPos = this.camera.position;

    const now = performance.now();

    for (const instance of this.plantInstances.values()) {
      if (instance.primitiveCount <= 0) {
        instance.mesh.visible = false;
        continue;
      }

      // 0. Active Growth Animation Rebuild:
      // If any node in this plant's graph was spawned in the last 950ms,
      // re-pack primitives so the growth lerp smoothly animates at 60 FPS
      const hasActiveGrowth =
        instance.plantNodes.some((n) => {
          if (!n.spawnTime) return false;
          return now - n.spawnTime < 950;
        }) ||
        (instance.rootNode.spawnTime && now - instance.rootNode.spawnTime < 950);

      if (hasActiveGrowth) {
        this.buildPlantPrimitives(instance, instance.rootNode, instance.plantNodes);
      }

      // Frustum culling: skip raymarching if plant is outside view frustum.
      // Crucial: worldBoundingBox encompasses the full span of all branches and leaves,
      // ensuring that if a player's base is behind the camera but its canopy/branches
      // reach into the screen, the bounding box intersects the frustum and remains 100% visible!
      if (!this.frustum.intersectsBox(instance.worldBoundingBox)) {
        instance.mesh.visible = false;
        continue;
      }

      // Distance from camera to plant center
      const dist = camPos.distanceTo(instance.center);

      // Distance Culling: beyond maximum LOD horizon (200m), plant is not raymarched
      if (dist > this.config.l2Distance) {
        instance.mesh.visible = false;
        continue;
      }

      instance.mesh.visible = true;

      const uniforms = instance.material.uniforms;
      uniforms.uTime.value = this.time;
      uniforms.uCameraPosition.value.copy(camPos);
      uniforms.uSminBlendRadius.value = this.config.sminBlendRadius;
      uniforms.uWindStrength.value = this.config.windStrength;
      uniforms.uWindSpeed.value = this.config.windSpeed;
      uniforms.uHealthTintStrength.value = this.config.healthTintStrength;
      uniforms.uMutation0Param.value = this.config.mutation0Param;
      uniforms.uMutation1Param.value = this.config.mutation1Param;
      uniforms.uMutation2Param.value = this.config.mutation2Param;

      // 3-Tier Dynamic Raymarching LOD:
      if (dist > this.config.l1Distance) {
        // Tier 2: Far (90m - 200m) - ultra-fast coarse silhouette (14 steps)
        uniforms.uMaxRaymarchSteps.value = 14;
        uniforms.uRaymarchHitEpsilon.value = 0.022;
      } else if (dist > this.config.l0Distance) {
        // Tier 1: Mid (35m - 90m) - balanced raymarching (24 steps)
        uniforms.uMaxRaymarchSteps.value = 24;
        uniforms.uRaymarchHitEpsilon.value = 0.012;
      } else {
        // Tier 0: Near (0m - 35m) - full photorealistic detail (48 steps)
        uniforms.uMaxRaymarchSteps.value = this.config.maxRaymarchSteps;
        uniforms.uRaymarchHitEpsilon.value = this.config.raymarchHitEpsilon;
      }
    }
  }

  /**
   * T02 Root Sight: updates subterranean highlight transition on all plants.
   */
  setRootSightState(enabled: boolean, progress: number, center: THREE.Vector3): void {
    this.rootSightEnabled = enabled;
    this.rootSightProgress = progress;
    this.rootSightCenter.copy(center);

    for (const instance of this.plantInstances.values()) {
      const uniforms = instance.material.uniforms;
      uniforms.uRootSightEnabled.value = enabled;
      uniforms.uRootSightProgress.value = progress;
      uniforms.uRootSightSphereCenter.value.copy(center);
      uniforms.uRootSightSphereRadius.value = this.config.rootSightCutawayRadius;
    }
  }

  setConfig(config: Partial<PlantRendererConfig>): void {
    this.config = { ...this.config, ...config };
    this.rootSightEnabled = this.config.rootSightEnabled;

    for (const instance of this.plantInstances.values()) {
      const uniforms = instance.material.uniforms;
      uniforms.uSminBlendRadius.value = this.config.sminBlendRadius;
      uniforms.uMaxRaymarchSteps.value = this.config.maxRaymarchSteps;
      uniforms.uRaymarchHitEpsilon.value = this.config.raymarchHitEpsilon;
      uniforms.uWindStrength.value = this.config.windStrength;
      uniforms.uWindSpeed.value = this.config.windSpeed;
      uniforms.uHealthTintStrength.value = this.config.healthTintStrength;
      uniforms.uMutation0Param.value = this.config.mutation0Param;
      uniforms.uMutation1Param.value = this.config.mutation1Param;
      uniforms.uMutation2Param.value = this.config.mutation2Param;
      uniforms.uRootSightSphereRadius.value = this.config.rootSightCutawayRadius;
      uniforms.uOwnRootHighlightColor.value.set(this.config.ownRootHighlightColor);
      uniforms.uRivalRootHighlightColor.value.set(this.config.rivalRootHighlightColor);
    }
  }

  getConfig(): PlantRendererConfig {
    return { ...this.config };
  }

  rebuild(): void {
    for (const instance of this.plantInstances.values()) {
      this.scene.remove(instance.mesh);
      instance.texture.dispose();
      instance.material.dispose();
    }
    this.plantInstances.clear();
    this.knownNodes.clear();
  }

  /**
   * Deterministic botanical test tree for development and visual inspection.
   */
  generateTestPlant(seed?: number): PlantNodeData[] {
    const nodes: PlantNodeData[] = [];
    const rng = mulberry32(seed ?? 12345);

    const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ~137.5°
    const MURRAY_EXPONENT = 3;
    const TAPER_RATE = 0.86;
    const BRANCH_ANGLE_FROM_VERTICAL = 0.52;
    const ROOT_BRANCH_ANGLE = 0.58;
    const INTERNODE_LENGTH_BASE = 1.8;
    const ROOT_INTERNODE_LENGTH_BASE = 1.4;

    const primaryBranchCount = 3 + Math.floor(rng() * 2);
    const trunkSegments = 9 + Math.floor(rng() * 3);

    function murrayChildRadius(parentRadius: number, childCount: number, index: number): number {
      const equalShare = parentRadius / childCount ** (1 / MURRAY_EXPONENT);
      return index === 0 ? equalShare * 1.15 : equalShare * 0.85;
    }

    function createNode(
      id: string,
      position: THREE.Vector3,
      type: number,
      radius: number,
      parentId: string | null,
      order: number,
      distanceFromBase: number,
    ): PlantNodeData {
      const age = Math.max(1, 20 - order * 4 - distanceFromBase * 0.5);
      const health = Math.max(0.5, 0.95 - order * 0.06 - distanceFromBase * 0.01);
      const biomass = radius * radius * 10;
      return {
        id,
        position,
        type,
        radius: Math.max(0.02, radius),
        parentId,
        age,
        health,
        mutationFlags: 0,
        biomass,
        isOwnPlant: true,
      };
    }

    // Taproot (slender, organic, fibrous subterranean anchor)
    const taprootRadius = 0.12;
    const taprootSegments = 6;
    const taprootId = 'root_tap_0';
    let prevRootId = taprootId;

    nodes.push(createNode(taprootId, new THREE.Vector3(0, 0, 0), 0, taprootRadius, null, 0, 0));

    for (let i = 0; i < taprootSegments; i++) {
      const depth = -(i + 1) * ROOT_INTERNODE_LENGTH_BASE;
      const radius = Math.max(0.018, taprootRadius * 0.82 ** (i + 1));
      const segId = `root_tap_${i + 1}`;
      nodes.push(
        createNode(segId, new THREE.Vector3(0, depth, 0), 0, radius, prevRootId, 0, i + 1),
      );
      prevRootId = segId;
    }

    // Lateral roots (slender fibrous offshoots)
    for (let i = 0; i < 4; i++) {
      const attachSegment = Math.min(taprootSegments - 1, i + 1);
      const attachId = `root_tap_${attachSegment}`;
      const attachDepth = -attachSegment * ROOT_INTERNODE_LENGTH_BASE;
      const parentRadius = Math.max(0.02, taprootRadius * 0.82 ** attachSegment);

      const angle = i * GOLDEN_ANGLE;
      const lat1Radius = Math.max(0.015, murrayChildRadius(parentRadius, 2, 1) * 0.65);
      const lat1Id = `root_lat_${i}_1`;
      const lat1Length = ROOT_INTERNODE_LENGTH_BASE * 1.5;

      nodes.push(
        createNode(
          lat1Id,
          new THREE.Vector3(
            Math.cos(angle) * Math.sin(ROOT_BRANCH_ANGLE) * lat1Length,
            attachDepth - Math.cos(ROOT_BRANCH_ANGLE) * lat1Length,
            Math.sin(angle) * Math.sin(ROOT_BRANCH_ANGLE) * lat1Length,
          ),
          0,
          lat1Radius,
          attachId,
          1,
          attachSegment + 1,
        ),
      );
    }

    // Trunk
    const trunkRadius = 0.35;
    const trunkId = 'stem_trunk_0';
    nodes.push(createNode(trunkId, new THREE.Vector3(0, 0.6, 0), 1, trunkRadius, taprootId, 0, 0));
    let prevTrunkId = trunkId;
    let trunkHeight = 0.6;

    for (let i = 0; i < trunkSegments; i++) {
      const segLength = INTERNODE_LENGTH_BASE * (1.0 - i * 0.04);
      trunkHeight += segLength;
      const radius = trunkRadius * TAPER_RATE ** (i + 1);
      const segId = `stem_trunk_${i + 1}`;
      nodes.push(
        createNode(segId, new THREE.Vector3(0, trunkHeight, 0), 1, radius, prevTrunkId, 0, i + 1),
      );
      prevTrunkId = segId;
    }

    // Primary branches
    for (let b = 0; b < primaryBranchCount; b++) {
      const attachIndex = 2 + Math.floor((b / primaryBranchCount) * (trunkSegments - 3));
      const attachId = `stem_trunk_${attachIndex}`;
      const attachNode = nodes.find((n) => n.id === attachId);
      if (!attachNode) continue;
      const attachHeight = attachNode.position.y;
      const parentRadius = trunkRadius * TAPER_RATE ** (attachIndex + 1);

      const branchAngle = b * GOLDEN_ANGLE;
      const branch1Radius = murrayChildRadius(parentRadius, 2, 1);
      const branch1Length = INTERNODE_LENGTH_BASE * 1.8;
      const branch1Id = `branch_${b}_1`;

      nodes.push(
        createNode(
          branch1Id,
          new THREE.Vector3(
            Math.cos(branchAngle) * Math.sin(BRANCH_ANGLE_FROM_VERTICAL) * branch1Length,
            attachHeight + Math.cos(BRANCH_ANGLE_FROM_VERTICAL) * branch1Length,
            Math.sin(branchAngle) * Math.sin(BRANCH_ANGLE_FROM_VERTICAL) * branch1Length,
          ),
          1,
          branch1Radius,
          attachId,
          1,
          attachIndex + 1,
        ),
      );
    }

    return nodes;
  }

  dispose(): void {
    this.rebuild();
    this.boxGeometry.dispose();
  }
}

export default PlantRenderer;
