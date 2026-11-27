import type { NodeType } from './types.ts';

/**
 * Cross-cutting organ roles.
 *
 * The renderers used to keep their own copies of "which parts are roots", "which
 * are soft", "which are woody" and "what order do the menus show". Those sets
 * drifted: a rhizome was underground in one pass and canopy in another, and the
 * growth cards knew ten of the nineteen organs. This table is the one answer.
 */
export type OrganFamilyName =
  | 'seed'
  | 'root'
  | 'shoot'
  | 'runner'
  | 'storage'
  | 'foliage'
  | 'reproductive';

export interface OrganTrait {
  readonly family: OrganFamilyName;
  /** Lives in the soil for the purpose of Root Sight and soil shading. */
  readonly underground: boolean;
  /** A leaf, cotyledon, flower or spore sac: no woody knuckle at its joint. */
  readonly soft: boolean;
  /** Woody tissue: bark ramp, taper and the plate's root ink apply. */
  readonly woody: boolean;
  /** Drawn as a flat blade by the mesh pass. */
  readonly blade: boolean;
  /** Drawn as a head on a stalk by the mesh pass. */
  readonly head: boolean;
}

export const ORGAN_TRAITS = {
  seed: {
    family: 'seed',
    underground: false,
    soft: false,
    woody: true,
    blade: false,
    head: false,
  },
  radicle: {
    family: 'root',
    underground: true,
    soft: false,
    woody: true,
    blade: false,
    head: false,
  },
  root: {
    family: 'root',
    underground: true,
    soft: false,
    woody: true,
    blade: false,
    head: false,
  },
  lateral_root: {
    family: 'root',
    underground: true,
    soft: false,
    woody: true,
    blade: false,
    head: false,
  },
  stem: {
    family: 'shoot',
    underground: false,
    soft: false,
    woody: true,
    blade: false,
    head: false,
  },
  branch: {
    family: 'shoot',
    underground: false,
    soft: false,
    woody: true,
    blade: false,
    head: false,
  },
  trunk: {
    family: 'shoot',
    underground: false,
    soft: false,
    woody: true,
    blade: false,
    head: false,
  },
  rhizome: {
    family: 'runner',
    underground: true,
    soft: false,
    woody: true,
    blade: false,
    head: false,
  },
  culm: {
    family: 'shoot',
    underground: false,
    soft: false,
    woody: true,
    blade: false,
    head: false,
  },
  floating_leaf: {
    family: 'foliage',
    underground: false,
    soft: true,
    woody: false,
    blade: true,
    head: false,
  },
  pneumatophore: {
    family: 'root',
    underground: true,
    soft: false,
    woody: true,
    blade: false,
    head: false,
  },
  thorn: {
    family: 'shoot',
    underground: false,
    soft: false,
    woody: true,
    blade: false,
    head: false,
  },
  stolon: {
    family: 'runner',
    underground: false,
    soft: false,
    woody: true,
    blade: false,
    head: false,
  },
  tuber: {
    family: 'storage',
    underground: true,
    soft: false,
    woody: true,
    blade: false,
    head: false,
  },
  vine: {
    family: 'shoot',
    underground: false,
    soft: false,
    woody: true,
    blade: false,
    head: false,
  },
  leaf: {
    family: 'foliage',
    underground: false,
    soft: true,
    woody: false,
    blade: true,
    head: false,
  },
  cotyledon: {
    family: 'foliage',
    underground: false,
    soft: true,
    woody: false,
    blade: true,
    head: false,
  },
  flower: {
    family: 'reproductive',
    underground: false,
    soft: true,
    woody: false,
    blade: false,
    head: true,
  },
  spore_sac: {
    family: 'reproductive',
    underground: false,
    soft: true,
    woody: false,
    blade: false,
    head: true,
  },
} as const satisfies Record<NodeType, OrganTrait>;

/** The menu and diagnostic order, one row per node type. */
export const ORGAN_DISPLAY_ORDER: readonly NodeType[] = [
  'seed',
  'radicle',
  'root',
  'lateral_root',
  'stem',
  'branch',
  'trunk',
  'rhizome',
  'culm',
  'floating_leaf',
  'pneumatophore',
  'thorn',
  'stolon',
  'tuber',
  'vine',
  'leaf',
  'cotyledon',
  'flower',
  'spore_sac',
];

export function organTraitFor(nodeType: string | undefined): OrganTrait {
  const key = (nodeType ?? 'stem').toLowerCase() as NodeType;
  return ORGAN_TRAITS[key] ?? ORGAN_TRAITS.stem;
}

export function isRootOrgan(nodeType: string | undefined): boolean {
  return organTraitFor(nodeType).underground;
}

export function isSoftOrgan(nodeType: string | undefined): boolean {
  return organTraitFor(nodeType).soft;
}

export function isWoodyOrgan(nodeType: string | undefined): boolean {
  return organTraitFor(nodeType).woody;
}

export function isBladeOrgan(nodeType: string | undefined): boolean {
  return organTraitFor(nodeType).blade;
}

export function isHeadOrgan(nodeType: string | undefined): boolean {
  return organTraitFor(nodeType).head;
}
