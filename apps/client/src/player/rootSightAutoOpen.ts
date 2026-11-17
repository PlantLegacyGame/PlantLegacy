/**
 * When Root Sight opens itself.
 *
 * Everything underground is drawn only through the root-sight cavity, so a part
 * the player pays for and cannot see reads as a broken game, not as an unopened
 * view mode. "Press R" is not a discoverable answer to "I grew a root and
 * nothing happened", so starting a buried part opens the view.
 *
 * The rule is deliberately small and pure: the R key owns the mode, and the
 * automatic opening only fires on a *new* buried part. Closing by hand therefore
 * stands until the player grows something else underground.
 */

/** Parts that live in the soil, whatever their layer tag says. */
const UNDERGROUND_PART_TYPES = new Set([
  'radicle',
  'root',
  'lateral_root',
  'rhizome',
  'tuber',
  'pneumatophore',
  'stolon',
]);

export function isUndergroundPart(type: string | undefined, layer?: string | undefined): boolean {
  // The layer tag is authoritative when present: a mutation can add a part type
  // this list has never heard of, and the server still says it is buried.
  if (layer === 'root') return true;
  if (layer === 'canopy') return false;
  return UNDERGROUND_PART_TYPES.has((type ?? '').toLowerCase());
}

export interface AutoOpenInput {
  type: string | undefined;
  layer?: string | undefined;
  /** `root_sight.auto_open_on_root_growth`. */
  autoOpenEnabled: boolean;
  /** The machine is already open or opening. */
  alreadyOpen: boolean;
}

export interface AutoOpenDecision {
  open: boolean;
  reason: 'already-open' | 'not-underground' | 'disabled' | 'started-underground';
}

export function decideAutoOpenRootSight(input: AutoOpenInput): AutoOpenDecision {
  if (!input.autoOpenEnabled) return { open: false, reason: 'disabled' };
  if (!isUndergroundPart(input.type, input.layer)) {
    return { open: false, reason: 'not-underground' };
  }
  if (input.alreadyOpen) return { open: false, reason: 'already-open' };
  return { open: true, reason: 'started-underground' };
}
