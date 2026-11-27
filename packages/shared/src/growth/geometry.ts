import { setOrganMorphologyOverrides } from './organMorphology.ts';
import type {
  AttachmentPart,
  GrowthGeometryTunables,
  NodeRadiusProfile,
  NodeType,
  SegmentPlacement,
  Vec3Like,
} from './types.ts';

/**
 * Drawn radius of a plant part, in metres.
 *
 * Server radii are vessel radii from biomass (r ~ cbrt(biomass)), which is a
 * physical model, not a drawing size: a 1 g seed came out at 0.75 m. The
 * renderer needs botanical sizes, so the two sides share one table instead of
 * each applying its own multiplier. `nominalBiomass` is the biomass at which a
 * part is drawn at `radius`; the cube root keeps the growth response.
 */
export const NODE_RADIUS_PROFILES: Readonly<Record<string, NodeRadiusProfile>> = {
  seed: { nominalBiomass: 1, radius: 0.075, min: 0.06, max: 0.1 },
  radicle: { nominalBiomass: 8, radius: 0.03, min: 0.01, max: 0.04 },
  root: { nominalBiomass: 5, radius: 0.02, min: 0.008, max: 0.032 },
  lateral_root: { nominalBiomass: 4, radius: 0.013, min: 0.005, max: 0.024 },
  stem: { nominalBiomass: 5, radius: 0.026, min: 0.01, max: 0.04 },
  branch: { nominalBiomass: 4, radius: 0.017, min: 0.007, max: 0.028 },
  vine: { nominalBiomass: 3, radius: 0.014, min: 0.006, max: 0.024 },
  leaf: { nominalBiomass: 2, radius: 0.008, min: 0.004, max: 0.014 },
  cotyledon: { nominalBiomass: 6, radius: 0.011, min: 0.005, max: 0.018 },
  flower: { nominalBiomass: 2, radius: 0.01, min: 0.004, max: 0.02 },
  spore_sac: { nominalBiomass: 2, radius: 0.01, min: 0.004, max: 0.02 },
  trunk: { nominalBiomass: 10, radius: 0.045, min: 0.02, max: 0.07 },
  rhizome: { nominalBiomass: 6, radius: 0.022, min: 0.01, max: 0.035 },
  culm: { nominalBiomass: 5, radius: 0.03, min: 0.015, max: 0.045 },
  floating_leaf: { nominalBiomass: 2, radius: 0.05, min: 0.03, max: 0.08 },
  pneumatophore: { nominalBiomass: 4, radius: 0.016, min: 0.007, max: 0.03 },
  thorn: { nominalBiomass: 2, radius: 0.012, min: 0.005, max: 0.02 },
  stolon: { nominalBiomass: 6, radius: 0.016, min: 0.007, max: 0.026 },
  tuber: { nominalBiomass: 14, radius: 0.055, min: 0.03, max: 0.085 },
  default: { nominalBiomass: 3, radius: 0.012, min: 0.005, max: 0.03 },
};

/**
 * Aspect of the drawn seed body: its centre sits this many radii above its
 * stored base. Compiled-in default; `seed_body_height_ratio` in `growth.json`
 * overrides it for the server, the mesh pass and Plant Lab alike.
 */
export const SEED_BODY_HEIGHT_RATIO = 1.35;

/** Where a branch may leave its parent: part-way along the parent's own segment. */
export const DEFAULT_BRANCH_ATTACH_FRACTION = 0.6;

/**
 * Node types that may leave their parent part-way along its segment.
 *
 * Lateral roots, branches and vines are buds on an existing organ, not new
 * extensions of its tip: a lateral root comes off the taproot and a branch off
 * an internode. Everything else (roots, stems, leaves, flowers) continues or
 * terminates a segment, so it leaves at the parent's end.
 */
export const MID_SEGMENT_BRANCH_TYPES: readonly NodeType[] = [
  'lateral_root',
  'branch',
  'vine',
  'rhizome',
  'thorn',
  'stolon',
];

/** How much fatter than its own shank a part is allowed to be where it leaves. */
export const DEFAULT_JOINT_FLARE_RATIO = 1.25;
/** How fast a segment necks down from its junction belly to its shank. */
export const DEFAULT_SEGMENT_TAPER_EXPONENT = 2.2;
/** How far along its own direction a child's tube starts, as a fraction of the parent's radius. */
export const DEFAULT_SOCKET_INSET_RATIO = 0.15;

let activeJointFlareRatio = DEFAULT_JOINT_FLARE_RATIO;
let activeSegmentTaperExponent = DEFAULT_SEGMENT_TAPER_EXPONENT;
let activeSocketInsetRatio = DEFAULT_SOCKET_INSET_RATIO;
let activeSeedBodyHeightRatio = SEED_BODY_HEIGHT_RATIO;
let activeNodeRadiusProfiles: Readonly<Record<string, NodeRadiusProfile>> = NODE_RADIUS_PROFILES;
let activeBranchAttachFraction = DEFAULT_BRANCH_ATTACH_FRACTION;

/** Clamp an attach fraction into the segment, keeping a real stub above 0. */
export function clampAttachFraction(fraction: number): number {
  if (!Number.isFinite(fraction)) return 1;
  return Math.min(1, Math.max(0.05, fraction));
}

function sanitizeRadiusProfiles(
  profiles: Record<string, NodeRadiusProfile> | undefined,
): Readonly<Record<string, NodeRadiusProfile>> {
  if (!profiles || typeof profiles !== 'object') return NODE_RADIUS_PROFILES;
  const merged: Record<string, NodeRadiusProfile> = { ...NODE_RADIUS_PROFILES };
  for (const [nodeType, profile] of Object.entries(profiles)) {
    if (!profile || typeof profile !== 'object') continue;
    const { nominalBiomass, radius, min, max } = profile;
    const numbers = [nominalBiomass, radius, min, max];
    if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)) continue;
    if (min > max || radius < min || radius > max) continue;
    merged[nodeType] = { nominalBiomass, radius, min, max };
  }
  return merged;
}

/**
 * Organism geometry that is owned by config but read by every process.
 *
 * These numbers are not server rules and not renderer settings: they describe
 * the drawn organism, so a server that placed nodes with one seed aspect and a
 * client that drew them with another would silently disagree. Loading them into
 * one shared place keeps the server, the WebGPU mesh pass and the Lab on the
 * same geometry, and leaves the compiled constants as the fallback for a config
 * that predates the key.
 */
export function setGrowthGeometryTunables(tunables: GrowthGeometryTunables = {}): void {
  const ratio = tunables.seedBodyHeightRatio;
  activeSeedBodyHeightRatio =
    typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0
      ? ratio
      : SEED_BODY_HEIGHT_RATIO;
  activeNodeRadiusProfiles = sanitizeRadiusProfiles(tunables.nodeRadiusProfiles);
  activeBranchAttachFraction = clampAttachFraction(
    tunables.branchAttachFraction ?? DEFAULT_BRANCH_ATTACH_FRACTION,
  );
  const positive = (value: number | undefined, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
  activeJointFlareRatio = Math.min(
    2,
    Math.max(1, positive(tunables.jointFlareRatio, DEFAULT_JOINT_FLARE_RATIO)),
  );
  activeSegmentTaperExponent = Math.min(
    4,
    Math.max(1, positive(tunables.segmentTaperExponent, DEFAULT_SEGMENT_TAPER_EXPONENT)),
  );
  activeSocketInsetRatio = Math.min(
    0.9,
    Math.max(
      0,
      typeof tunables.socketInsetRatio === 'number' && Number.isFinite(tunables.socketInsetRatio)
        ? tunables.socketInsetRatio
        : DEFAULT_SOCKET_INSET_RATIO,
    ),
  );
  setOrganMorphologyOverrides(tunables.organMorphology);
}

export function getJointFlareRatio(): number {
  return activeJointFlareRatio;
}

export function getSegmentTaperExponent(): number {
  return activeSegmentTaperExponent;
}

export function getSocketInsetRatio(): number {
  return activeSocketInsetRatio;
}

/**
 * Radius of a part where it leaves its parent.
 *
 * The old rule used the parent's own radius, so a branch off a trunk was drawn
 * as a cone with the trunk's diameter at its base - a spike socket, 2.65x its
 * own shank and a 19 degree half-angle on a 12 cm internode. A junction is a
 * property of the parent *and* the child: a little wider than the child's shank
 * (the knuckle), never wider than the parent that carries it. Soft organs are
 * capped at their own radius instead, so a leaf does not get a knuckle.
 */
export function jointStartRadius(
  parentRadiusAtAttach: number,
  childRadius: number,
  softOrgan = false,
): number {
  const parent = Number.isFinite(parentRadiusAtAttach) ? Math.max(0, parentRadiusAtAttach) : 0;
  const child = Number.isFinite(childRadius) ? Math.max(0, childRadius) : 0;
  if (!(parent > 0)) return child;
  if (!(child > 0)) return parent;
  if (softOrgan) return Math.min(parent, child);
  return Math.min(parent, child * activeJointFlareRatio);
}

/**
 * Radius at a fraction `t` along a segment: a belly at the junction, most of the
 * necking done early, then a near-constant shank.
 *
 * A straight start-to-end interpolation spreads the whole neck over the segment,
 * which draws every internode as a cone. `1 - (1 - t)^p` reaches most of the way
 * to the shank inside the first quarter and holds, which is how a branch is
 * shaped rather than how a funnel is.
 */
export function segmentRadiusAt(
  startRadius: number,
  endRadius: number,
  t: number,
  /**
   * Taper exponent for this organ. Above 1 the segment necks down just under its
   * parent; below 1 it keeps its body further along its length instead of
   * thinning to a spike. Absent, the shared tunable is used.
   *
   * It is an argument because the shape is a property of the organ, not of the
   * plant: the title plate draws its taproot at 1.0, its laterals at 0.95 and its
   * feeders at 0.9 with the same formula, and a drawing where every organ thins
   * alike gives the laterals no body at all.
   */
  exponent: number = activeSegmentTaperExponent,
): number {
  const start = Number.isFinite(startRadius) ? startRadius : 0;
  const end = Number.isFinite(endRadius) ? endRadius : 0;
  const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 1));
  if (clamped <= 0) return start;
  if (clamped >= 1) return end;
  const k = Number.isFinite(exponent) && exponent > 0 ? exponent : activeSegmentTaperExponent;
  const eased = 1 - (1 - clamped) ** k;
  return start + (end - start) * eased;
}

/** Altitude on the child's own direction where its tube begins, in metres. */
export function socketInset(parentRadiusAtAttach: number): number {
  const radius = Number.isFinite(parentRadiusAtAttach) ? Math.max(0, parentRadiusAtAttach) : 0;
  return radius * activeSocketInsetRatio;
}

export function getSeedBodyHeightRatio(): number {
  return activeSeedBodyHeightRatio;
}

/**
 * Half-height of the drawn seed body, in metres.
 *
 * The seed is an ovoid standing on the soil: its stored position is the contact
 * point, and the body extends this far above (and below) its own centre.
 */
export function seedBodyHalfHeight(radius: number): number {
  const drawn = Number.isFinite(radius) && radius > 0 ? radius : 0;
  return drawn * getSeedBodyHeightRatio();
}

/**
 * Drawn centre of a seed body whose stored base sits at `baseY`.
 *
 * Every renderer has to lift the seed by its half-height or the same seed is
 * drawn at a different height depending on which one is active — the CPU mesh
 * path, the SDF path and the WebGPU mesh pass each used to carry their own
 * number here. This is that lift, in one place.
 */
export function seedBodyCentreY(baseY: number, radius: number): number {
  return baseY + seedBodyHalfHeight(radius);
}

export function getNodeRadiusProfiles(): Readonly<Record<string, NodeRadiusProfile>> {
  return activeNodeRadiusProfiles;
}

export function getBranchAttachFraction(): number {
  return activeBranchAttachFraction;
}

export function nodeRenderRadius(
  nodeType: string | undefined,
  biomass: number,
  /**
   * How much wider the part is allowed to be drawn than its base profile. A
   * size mutation holds `scale³` mass, and this lets the drawn radius follow it
   * instead of saturating at the profile's base maximum.
   */
  maxScale = 1,
): number {
  const profiles = getNodeRadiusProfiles();
  const profile = profiles[(nodeType ?? '').toLowerCase()] ?? profiles.default;
  const mass = Number.isFinite(biomass) && biomass >= 0 ? biomass : profile.nominalBiomass;
  const scale = Math.cbrt(mass / profile.nominalBiomass);
  const widened = Number.isFinite(maxScale) && maxScale > 1 ? maxScale : 1;
  return Math.min(profile.max * widened, Math.max(profile.min, profile.radius * scale));
}

/**
 * Single resolution rule for a node's drawn radius, shared by the server and
 * every renderer.
 *
 * The server stores drawn metres in `node.radius` (via `nodeRenderRadius`), so a
 * finite value in the botanical range is authoritative. A value above 0.2 m is a
 * legacy vessel radius from before the unit fix; it is ignored and the table is
 * used instead, which keeps old saved payloads from drawing giant trunks.
 */
export function resolveDrawnRadius(
  nodeType: string | undefined,
  serverRadius: number | undefined,
  biomass?: number,
): number {
  if (
    typeof serverRadius === 'number' &&
    Number.isFinite(serverRadius) &&
    serverRadius > 0 &&
    serverRadius <= 0.2
  ) {
    return serverRadius;
  }
  return nodeRenderRadius(nodeType, typeof biomass === 'number' ? biomass : Number.NaN);
}

/**
 * Point where a child leaves its parent.
 *
 * A seed is drawn as an ovoid sitting on the stored base position, so its
 * children leave the coat; every other node is a segment, so children leave its
 * end - or, for a lateral branch, a point part-way along it (`attachFraction`,
 * measured from the segment start towards its end). The server places new nodes
 * from this point and the renderer starts every tube here, which keeps the model
 * skeleton and the drawn plant in the same coordinates.
 */
export function nodeAttachmentPoint(
  parent: AttachmentPart,
  direction: Vec3Like,
  attachFraction = 1,
): Vec3Like {
  const type = (parent.nodeType ?? parent.type ?? '').toLowerCase();
  if (type !== 'seed') {
    const fraction = clampAttachFraction(attachFraction);
    if (fraction < 1 && parent.segmentStart) {
      const start = parent.segmentStart;
      return {
        x: start.x + (parent.x - start.x) * fraction,
        y: start.y + (parent.y - start.y) * fraction,
        z: start.z + (parent.z - start.z) * fraction,
      };
    }
    return { x: parent.x, y: parent.y, z: parent.z };
  }

  const radius = resolveDrawnRadius('seed', parent.radius, parent.biomass);
  const length = Math.hypot(direction.x, direction.y, direction.z);
  const dx = length > 0 ? direction.x / length : 0;
  const dy = length > 0 ? direction.y / length : 1;
  const dz = length > 0 ? direction.z / length : 0;
  return {
    x: parent.x + dx * radius,
    y: parent.y + radius * getSeedBodyHeightRatio() + dy * radius,
    z: parent.z + dz * radius,
  };
}

/**
 * Resolve where a growth action leaves its parent.
 *
 * An explicit request (a growth intent) wins; otherwise a branching type uses
 * the configured fraction and every other type continues from the parent's end.
 * The fraction has one source: the applied geometry tunables, which both the
 * server's config loader and the client's `/config/growth` fetch set from
 * `branch_attach_fraction`.
 */
export function resolveAttachFraction(
  nodeType: NodeType | string,
  requested: number | undefined,
): number {
  if (typeof requested === 'number' && Number.isFinite(requested)) {
    return clampAttachFraction(requested);
  }
  if ((MID_SEGMENT_BRANCH_TYPES as readonly string[]).includes(nodeType)) {
    return clampAttachFraction(getBranchAttachFraction());
  }
  return 1;
}

/**
 * Canonical placement of a child one `length` from its parent.
 *
 * Both creation paths (`tryGrow`, `handleGermination`) and the load-time repair
 * use this, so a node's stored position is always exactly one segment from the
 * point it leaves its parent. The direction is normalised here, so `length` is a
 * distance even when the caller passes an unnormalised vector.
 */
export function placeSegment(
  parent: AttachmentPart,
  direction: Vec3Like,
  length: number,
  attachFraction = 1,
): SegmentPlacement {
  const magnitude = Math.hypot(direction.x, direction.y, direction.z);
  const unit =
    magnitude > 0
      ? { x: direction.x / magnitude, y: direction.y / magnitude, z: direction.z / magnitude }
      : { x: 0, y: 1, z: 0 };
  const start = nodeAttachmentPoint(parent, unit, attachFraction);
  const step = Number.isFinite(length) ? Math.max(0, length) : 0;
  return {
    start,
    end: {
      x: start.x + unit.x * step,
      y: start.y + unit.y * step,
      z: start.z + unit.z * step,
    },
  };
}

/**
 * Longest a new segment may be, given the part it grows out of.
 *
 * A size mutation scales the segment a plant is about to make, and the scale is a
 * product of every size mutation and level card it holds. Uncapped, a side branch
 * could come out several times the length of the trunk it left: the geometry was
 * still attached - every joint met - but a plant whose parts are out of proportion
 * does not read as a plant, it reads as a stick stuck into another stick.
 *
 * The ratio is a config value, and a parent with no length of its own (the seed)
 * imposes no ceiling: there is nothing to be proportional to yet.
 */
export function clampChildSegmentLength(
  length: number,
  parentLength: number,
  maxRatio: number | undefined,
): number {
  const candidate = Number.isFinite(length) && length > 0 ? length : 0;
  if (typeof maxRatio !== 'number' || !Number.isFinite(maxRatio) || maxRatio <= 0) return candidate;
  if (!Number.isFinite(parentLength) || parentLength <= 0) return candidate;
  return Math.min(candidate, parentLength * maxRatio);
}

/** Ceiling on a segment, from the loaded growth config. */
export function getMaxChildLengthRatio(): number {
  return maxChildLengthRatio;
}

let maxChildLengthRatio = 1.6;

export function setMaxChildLengthRatio(ratio: number): void {
  if (Number.isFinite(ratio) && ratio >= 1) maxChildLengthRatio = ratio;
}
