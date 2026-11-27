/**
 * Seed archetypes and the spawn contract shared by client and server.
 *
 * The client shows the options; the server is the only place a selection is
 * turned into a plant and a charge. Keeping the resolution here makes the
 * refusal reasons and the price arithmetic testable without a socket.
 */
import {
  formatGeodetic,
  type GeodeticCoordinate,
  geodeticDistanceM,
  geodeticToLocal,
  isLatitudeInRange,
  isLongitudeInRange,
  localToGeodetic,
} from './geodetic.ts';

export interface SeedArchetypeStats {
  /** Multiplies quoted growth time (values above 1 grow faster). */
  growthSpeed: number;
  /** Multiplies the root-water capacity. */
  waterCapacity: number;
  /** Multiplies the root-mineral capacity. */
  mineralCapacity: number;
  /** Multiplies photosynthesis yield. */
  photosynthesis: number;
  /** Multiplies respiration/upkeep (values below 1 are cheaper). */
  upkeep: number;
}

export interface SeedArchetype extends SeedArchetypeStats {
  id: string;
  name: string;
  description: string;
  /** Seed tint, an `#rrggbb` value owned by config. */
  color: string;
  /** Seed silhouette scale, 1 is the base art. */
  seedScale: number;
  /** Narrative label for the Inspect panel. */
  mutationBias: string;
}

export interface NamedSpawnArea {
  id: string;
  name: string;
  description: string;
  centerLatitudeDeg: number;
  centerLongitudeDeg: number;
  radiusM: number;
  cost: number;
}

export interface PaidSpawnConfig {
  enabled: boolean;
  playRadiusM: number;
  /** Minimum distance between two plant roots, metres. */
  spacingM: number;
  exactCoordinateCost: number;
  namedAreas: NamedSpawnArea[];
}

export interface SpawnSelection {
  archetypeId?: string;
  areaId?: string;
  latitudeDeg?: number;
  longitudeDeg?: number;
}

export interface SpawnResolution {
  archetype: SeedArchetype;
  area: NamedSpawnArea | null;
  x: number;
  z: number;
  /** Height above the base sphere at the chosen point, metres. */
  altitudeM: number;
  geodetic: GeodeticCoordinate;
  /** Spores the server must charge before creating the plant. */
  cost: number;
  /** Human-readable label: `Random wilds`, an area name, or the coordinate. */
  label: string;
  /** True when the player supplied exact coordinates. */
  exact: boolean;
}

export type SpawnFailureReason =
  | 'paid_spawn_disabled'
  | 'unknown_archetype'
  | 'unknown_area'
  | 'coordinate_required'
  | 'coordinate_out_of_range'
  | 'outside_play_area'
  | 'spawn_too_close'
  | 'no_space';

export interface SpawnFailure {
  ok: false;
  reason: SpawnFailureReason;
  message: string;
}

export type SpawnResult = ({ ok: true } & SpawnResolution) | SpawnFailure;

export interface OccupiedPoint {
  x: number;
  z: number;
}

export interface ResolveSpawnInput {
  selection: SpawnSelection;
  archetypes: readonly SeedArchetype[];
  config: PaidSpawnConfig;
  radiusM: number;
  occupied: readonly OccupiedPoint[];
  /** Terrain height above the base sphere, in metres. */
  terrainHeightAt: (x: number, z: number) => number;
  /** Uniform [0,1), injectable for tests. */
  random?: () => number;
}

function fail(reason: SpawnFailureReason, message: string): SpawnFailure {
  return { ok: false, reason, message };
}

function randomDiskPoint(radiusM: number, random: () => number): { x: number; z: number } {
  const angle = random() * Math.PI * 2;
  // sqrt keeps the points uniform by area instead of clumped at the centre.
  const distance = Math.sqrt(random()) * Math.max(0, radiusM);
  return { x: Math.cos(angle) * distance, z: Math.sin(angle) * distance };
}

function pointClear(
  point: { x: number; z: number },
  occupied: readonly OccupiedPoint[],
  spacingM: number,
): boolean {
  return occupied.every((other) => Math.hypot(other.x - point.x, other.z - point.z) >= spacingM);
}

function chooseFreePoint(
  config: PaidSpawnConfig,
  occupied: readonly OccupiedPoint[],
  random: () => number,
  attempts = 96,
): { x: number; z: number } | null {
  for (let i = 0; i < attempts; i += 1) {
    const point = randomDiskPoint(config.playRadiusM, random);
    if (pointClear(point, occupied, config.spacingM)) return point;
  }
  return null;
}

/**
 * Resolve the selection the client sent. Precedence is exact coordinates, then
 * a named area, then free random spawn. Supplying both an area and coordinates
 * is refused by the caller's form, but the server gives coordinates precedence
 * so no payload can accidentally buy an area and land elsewhere.
 */
export function resolveSpawn(input: ResolveSpawnInput): SpawnResult {
  const { selection, archetypes, config, occupied } = input;
  const random = input.random ?? Math.random;
  const archetype = archetypes.find((entry) => entry.id === selection.archetypeId) ?? archetypes[0];
  if (!archetype) return fail('unknown_archetype', 'That seed archetype is not available.');
  if (!config.enabled) {
    // A disabled paid-spawn file still permits the free random fallback; it
    // refuses only the parts that cost spores.
    const point = chooseFreePoint(
      { ...config, playRadiusM: Math.max(5, config.playRadiusM) },
      occupied,
      random,
    );
    if (!point) return fail('no_space', 'No clear ground is left for another seed.');
    return finalize(input, archetype, null, point, 0, 'Random wilds', false);
  }

  if (selection.latitudeDeg !== undefined || selection.longitudeDeg !== undefined) {
    if (selection.latitudeDeg === undefined || selection.longitudeDeg === undefined) {
      return fail('coordinate_required', 'Enter both a latitude and a longitude.');
    }
    if (!isLatitudeInRange(selection.latitudeDeg) || !isLongitudeInRange(selection.longitudeDeg)) {
      return fail('coordinate_out_of_range', 'Latitude must be -90..90 and longitude -180..180.');
    }
    const local = geodeticToLocal(
      { ...selection, altitudeM: 0 } as GeodeticCoordinate,
      input.radiusM,
    );
    const distance = Math.hypot(local.x, local.z);
    if (distance > config.playRadiusM) {
      return fail(
        'outside_play_area',
        `That coordinate is ${Math.round(distance - config.playRadiusM)} m outside the playable ground.`,
      );
    }
    if (!pointClear(local, occupied, config.spacingM)) {
      return fail('spawn_too_close', 'Another plant is already growing at that coordinate.');
    }
    return finalize(
      input,
      archetype,
      null,
      { x: local.x, z: local.z },
      Math.max(0, config.exactCoordinateCost),
      'Exact coordinate',
      true,
    );
  }

  if (selection.areaId) {
    const area = config.namedAreas.find((entry) => entry.id === selection.areaId);
    if (!area) return fail('unknown_area', 'That named area is not available.');
    const center = geodeticToLocal(
      {
        latitudeDeg: area.centerLatitudeDeg,
        longitudeDeg: area.centerLongitudeDeg,
        altitudeM: 0,
      },
      input.radiusM,
    );
    // Sample inside the area disc until the point is clear and still inside the
    // playable ground. A named area near the rim can otherwise push a random
    // point over the edge.
    let chosen: { x: number; z: number } | null = null;
    for (let attempt = 0; attempt < 48; attempt += 1) {
      const offset = randomDiskPoint(area.radiusM, random);
      const point = { x: center.x + offset.x, z: center.z + offset.z };
      if (Math.hypot(point.x, point.z) > config.playRadiusM) continue;
      if (!pointClear(point, occupied, config.spacingM)) continue;
      chosen = point;
      break;
    }
    if (!chosen) {
      return fail('spawn_too_close', `${area.name} is too crowded for another seed right now.`);
    }
    return finalize(input, archetype, area, chosen, Math.max(0, area.cost), area.name, false);
  }

  const point = chooseFreePoint(config, occupied, random);
  if (!point) return fail('no_space', 'No clear ground is left for another seed.');
  return finalize(input, archetype, null, point, 0, 'Random wilds', false);
}

function finalize(
  input: ResolveSpawnInput,
  archetype: SeedArchetype,
  area: NamedSpawnArea | null,
  point: { x: number; z: number },
  cost: number,
  label: string,
  exact: boolean,
): SpawnResult {
  const altitudeM = input.terrainHeightAt(point.x, point.z);
  const geodetic = localToGeodetic({ x: point.x, y: 0, z: point.z }, Math.max(1, input.radiusM));
  geodetic.altitudeM = altitudeM;
  return {
    ok: true,
    archetype,
    area,
    x: point.x,
    z: point.z,
    altitudeM,
    geodetic,
    cost,
    label: exact ? formatGeodetic(geodetic) : label,
    exact,
  };
}

/** A named area's centre as a readable geographic label for the scene. */
export function areaCoordinateLabel(area: NamedSpawnArea, radiusM: number): string {
  const local = geodeticToLocal(
    {
      latitudeDeg: area.centerLatitudeDeg,
      longitudeDeg: area.centerLongitudeDeg,
      altitudeM: 0,
    },
    radiusM,
  );
  return formatGeodetic(localToGeodetic({ x: local.x, y: 0, z: local.z }, Math.max(1, radiusM)), 3);
}

/** Distance of an area's centre from the playable origin, for the map UI. */
export function areaDistanceFromOriginM(area: NamedSpawnArea, radiusM: number): number {
  const local = geodeticToLocal(
    {
      latitudeDeg: area.centerLatitudeDeg,
      longitudeDeg: area.centerLongitudeDeg,
      altitudeM: 0,
    },
    radiusM,
  );
  return Math.hypot(local.x, local.z);
}

/** Great-circle separation between two named areas, for map layout tests. */
export function areaSeparationM(a: NamedSpawnArea, b: NamedSpawnArea, radiusM: number): number {
  return geodeticDistanceM(
    { latitudeDeg: a.centerLatitudeDeg, longitudeDeg: a.centerLongitudeDeg },
    { latitudeDeg: b.centerLatitudeDeg, longitudeDeg: b.centerLongitudeDeg },
    radiusM,
  );
}
