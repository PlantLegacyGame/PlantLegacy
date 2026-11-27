/**
 * The planet as a world, seen from above rather than from the soil.
 *
 * The ground is one soil shader on a 100 km sphere. Its detail is authored at
 * plot scale - a metre of clod, a wet patch, a footprint - so from 50 km every
 * square metre aliases into the same brown and the body reads as a painted ball.
 * That is the honest result of asking a plot shader about a planet, and it was
 * the visible gap once the camera could leave the ground: an orbital view with
 * no land cover, no terminator and no air.
 *
 * This shell is the same sphere, two metres above it, drawn only when the eye is
 * high enough that the play patch is subpixel. It paints what a world has at
 * that size: soil provinces, vegetation and bare rock, polar frost, a soft
 * day/night line from the sun, a cloud veil with its shadow on the ground, and
 * the bright band of air at the limb. It is scenery: the simulation never reads
 * it, and the shell is invisible at every altitude where a plant is on screen.
 *
 * Colours come from the caller, which reads them from the palette like the
 * ground does: the orbital world is the same world at another scale, not a
 * second art direction. Taking them as arguments keeps this module free of the
 * boot-time palette and testable without one.
 *
 * Two rules keep it the same world rather than a cousin of it. The vegetation is
 * mixed at the strength the ground's own land cover uses (a lichen wash over
 * soil, not a forest), because the play area is desert with pale growth on it
 * and the first version of this shell painted green continents that no plant in
 * the game grows on. And the cloud veil follows the *weather* the player is
 * standing in: clear air means a bare planet, and only an overcast or a storm
 * puts cloud on the disc. A permanent white mottle over a world that never
 * rained was the other thing that made orbit look like a different planet.
 */
import * as THREE from 'three';

/**
 * Below this altitude the welded far-relief globe is the readable surface, so
 * real ground wins: the planet view at three radii must not be painted over by
 * the smooth shell. The shell is only for true orbit, where a 1.5 km triangle
 * is smaller than a pixel.
 */
export const ORBITAL_SHELL_FADE_START_M = 1_000_000;
/** Above this altitude the patch is subpixel and the shell is fully opaque. */
export const ORBITAL_SHELL_FADE_END_M = 1_500_000;

/**
 * How much of the orbital face to show at an eye altitude, 0..1.
 *
 * A smoothstep rather than a cut: a hard switch would pop the whole planet's
 * colour in one frame while climbing. The band is wide enough (25-60 km) that a
 * normal climb crosses it over several seconds, and low enough that the play
 * patch is already smaller than a pixel when the shell takes over.
 */
export function orbitalShellFadeForAltitude(altitudeM: number): number {
  if (!Number.isFinite(altitudeM)) return 0;
  if (altitudeM <= ORBITAL_SHELL_FADE_START_M) return 0;
  if (altitudeM >= ORBITAL_SHELL_FADE_END_M) return 1;
  const t =
    (altitudeM - ORBITAL_SHELL_FADE_START_M) /
    (ORBITAL_SHELL_FADE_END_M - ORBITAL_SHELL_FADE_START_M);
  return t * t * (3 - 2 * t);
}

/** The five colours the orbital face is painted with, all palette roles. */
export interface OrbitalShellPalette {
  soilLow: THREE.Color;
  soilHigh: THREE.Color;
  vegetation: THREE.Color;
  haze: THREE.Color;
  /** The planet-wide sea, deep water and the pale shelf at its shore. */
  seaDeep: THREE.Color;
  seaShallow: THREE.Color;
}

export interface OrbitalShell {
  readonly mesh: THREE.Mesh;
  /** 0 hides the shell entirely; 1 is the fully painted world. */
  setFade(fade: number): void;
  setSunDir(dir: THREE.Vector3): void;
  /** Seconds, so the cloud veil drifts instead of sitting on the ground. */
  setTime(seconds: number): void;
  /**
   * How much cloud the weather has put in the air over the play area, 0..1.
   *
   * The same overcast the sky dome thickens with. At 0 the veil is not drawn at
   * all, which is what a clear day looks like from orbit.
   */
  setCloudCover(cover: number): void;
  /**
   * The sea over the whole face: one relief field, square-root warped so the
   * island cluster at the pole keeps its coast, and read at the same sea level
   * the ocean uses. Above the fade the shell stands in front of the sea, so this
   * is the only water it draws - one field, so the coast cannot seam where a
   * second, differently framed mask met it.
   */
  /** Metres of the body's surface per mask texel, for the relief shading. */
  setReliefTexelArc(metres: number): void;
  setFarLandMask(
    texture: THREE.Texture,
    options: {
      /** Retained for the caller's own frame; the lookup is equirectangular. */
      extentM: number;
      minM: number;
      spanM: number;
      seaLevelM: number;
    },
  ): void;
  /**
   * Turn the painted sea on or off. The mask still carries land relief when the
   * sea is off; only the water colour, the coastal foam and the height test are
   * dropped, so a dry world reads as land all the way to the limb.
   */
  setSeaEnabled(enabled: boolean): void;
}

const VERTEX = `
varying vec3 vDir;
varying vec3 vNormalW;
varying vec3 vWorldPosition;
// The mesh's own frame. The planet turns on its axis, so the baked land and sea
// have to be looked up in the frame they were baked in - by world position the
// coasts stayed still while the provinces turned under them.
varying vec3 vPlanetFixed;
void main() {
  vDir = normalize(position);
  vPlanetFixed = position;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPosition = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

// Value noise on the planet-fixed direction. The sphere is smooth, so the noise
// is the only thing that gives the surface provinces: without it the shell is
// the same flat disc the soil shader drew.
const FRAGMENT = `
uniform vec3 uSunDir;
uniform float uFade;
uniform float uTime;
uniform float uCloudCover;
uniform vec3 uSoilLow;
uniform vec3 uSoilHigh;
uniform vec3 uVegetation;
uniform vec3 uHaze;
uniform vec3 uSeaDeep;
uniform vec3 uSeaShallow;
uniform sampler2D uFarLandMask;
/** x unused, y minimum relief, z relief span, w sea-level relief; all metres. */
uniform vec4 uFarSeaParams;
// How much the mask's height gradient is allowed to tilt the lit normal. 0 turns
// the relief shading off entirely; the renderer's own default lives below.
uniform float uReliefShading;
uniform float uFarSeaFlag;
varying vec3 vPlanetFixed;
varying vec3 vDir;
varying vec3 vNormalW;
varying vec3 vWorldPosition;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i + vec3(0.0, 0.0, 0.0)), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}

float fbm(vec3 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 normal = normalize(vNormalW);
  // Provinces: two octave bands, one for the shape of a region and one for its
  // grain. Everything below is a mix of the palette's soil, foliage and frost.
  float region = fbm(dir * 3.1);
  // Not named "texture": three's WebGL2 path rewrites texture2D() calls to
  // texture(), and a local of that name shadows the built-in and fails to link.
  float grain = fbm(dir * 9.0);
  // The dirt the player stands on is the *middle* of the soil ramp, not its ends:
  // soil_mid under the sun reads as the warm orange-brown of the play area. The
  // first version mixed the ramp's two ends across the whole disc, which is how
  // orbit grew pale continents that the ground under the plant does not have. The
  // base is the mid step now, and the provinces only lean it towards the ends.
  vec3 dirt = mix(uSoilLow, uSoilHigh, 0.52);
  vec3 province = mix(uSoilLow, uSoilHigh, smoothstep(0.30, 0.70, region));
  vec3 surface = mix(dirt, province, 0.6);
  // One broad tone swing over the whole province, so the disc has light and
  // dark country at the scale a globe is read from - not only the fine grain.
  surface *= 0.86 + 0.28 * region;
  // Pale rock provinces: from orbit a dry world needs some tonal range or the
  // disc is one brown ball, but this is bare ground, not vegetation. The world
  // has no plant cover yet, so no green is mixed here at all.
  float paleRock = smoothstep(0.38, 0.64, region + grain * 0.18);
  surface = mix(surface, uSoilHigh, paleRock * 0.14);
  // Bare rock where the noise is high: a little of the pale step of the soil ramp,
  // enough to break the provinces up without painting a second country.
  float rock = smoothstep(0.62, 0.80, grain) * smoothstep(0.25, 0.65, region);
  surface = mix(surface, uSoilHigh, rock * 0.14);
  // The sea. One height field covers the whole face: every height is metres
  // above the body, so the sea level is one number and no curvature term is
  // needed. The mask is equirectangular - longitude and latitude of the
  // planet-fixed direction - because the body is a sphere and a planar map can
  // only ever show one cap of it. A planar mask left everything past six
  // kilometres at relief zero, i.e. under water, which is what painted the
  // globe one flat blue-grey.
  vec3 fixedDir = normalize(vPlanetFixed);
  vec2 seaUV = vec2(
    atan(fixedDir.z, fixedDir.x) * 0.15915494309189535 + 0.5,
    0.5 - asin(clamp(fixedDir.y, -1.0, 1.0)) * 0.3183098861837907
  );
  // The mask's polar rows are one texel wide, and a fragment's longitude is
  // meaningless within a degree of the pole: atan turns a full circle there, so
  // the top row was smeared around the disc as a starburst - the "crater with
  // radial lines" an eye at 200 km saw over the play area. The world is a small
  // place on a 100 km body, so near the pole the honest sample is the one the
  // authoring put there: a single point at the play area's own longitude.
  float maskHeight = texture2D(uFarLandMask, seaUV).r;
  float polar = smoothstep(0.995, 0.9998, abs(fixedDir.y));
  if (polar > 0.0) {
    float poleV = fixedDir.y > 0.0 ? 0.002 : 0.998;
    float poleHeight = texture2D(uFarLandMask, vec2(0.5, poleV)).r;
    maskHeight = mix(maskHeight, poleHeight, polar);
  }
  float relief = uFarSeaParams.y + maskHeight * uFarSeaParams.z;
  float aboveSea = relief - uFarSeaParams.w;
  // The mask's own height is the land's large form. Pale dust on the high
  // ground and a cooler, darker soil in the basins give the disc a second
  // scale of province colour; the noise above is the small one.
  float highland = smoothstep(0.58, 0.90, maskHeight);
  float basinFloor = 1.0 - smoothstep(0.10, 0.38, maskHeight);
  surface = mix(surface, uSoilHigh, highland * 0.22);
  surface = mix(surface, uSoilLow * 0.72, basinFloor * 0.20);
  // The palette has a vegetation role; the first shell declared it and never
  // read it, so the far face had one fewer earth family than the near ground.
  // A trace in sheltered lowlands keeps it from becoming a green planet: this
  // is the colour of distant plant cover, not a second biome.
  float sheltered = (1.0 - highland) * (1.0 - basinFloor * 0.4);
  float vegetation = smoothstep(0.52, 0.78, region + grain * 0.08) * sheltered * 0.07;
  surface = mix(surface, uVegetation, vegetation);
  // Below sea level is water; the ramp is the shoreline's own width, so a
  // shelving coast draws a shallow band and a cliff does not.
  // Crisp, because it has to be: the mask is a kilometre per texel, so a shore
  // band authored a metre deep was narrower than one texel and bilinear
  // filtering smeared it into a wide white crust around every continent. A
  // sharp step is one antialiased texel, and the colour inside the sea comes
  // from the depth below instead (see the shelf ramp).
  // Sea and its depth are decided after the mask's own slope is known: the
  // shoreline is antialiased over one texel of that slope (see coastBand below).
  // Relief shading. The mask is the same height field the ground is built from,
  // so its gradient is the world's own slope: without it the disc was a flat
  // painted map with a bright fringe, and the planet's largest features - the
  // basins, the ridges, the shelf around the play area - had no form at all.
  // The tilt is measured across one texel of the mask, so it costs two samples.
  vec3 upAxis = normalize(fixedDir);
  vec3 eastAxis = normalize(cross(vec3(0.0, 1.0, 0.0), upAxis) + vec3(1e-5, 0.0, 0.0));
  vec3 northAxis = cross(upAxis, eastAxis);
  // Measured over two texels, so the gradient is a continent's flank rather
  // than the quantisation of one stored height, and converted to a real slope
  // through the texel's arc on the body.
  float texelArc = uFarSeaParams.x > 0.1 ? uFarSeaParams.x : 1227.0;
  float spanM = max(1.0, uFarSeaParams.z);
  float slopeEast =
    (texture2D(uFarLandMask, seaUV + vec2(0.00390625, 0.0)).r - maskHeight) *
    spanM / (texelArc * 2.0);
  float slopeNorth =
    (texture2D(uFarLandMask, seaUV + vec2(0.0, 0.0078125)).r - maskHeight) *
    spanM / (texelArc * 2.0);
  // A continent's flank is flattened by the mask's kilometre-per-texel grid, so
  // its true slope is a few degrees and reads as nothing. Six is the smallest
  // exaggeration that makes the disc's largest forms - the basins, the ridges,
  // the shelf around the play area - catch the light from 200 km.
  // A slope has a sane bound. One texel of the mask that disagrees with its
  // neighbours - a lake or a spike a kilometre wide - is a cliff in the gradient,
  // and six times a cliff is the bright single-texel square that showed on the
  // continents from orbit. Capping the gradient costs nothing on a real flank.
  float slopeLimit = 0.35;
  slopeEast = clamp(slopeEast, -slopeLimit, slopeLimit);
  slopeNorth = clamp(slopeNorth, -slopeLimit, slopeLimit);
  vec3 reliefNormal = normalize(
    upAxis - eastAxis * slopeEast * uReliefShading - northAxis * slopeNorth * uReliefShading
  );
  // One texel of coast, not one colour per texel.
  //
  // The sea was a hard step at the sea level, and the mask is a kilometre to a
  // texel: every texel is entirely sea or entirely land, so the coast came out
  // as a staircase of single texels and every borderline texel inside a
  // continent showed as a bright square - the "rhombuses" scattered over the
  // land from orbit. The band is the height the ground falls across one texel of
  // the mask (its own slope times its arc), so a shelving shore fades over one
  // texel and a cliff still cuts clean.
  float coastBand = max(0.6, max(abs(slopeEast), abs(slopeNorth)) * texelArc * 1.5);
  float sea = uFarSeaFlag * (1.0 - smoothstep(-coastBand, coastBand, aboveSea));
  float depthBelow = max(0.0, -aboveSea);
  // Open water from orbit is never one tone. Without a slow variation the whole
  // face is a single flat colour at 300 km - the ocean read as a painted sphere
  // rather than as water. This is a basin/deep-water modulation a shade either
  // side of the mean, so the shore ramp and the palette stay the ones below.
  float basin = fbm(dir * 2.3 + 11.0);
  float varied = depthBelow * (0.70 + 0.60 * basin);
  // Two metres of shelf, not six: at a kilometre per texel a six-metre shelf is
  // half a dozen texels wide, and around the play area's island it drew a pale
  // bullseye ring that read as an artefact rather than a coast.
  vec3 seaColour = mix(uSeaShallow, uSeaDeep, smoothstep(0.5, 2.2, varied));
  float foam = sea * (1.0 - smoothstep(0.0, coastBand * 0.8, abs(aboveSea)));
  surface = mix(surface, seaColour, sea * 0.94);
  surface += uSeaShallow * foam * 0.10;
  // No latitude here on purpose. The play area is the planet's pole, so any
  // "polar frost" band put the whole visible hemisphere under ice: the first
  // version of this shell was a white ball from orbit. Land cover has to come
  // from the noise, which is the same everywhere the camera can look.
  // Cloud veil, drifting very slowly. Its shadow is the same pattern offset
  // towards the sun, so the ground under a cloud is darker than the ground beside
  // it - cloud shadows were the second thing missing from the ball.
  vec3 cloudOffset = vec3(uTime * 0.0035, 0.0, uTime * 0.0022);
  // The veil is the weather's, not the shader's: the noise only says where the
  // clouds would be if there were any; uCloudCover says whether there are any.
  float cloud = smoothstep(0.60, 0.82, fbm(dir * 5.2 + cloudOffset)) * uCloudCover;
  float cloudShadow = smoothstep(0.60, 0.82, fbm(dir * 5.2 + cloudOffset - uSunDir * 0.012)) *
    uCloudCover;
  surface *= 1.0 - cloudShadow * 0.20;
  // Water stays a sphere: its own glint below is the shape of the surface. Land
  // is lit by the relief the mask describes, which is what gives the continents
  // their hills from orbit.
  vec3 litNormal = normalize(mix(reliefNormal, normal, sea));
  float sunDot = dot(litNormal, uSunDir);
  // A soft terminator: the lit face, the line, and the night side that keeps a
  // little of its own colour instead of going black.
  float lit = smoothstep(-0.18, 0.35, sunDot);
  // The terminator term saturates: on the fully lit face every normal above
  // 0.28 gives the same 1.0, so tilting the normal there changed nothing at all
  // - which is why the relief shading was invisible however hard it was
  // exaggerated. A lambert term on the tilted normal carries the shape across
  // the lit face, and it is faded out over water, whose shape is its own glint.
  float reliefOn = step(0.001, uReliefShading) * (1.0 - sea);
  // A hill's flank should catch the light, not fall into a black basin. The old
  // floor (0.45) let one large south-facing slope shade a third of the disc.
  float shade = mix(1.0, 0.72 + 0.28 * clamp(sunDot, 0.0, 1.0), reliefOn);
  vec3 colour = surface * (0.10 + 0.90 * lit) * shade;
  colour = mix(colour, vec3(0.93, 0.94, 0.90), cloud * 0.38);
  // Air at the limb: brightest where the sphere turns away from the eye, warm
  // where the sun hits it. This is the band the sky dome cannot paint, because
  // the planet's own body covers that direction. The exponent is high on
  // purpose: a low one lit the whole disc instead of edging it, which turned
  // the planet into a white ball the moment the camera reached orbit.
  // cameraPosition is three's own uniform, so this cannot go stale. The first
  // version took the eye from a uniform of its own that nothing wrote: it stayed
  // at the world origin - which is the pole, the ground under the play area -
  // so every fragment 'faced away' and the whole planet lit up as one limb.
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  // A water surface catches the sun: the sea is the only thing on the disc that
  // glints, which is what tells an eye at orbit that it is looking at an ocean
  // and not a blue province.
  // At orbital range the disc is smooth, so a broad lobe lit the whole sea and
  // the shine read as a pale wash instead of the sun's path. The exponent is
  // the width of that path on a water body seen from far away.
  float glint = pow(max(dot(reflect(-uSunDir, normal), viewDir), 0.0), 220.0);
  surface += uSeaShallow * sea * glint * 0.45;
  float rim = pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), 26.0);
  // Air is blue where it is thin, and the body's edge is the thinnest air there
  // is. The haze kept a neutral white, which read as a fog shell around a brown
  // ball; a little of the sky's own blue at the limb is what makes it a planet.
  vec3 air = mix(vec3(0.42, 0.62, 0.86), uHaze, 0.52);
  colour += air * rim * (0.15 + 0.85 * lit) * 0.75;
  colour = mix(colour, air, rim * 0.10 * lit);
  gl_FragColor = vec4(colour, uFade);
  // The palette's hexes arrive as linear-light, like every other material's,
  // so the shell has to leave through the same grade and transfer as the
  // ground: without these the orbital face is a full stop darker than the soil
  // it covers.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * How far above the body the shell sits, in metres.
 *
 * It has to clear the depth buffer, not the terrain. At the camera's high
 * altitude the eye is up to 250 km out and the near plane is derived from it,
 * so one depth step there is around twelve metres: a shell two metres up
 * z-fought the body and came out as white speckle across the whole disc. Fifty
 * metres is four steps' worth at the worst altitude and still rounds the
 * silhouette by a thousandth of a percent.
 */
export const ORBITAL_SHELL_OFFSET_M = 50;

/**
 * The mask's radial warp, in TypeScript, mirroring `warpAxis` in the shader.
 *
 * The bake and the lookup have to spend their texels the same way. They once did
 * not: the bake placed a height at `u² · extent` (a parabola) while the shader
 * read it at `sqrt(u) · extent`, so every fragment sampled a different place
 * than the one its height was written to. The pole - the only land for a hundred
 * kilometres - was read from open water, and the whole disc came out one flat
 * pale sea. Any change to one of these two functions is a change to both.
 */
export function orbitalMaskWarp(value: number): number {
  const eps = 0.0025;
  const ramp = 0.5 / Math.sqrt(eps);
  const a = Math.min(Math.abs(value), 1);
  const w = a < eps ? a * ramp : Math.sqrt(a) - Math.sqrt(eps) + eps * ramp;
  return (Math.sign(value) * w) / (1 - eps * ramp * 0.5);
}

/**
 * Build the orbital face. `radiusM` is the body's radius; the shell sits just
 * above it (see `ORBITAL_SHELL_OFFSET_M`), close enough that its silhouette is
 * the planet's.
 */
export function createOrbitalShell(
  radiusM: number,
  palette: OrbitalShellPalette,
  altitudeOffsetM = ORBITAL_SHELL_OFFSET_M,
): OrbitalShell {
  const radius = Math.max(1, radiusM + Math.max(0, altitudeOffsetM));
  const geometry = new THREE.SphereGeometry(radius, 192, 96);
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uFade: { value: 0 },
    uTime: { value: 0 },
    uCloudCover: { value: 0 },
    uSoilLow: { value: palette.soilLow.clone() },
    uSoilHigh: { value: palette.soilHigh.clone() },
    uVegetation: { value: palette.vegetation.clone() },
    uHaze: { value: palette.haze.clone() },
    uSeaDeep: { value: palette.seaDeep.clone() },
    uSeaShallow: { value: palette.seaShallow.clone() },
    uFarSeaFlag: { value: 0 },
    uFarSeaParams: { value: new THREE.Vector4(1, -15, 40, 6) },
    uReliefShading: { value: 2.4 },
    uFarLandMask: { value: null as THREE.Texture | null },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    // The shell never writes depth: it is a coat over the body, and writing
    // depth from a transparent pass is how a second shell ends up invisible.
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'planet-orbital-shell';
  mesh.position.y = -radiusM;
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.visible = false;
  let seaEnabled = true;
  let maskReady = false;
  return {
    mesh,
    setFade(fade: number) {
      const value = THREE.MathUtils.clamp(Number.isFinite(fade) ? fade : 0, 0, 1);
      uniforms.uFade.value = value;
      mesh.visible = value > 0.001;
    },
    setSunDir(dir: THREE.Vector3) {
      uniforms.uSunDir.value.copy(dir);
    },
    setTime(seconds: number) {
      uniforms.uTime.value = Number.isFinite(seconds) ? seconds : 0;
    },
    setCloudCover(cover: number) {
      uniforms.uCloudCover.value = THREE.MathUtils.clamp(Number.isFinite(cover) ? cover : 0, 0, 1);
    },
    /** Metres of the body's surface per mask texel: the slope the mask implies. */
    setReliefTexelArc(metres: number) {
      uniforms.uFarSeaParams.value.x = Math.max(1, metres);
    },
    setFarLandMask(texture, mask) {
      // The mask is equirectangular now, so its extent is the planet's own and
      // the only thing that has to be sane is the height range it packs.
      if (!texture || !(mask.spanM > 0)) return;
      uniforms.uFarLandMask.value = texture;
      uniforms.uFarSeaParams.value.set(0, mask.minM, mask.spanM, mask.seaLevelM);
      maskReady = true;
      uniforms.uFarSeaFlag.value = seaEnabled ? 1 : 0;
    },
    setSeaEnabled(enabled: boolean) {
      seaEnabled = enabled;
      uniforms.uFarSeaFlag.value = enabled && maskReady ? 1 : 0;
    },
  };
}
