/**
 * The pure half of the spawn scene: draft state, selection and price.
 *
 * The DOM in `SpawnScene` only displays what these functions decide, so the
 * keyboard path, the exact-coordinate parser and the displayed cost are the same
 * code the confirm button uses - and can be tested without a browser.
 */
import {
  type NamedSpawnArea,
  parseLatitude,
  parseLongitude,
  type SeedArchetype,
  type SpawnSelection,
} from '@plant-legacy/shared/world';

export type SpawnMode = 'random' | 'area' | 'exact';

export interface SpawnSceneOptions {
  archetypes: SeedArchetype[];
  namedAreas: NamedSpawnArea[];
  playRadiusM: number;
  exactCoordinateCost: number;
  balance: number;
  startingBalance: number;
  enabled: boolean;
  planetRadiusM: number;
  authenticated: boolean;
}

export interface SpawnDraft {
  archetypeId: string;
  mode: SpawnMode;
  areaId: string | null;
  latitudeText: string;
  longitudeText: string;
}

export function createSpawnDraft(options: SpawnSceneOptions): SpawnDraft {
  return {
    archetypeId: options.archetypes[0]?.id ?? '',
    mode: 'random',
    areaId: null,
    latitudeText: '',
    longitudeText: '',
  };
}

export function chooseArchetype(draft: SpawnDraft, id: string): SpawnDraft {
  return { ...draft, archetypeId: id };
}

export function chooseMode(draft: SpawnDraft, mode: SpawnMode): SpawnDraft {
  if (mode === 'area' && draft.mode === 'area' && draft.areaId) return draft;
  return { ...draft, mode };
}

export function chooseArea(draft: SpawnDraft, areaId: string): SpawnDraft {
  return { ...draft, mode: 'area', areaId };
}

export function setCoordinateText(
  draft: SpawnDraft,
  field: 'latitudeText' | 'longitudeText',
  value: string,
): SpawnDraft {
  return { ...draft, mode: 'exact', [field]: value };
}

export function selectedArea(draft: SpawnDraft, options: SpawnSceneOptions): NamedSpawnArea | null {
  if (draft.mode !== 'area' || !draft.areaId) return null;
  return options.namedAreas.find((area) => area.id === draft.areaId) ?? null;
}

export interface DraftDecision {
  ok: boolean;
  selection: SpawnSelection | null;
  cost: number;
  label: string;
  message: string | null;
}

/**
 * Turn the draft into the payload HELLO/RESPAWN carries. The server re-resolves
 * it; this is only the client's preview and its disabled-button reason.
 */
export function resolveDraft(draft: SpawnDraft, options: SpawnSceneOptions): DraftDecision {
  if (draft.mode === 'random') {
    return {
      ok: true,
      selection: { archetypeId: draft.archetypeId || undefined },
      cost: 0,
      label: 'Grow a free wild seed',
      message: null,
    };
  }
  if (!options.enabled) {
    return {
      ok: false,
      selection: null,
      cost: 0,
      label: 'Paid spawns are closed',
      message: 'Named areas and exact coordinates are closed right now. A wild seed is free.',
    };
  }
  if (draft.mode === 'area') {
    const area = selectedArea(draft, options);
    if (!area) {
      return {
        ok: false,
        selection: null,
        cost: 0,
        label: 'Choose a place',
        message: 'Choose one of the named areas on the map.',
      };
    }
    return {
      ok: true,
      selection: { archetypeId: draft.archetypeId || undefined, areaId: area.id },
      cost: area.cost,
      label: `Plant in ${area.name}`,
      message: null,
    };
  }
  const latitude = parseLatitude(draft.latitudeText);
  const longitude = parseLongitude(draft.longitudeText);
  if (latitude === null || longitude === null) {
    return {
      ok: false,
      selection: null,
      cost: Math.max(0, options.exactCoordinateCost),
      label: 'Enter a coordinate',
      message: 'Enter a latitude and a longitude, in degrees or degrees/minutes/seconds.',
    };
  }
  return {
    ok: true,
    selection: {
      archetypeId: draft.archetypeId || undefined,
      latitudeDeg: latitude,
      longitudeDeg: longitude,
    },
    cost: Math.max(0, options.exactCoordinateCost),
    label: 'Plant at this coordinate',
    message: null,
  };
}

export function canAfford(decision: DraftDecision, options: SpawnSceneOptions): boolean {
  return decision.ok && decision.cost <= options.balance;
}

export function insufficientMessage(decision: DraftDecision, options: SpawnSceneOptions): string {
  return `That seed costs ${decision.cost} spores. You have ${options.balance}.`;
}
