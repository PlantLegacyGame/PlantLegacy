import type { NodeType, OrganMorphology } from '@plant-legacy/shared/growth';
import {
  ORGAN_DISPLAY_ORDER,
  organMorphologyFor,
  organTraitFor,
} from '@plant-legacy/shared/growth';

/**
 * Everything the mesh pass needs to know about one organ, in one object.
 *
 * The morphology table already exists; this joins it to the cross-cutting
 * traits so a tube, an accent, a pick surface and the growth UI cannot disagree
 * about whether a rhizome is a root or whether a leaf has a woody knuckle.
 */
export interface OrganMeshSpec extends OrganMorphology {
  readonly nodeType: NodeType;
  readonly root: boolean;
  readonly soft: boolean;
  readonly woody: boolean;
  readonly blade: boolean;
  readonly head: boolean;
  /** The tip silhouette an accent builder should draw, if it knows one. */
  readonly tipShape: OrganTipShape;
  /** True when the morphology names this anatomy. */
  has(appendage: string): boolean;
}

export type OrganTipShape =
  | 'round'
  | 'cap'
  | 'point'
  | 'notch'
  | 'operculum'
  | 'bud'
  | 'flare'
  | 'pore'
  | 'tendril'
  | 'stigma';

function tipShapeFor(tip: string): OrganTipShape {
  const lower = tip.toLowerCase();
  if (lower.includes('notch')) return 'notch';
  if (lower.includes('operculum')) return 'operculum';
  if (lower.includes('cap')) return 'cap';
  if (lower.includes('bud') || lower.includes('growing tip') || lower.includes('runner')) {
    return 'bud';
  }
  if (lower.includes('flare')) return 'flare';
  if (lower.includes('pore') || lower.includes('spongy')) return 'pore';
  if (lower.includes('tendril')) return 'tendril';
  if (lower.includes('stigma')) return 'stigma';
  if (lower.includes('point') || lower.includes('spine') || lower.includes('leader')) {
    return 'point';
  }
  return 'round';
}

export function organMeshSpecFor(nodeType: string | undefined): OrganMeshSpec {
  const morphology = organMorphologyFor(nodeType);
  const traits = organTraitFor(nodeType);
  return {
    ...morphology,
    nodeType: morphology.type,
    root: traits.underground,
    soft: traits.soft,
    woody: traits.woody,
    blade: traits.blade,
    head: traits.head,
    tipShape: tipShapeFor(morphology.tip),
    has: (appendage: string) =>
      morphology.appendages.some((entry) => entry.toLowerCase() === appendage.toLowerCase()),
  };
}

export function allOrganMeshSpecs(): readonly OrganMeshSpec[] {
  return ORGAN_DISPLAY_ORDER.map((nodeType) => organMeshSpecFor(nodeType));
}
