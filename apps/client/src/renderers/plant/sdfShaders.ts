/**
 * GLSL for the C02 raymarched SDF organism.
 *
 * The shader sources live apart from the renderer so the uniform names, the
 * buffer layout and the code that reads them are reviewable side by side with
 * `sdfBuffers.ts`. Nothing here decides anything: it is the drawing program.
 */

import { GLSL_ATMOSPHERE } from '../environment/atmosphere.js';

/** Fullscreen-quad vertex shader. */
export const SDF_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

/**
 * Raymarching fragment shader with organic fusion.
 *
 * Implements:
 * - Capsule SDF for stems/branches/roots
 * - Ellipsoid SDF for seeds/flowers
 * - Disk SDF for leaves/cotyledons
 * - Cone SDF for flowers/spore sacs
 * - Smooth minimum (smin) blending for organic fusion
 * - Murray's law tapering (baked into the uploaded radii)
 * - Root Sight aura
 * - Emergence animation
 */
export const SDF_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec2 vUv;

// Fragment output
layout(location = 0) out vec4 outColor;

// Uniforms
uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uCameraPos;
uniform vec3 uCameraDir;
uniform vec3 uCameraUp;
uniform float uFov;
uniform float uAspect;
uniform float uNear;
uniform float uFar;
uniform int uMaxSteps;
uniform float uHitEpsilon;
uniform float uSminRadius;
uniform float uWindStrength;
uniform float uWindSpeed;
uniform float uWindTime;
uniform int uSegmentCount;
uniform int uNodeCount;
uniform sampler2D uSegments;
uniform sampler2D uNodes;
// Root Sight in this pass is the aura alone. The old cutaway uniforms
// (uRootSightCutawayRadius, uRootSightSoilOpacity, uRootSightRadius) were never
// read by any line of this shader; the soil shader owns the hole, and this pass
// owns the root glow. Two dead cutaway implementations with their own hardcoded
// defaults (50 m / 0.3 opacity) could only drift from the real one.
uniform vec3 uOwnRootHighlightColor;
uniform vec3 uRivalRootHighlightColor;
// Root Sight SDF aura
uniform bool uRootSightAuraEnabled;
uniform int uRootAuraNodeCount;
uniform sampler2D uRootAuraTex;
uniform float uRootAuraRadius;
uniform float uEmergenceProgress;
uniform float uEmergenceDuration;
uniform float uHealthTintStrength;
uniform float uMutation0; // glow strength (bioluminescence, photic nodes)
uniform float uMutation1; // bark scale (>1 thickens and darkens)
uniform float uMutation2; // variegation strength
uniform vec3 uMutationTint; // whole-organism pigment tint (1,1,1 = none)
uniform bool uPhotosynthesisViz;
uniform bool uWaterFlowViz;
uniform bool uNutrientFlowViz;
uniform float uBoundingBoxPadding;
// Sun lighting
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
// AL-04: the shared atmosphere model. Plants fade into the same air the ground
// and the sky use instead of their own squared-exponential fog.
uniform vec3 uAtmoExtinction;
uniform float uAtmoScaleHeight;
uniform float uAtmoSunPhaseG;
uniform float uAtmoInScatter;
uniform float uAtmoHorizonBoost;
${GLSL_ATMOSPHERE}

// Segment data layout (7 vec4 per segment), produced by packSegments():
// 0: p0.x, p0.y, p0.z, r0
// 1: p1.x, p1.y, p1.z, r1
// 2: color.r, color.g, color.b, primitive
// 3: growthProgress, spawnTime, layer, isOwnPlant
// 4: dir.x, dir.y, dir.z, nodeTypeLength (unused by this shader)
// 5-6: reserved

// Node data layout (4 vec4 per node), produced by packNodes():
// 0: position.x, position.y, position.z, radius
// 1: color.r, color.g, color.b, primitive
// 2: growthProgress, spawnTime, layer, isOwnPlant
// 3: nodeTypeCode, reserved

#define PI 3.14159265359
#define SMIN_K 0.5

// Smooth minimum for organic blending
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// SDF-based unified root aura sampling
// Blends individual root node capsules into one continuous volume using smooth minimum
float sampleRootAuraSDF(vec3 worldPos) {
  if (!uRootSightAuraEnabled || uRootAuraNodeCount == 0) {
    return 0.0;
  }

  int count = min(uRootAuraNodeCount, 64);
  float sdfDist = 1000.0;
  float auraRadius = uRootAuraRadius;

  for (int i = 0; i < 64; i++) {
    if (i >= count) break;
    vec2 texCoord = vec2((float(i) + 0.5) / 64.0, 0.5);
    vec4 nodeData = texture2D(uRootAuraTex, texCoord);
    vec3 nodePos = nodeData.xyz;
    float valid = nodeData.w;

    if (valid < 0.5) continue;

    // Per-node spherical aura: a dynamic glow around each individual root node
    // or underground growth segment only - never the whole underground system.
    float d = length(worldPos - nodePos) - auraRadius;

    // Smooth minimum (smin) to blend adjacent auras softly
    float k = auraRadius * 0.3;
    float h = clamp(0.5 + 0.5 * (d - sdfDist) / k, 0.0, 1.0);
    sdfDist = mix(d, sdfDist, h) - k * h * (1.0 - h);
  }

  // Convert SDF distance to strength (1 at surface, 0 at radius)
  float strength = 1.0 - smoothstep(0.0, auraRadius, max(sdfDist, 0.0));
  return strength;
}

// SDF: Capsule (tapered)
float sdCapsule(vec3 p, vec3 a, vec3 b, float ra, float rb) {
  vec3 ba = b - a;
  vec3 pa = p - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  float r = mix(ra, rb, h);
  return length(pa - ba * h) - r;
}

// SDF: Ellipsoid
float sdEllipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / k1;
}

// SDF: Disk (thin leaf)
float sdDisk(vec3 p, float r, float h) {
  vec2 d = vec2(length(p.xz) - r, abs(p.y) - h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

// SDF: Cone
float sdCone(vec3 p, float r, float h) {
  vec2 q = vec2(length(p.xz), p.y);
  float k1 = h / r;
  float k2 = 1.0 / sqrt(1.0 + k1 * k1);
  vec2 w = q - vec2(r, h) * clamp((q.x * k1 - q.y) / (r * k1 * k1 + h), 0.0, 1.0);
  return length(max(vec2(w.x, 0.0), w)) * sign(max(w.x, w.y));
}

// Wind displacement
vec3 windDisplacement(vec3 p, float time, float strength, float speed, vec3 dir) {
  float freq = 2.0;
  float phase = time * speed + p.y * 3.0;
  float amp = strength * (1.0 - smoothstep(0.0, 10.0, p.y)) * 0.1;
  vec3 perp = normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
  return perp * sin(phase) * amp * (1.0 - p.y * 0.05);
}

// Get segment data from texture (1D row, 7 texels per segment)
vec4 getSegment(int index, int field) {
  int texel = index * 7 + field;
  return texelFetch(uSegments, ivec2(texel, 0), 0);
}

// Get node data from texture (1D row, 4 texels per node)
vec4 getNode(int index, int field) {
  int texel = index * 4 + field;
  return texelFetch(uNodes, ivec2(texel, 0), 0);
}

// Main SDF scene function
float map(vec3 p) {
  float dist = 1000.0;
  bool hitOwnPlant = false;
  bool hitRivalPlant = false;

  // Raymarch through segments
  for (int i = 0; i < 2000; i++) {
    if (i >= uSegmentCount) break;

    vec4 seg0 = getSegment(i, 0); // p0, r0
    vec4 seg1 = getSegment(i, 1); // p1, r1
    vec4 seg2 = getSegment(i, 2); // color, primitive
    vec4 seg3 = getSegment(i, 3); // growthProgress, spawnTime, layer, isOwnPlant
    vec4 seg4 = getSegment(i, 4); // dir, nodeTypeHash

    float growth = seg3.x;
    if (growth < 0.01) continue;

    vec3 p0 = seg0.xyz;
    vec3 p1 = seg1.xyz;
    float r0 = seg0.w;
    float r1 = seg1.w;
    int primitive = int(seg2.w);
    bool isOwn = seg3.w > 0.5;

    // Apply growth progress scaling
    float prog = growth;
    vec3 gp0 = p0;
    vec3 gp1 = mix(p0, p1, prog);
    float gr0 = r0;
    float gr1 = mix(r0, r1, prog);

    // Apply wind
    vec3 windDir = normalize(seg4.xyz);
    gp0 += windDisplacement(gp0, uWindTime, uWindStrength, uWindSpeed, windDir);
    gp1 += windDisplacement(gp1, uWindTime, uWindStrength, uWindSpeed, windDir);

    float d = 1000.0;
    if (primitive == 0) { // CAPSULE
      d = sdCapsule(p, gp0, gp1, gr0, gr1);
    } else if (primitive == 1) { // ELIPSOID
      vec3 center = (gp0 + gp1) * 0.5;
      vec3 r = vec3(gr0, length(gp1 - gp0) * 0.5, gr0);
      d = sdEllipsoid(p - center, r);
    } else if (primitive == 2) { // DISK
      vec3 center = (gp0 + gp1) * 0.5;
      mat3 rot = mat3(vec3(1,0,0), vec3(0,1,0), vec3(0,0,1));
      d = sdDisk((p - center) * rot, gr0, 0.02);
    } else if (primitive == 3) { // CONE
      vec3 center = (gp0 + gp1) * 0.5;
      float h = length(gp1 - gp0);
      d = sdCone(p - center, gr0, h);
    }

    // Organic fusion with smooth minimum
    if (dist > 1000.0) {
      dist = d;
      hitOwnPlant = isOwn;
      hitRivalPlant = !isOwn;
    } else {
      float k = uSminRadius * 0.5;
      dist = smin(dist, d, k);
      hitOwnPlant = hitOwnPlant || isOwn;
      hitRivalPlant = hitRivalPlant || !isOwn;
    }
    // Early exit: once we are within hit epsilon of a surface, no remaining
    // segment can materially change the march distance, so stop scanning.
    if (dist <= uHitEpsilon) break;
  }

  // Nodes for junctions and endpoints
  for (int i = 0; i < 2000; i++) {
    if (i >= uNodeCount) break;

    vec4 node0 = getNode(i, 0); // position, radius
    vec4 node1 = getNode(i, 1); // color, primitive
    vec4 node2 = getNode(i, 2); // growthProgress, spawnTime, layer, isOwnPlant
    vec4 node3 = getNode(i, 3); // reserved: x = nodeTypeCode

    float growth = node2.x;
    if (growth < 0.01) continue;

    vec3 pos = node0.xyz;
    float r = node0.w * growth;
    int primitive = int(node1.w);
    bool isOwn = node2.w > 0.5;
    float nodeTypeCode = node3.x;

    float d = 1000.0;
    if (primitive == 0) { // CAPSULE - sphere at junction
      d = length(p - pos) - r;
    } else if (primitive == 1) { // ELIPSOID
      if (nodeTypeCode > 0.5) {
        // Seed: closed rounded ovoid resting on the soil, matching the mesh
        // renderer. No cone/teardrop silhouette.
        d = sdEllipsoid(p - pos, vec3(r * 1.05, r * 1.35, r * 1.05));
      } else {
        d = sdEllipsoid(p - pos, vec3(r));
      }
    } else if (primitive == 2) { // DISK
      d = sdDisk(p - pos, r, 0.02);
    } else if (primitive == 3) { // CONE
      d = sdCone(p - pos, r, r * 2.0);
    }

    // Blend with existing
    if (dist > 1000.0) {
      dist = d;
      hitOwnPlant = isOwn;
      hitRivalPlant = !isOwn;
    } else {
      float k = uSminRadius * 0.5;
      dist = smin(dist, d, k);
      hitOwnPlant = hitOwnPlant || isOwn;
      hitRivalPlant = hitRivalPlant || !isOwn;
    }
    // Early exit: once we are within hit epsilon of a surface, stop scanning
    // remaining nodes since the raymarch will terminate on this step anyway.
    if (dist <= uHitEpsilon) break;
  }

  // Root Sight: the aura is per node, applied as a glow around each individual
  // root/underground node. There is no global cutaway sphere here.
  return dist;
}

// Raymarching
vec3 raymarch(vec3 ro, vec3 rd) {
  float t = uNear;
  float d = 0.0;

  for (int i = 0; i < 128; i++) {
    if (i >= uMaxSteps) break;
    vec3 p = ro + rd * t;
    d = map(p);
    if (d < uHitEpsilon) break;
    t += d;
    if (t > uFar) break;
  }

  return ro + rd * t;
}

// Normal calculation
vec3 calcNormal(vec3 p) {
  float eps = 0.001;
  vec2 h = vec2(eps, 0);
  return normalize(vec3(
    map(p + h.xyy) - map(p - h.xyy),
    map(p + h.yxy) - map(p - h.yxy),
    map(p + h.yyx) - map(p - h.yyx)
  ));
}

// Main
void main() {
  // Camera ray
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  float aspect = uResolution.x / uResolution.y;
  vec3 rd = normalize(vec3(uv.x * aspect, uv.y, -1.0 / tan(uFov * 0.5)));
  rd = rd.x * normalize(cross(uCameraUp, uCameraDir)) + rd.y * uCameraUp + rd.z * uCameraDir;

  vec3 ro = uCameraPos;

  // Raymarch
  vec3 p = raymarch(ro, rd);
  float d = map(p);

  // Colour of a ray that misses: transparent, so it is only a fill value.
  vec3 bgColor = vec3(0.08, 0.10, 0.06);
  vec3 col = bgColor;
  float alpha = 0.0;

  if (d < uHitEpsilon) {
    // Hit plant - calculate normal and lighting
    vec3 n = calcNormal(p);

    // Simple lighting
    vec3 lightDir = normalize(uSunDir);
    float diff = max(dot(n, lightDir), 0.0);
    float amb = 0.3;
    vec3 lightColor = uSunColor * uSunIntensity;

    // Determine color based on hit type
    if (p.y < 0.0) {
      col = vec3(0.55, 0.40, 0.28) * (amb + diff * 0.7); // root
    } else if (p.y < 2.0) {
      col = vec3(0.45, 0.30, 0.20) * (amb + diff * 0.8); // stem
    } else {
      col = vec3(0.20, 0.65, 0.15) * (amb + diff * 0.9); // leaves
    }

    // Apply light color
    col *= lightColor;

    // T04 signatures (ADR-054). The fallback has one plant-wide signature, so
    // these three terms carry the whole look: pigment tint, bark, variegation,
    // and a soft emissive glow for the luminous signatures.
    col *= uMutationTint;
    col = mix(col, col * vec3(0.72, 0.66, 0.58), clamp((uMutation1 - 1.0) * 2.0, 0.0, 1.0));
    col *= 1.0 + uMutation2 * 0.45 * sin(p.y * 7.0 + p.x * 5.0);
    col += vec3(0.10, 0.42, 0.46) * uMutation0 * (0.45 + 0.55 * diff);

    // Emergence animation
    if (uEmergenceProgress < 1.0) {
      float emergeAlpha = smoothstep(0.0, 1.0, uEmergenceProgress);
      float yProgress = smoothstep(-5.0, 10.0, p.y);
      col *= emergeAlpha * yProgress;
    }

    alpha = 1.0;
  }

  // AL-04: the same air the ground uses, applied in linear space before the
  // gamma conversion. Missed rays stay transparent and take no fog.
  if (alpha > 0.0) {
    vec3 toFragment = p - uCameraPos;
    float dist = length(toFragment);
    vec3 viewDir = dist > 1e-4 ? toFragment / dist : normalize(uCameraDir);
    col = atmoApplyRay(
      col,
      viewDir,
      normalize(uSunDir),
      dist,
      max(0.0, uCameraPos.y),
      max(0.0, p.y)
    );
  }

  // Gamma correction
  col = pow(col, vec3(1.0/2.2));

  outColor = vec4(col, alpha);
}
`;
