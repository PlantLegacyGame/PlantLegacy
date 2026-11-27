/**
 * Load and validate `config/archetypes.json` and `config/paid_spawn.json`.
 *
 * The client gets the same list from `/spawn/options`; the server reads these
 * files once at boot and is the authority for every selection.
 */
import type { ConfigFile } from '@plant-legacy/shared/config';
import { readArray, readBoolean, readNumber } from '@plant-legacy/shared/config';
import type {
  NamedSpawnArea,
  PaidSpawnConfig,
  SeedArchetype,
  SeedArchetypeStats,
} from '@plant-legacy/shared/world';

export interface SpawnConfigBundle {
  archetypes: SeedArchetype[];
  paid: PaidSpawnConfig;
  /** Radius of the spherical planet the geodetic layer converts against. */
  planetRadiusM: number;
}

function record(value: unknown, key: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`spawn config "${key}" must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`spawn config "${key}" must be a non-empty string`);
  }
  return value.trim();
}

function numberIn(source: Record<string, unknown>, key: string, min: number, max: number): number {
  const value = Number(source[key]);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`spawn config "${key}" must be a number in ${min}..${max}`);
  }
  return value;
}

function color(source: Record<string, unknown>, key: string): string {
  const value = text(source, key);
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`spawn config "${key}" must be a #rrggbb colour`);
  }
  return value.toLowerCase();
}

function loadArchetypes(configs: Map<string, ConfigFile>): SeedArchetype[] {
  const definitions = readArray<unknown[]>(configs, 'archetypes', 'definitions');
  if (!Array.isArray(definitions) || definitions.length === 0) {
    throw new Error('archetypes.json must define at least one archetype');
  }
  const seen = new Set<string>();
  return definitions.map((raw, index) => {
    const entry = record(raw, `definitions[${index}]`);
    const id = text(entry, 'id');
    if (seen.has(id)) throw new Error(`duplicate archetype id "${id}"`);
    seen.add(id);
    const stats: SeedArchetypeStats = {
      growthSpeed: numberIn(entry, 'growth_speed', 0.25, 4),
      waterCapacity: numberIn(entry, 'water_capacity', 0.25, 4),
      mineralCapacity: numberIn(entry, 'mineral_capacity', 0.25, 4),
      photosynthesis: numberIn(entry, 'photosynthesis', 0.25, 4),
      upkeep: numberIn(entry, 'upkeep', 0.25, 4),
    };
    return {
      id,
      name: text(entry, 'name'),
      description: text(entry, 'description'),
      color: color(entry, 'color'),
      seedScale: numberIn(entry, 'seed_scale', 0.5, 2),
      mutationBias: text(entry, 'mutation_bias'),
      ...stats,
    };
  });
}

function loadPaidSpawn(
  configs: Map<string, ConfigFile>,
  archetypes: SeedArchetype[],
): PaidSpawnConfig {
  const rawAreas = readArray<unknown[]>(configs, 'paid_spawn', 'named_areas');
  const seen = new Set<string>();
  const namedAreas: NamedSpawnArea[] = (rawAreas ?? []).map((raw, index) => {
    const entry = record(raw, `named_areas[${index}]`);
    const id = text(entry, 'id');
    if (seen.has(id)) throw new Error(`duplicate named spawn area "${id}"`);
    seen.add(id);
    return {
      id,
      name: text(entry, 'name'),
      description: text(entry, 'description'),
      centerLatitudeDeg: numberIn(entry, 'center_latitude_deg', -90, 90),
      centerLongitudeDeg: numberIn(entry, 'center_longitude_deg', -180, 180),
      radiusM: numberIn(entry, 'radius_m', 1, 5000),
      cost: Math.round(numberIn(entry, 'cost', 0, 1_000_000)),
    };
  });
  const playRadiusM = readNumber(configs, 'paid_spawn', 'play_radius_m');
  const planetRadiusM =
    configs.get('render')?.values.planet_radius_m?.type === 'number'
      ? (configs.get('render')?.values.planet_radius_m.value as number)
      : 100_000;
  for (const area of namedAreas) {
    // The resolver samples inside the radius and refuses points out of bounds,
    // but a centre outside the disk can never produce a legal point. Keep the
    // failure at boot rather than as an always-full area.
    const centerDistance =
      Math.sin(((90 - area.centerLatitudeDeg) * Math.PI) / 180) * planetRadiusM;
    if (centerDistance > playRadiusM) {
      throw new Error(
        `named spawn area "${area.id}" centre is ${Math.round(centerDistance)} m from the origin, outside the ${Math.round(playRadiusM)} m playable disk`,
      );
    }
  }
  if (archetypes.length === 0) throw new Error('no archetypes available for spawn');
  return {
    enabled: readBoolean(configs, 'paid_spawn', 'enabled'),
    playRadiusM,
    spacingM: readNumber(configs, 'paid_spawn', 'spawn_spacing_m'),
    exactCoordinateCost: Math.round(readNumber(configs, 'paid_spawn', 'exact_coordinate_cost')),
    namedAreas,
  };
}

export function loadSpawnConfig(configs: Map<string, ConfigFile>): SpawnConfigBundle {
  const archetypes = loadArchetypes(configs);
  const render = configs.get('render')?.values.planet_radius_m;
  const planetRadiusM =
    render?.type === 'number' && Number.isFinite(render.value) && render.value > 0
      ? (render.value as number)
      : 100_000;
  return { archetypes, paid: loadPaidSpawn(configs, archetypes), planetRadiusM };
}
