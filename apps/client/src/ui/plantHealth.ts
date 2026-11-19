/**
 * Pure health wording for the HUD, inspect panel and death summary.
 *
 * Damage is biomass loss (ADR-055), so structural integrity against the uproot
 * ceiling is the plant's health. Nothing here invents an HP pool; a node's health
 * is its remaining biomass, which is what the renderer and the server agree on.
 */

export interface HealthThresholds {
  /** At or above this fraction the plant reads Healthy. */
  healthy: number;
  /** At or above this fraction it reads Stressed. */
  stressed: number;
  /** At or above this fraction it reads Withering; below it reads Dying. */
  withering: number;
}

export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
  healthy: 0.75,
  stressed: 0.5,
  withering: 0.25,
};

export type PlantHealthStatus = 'healthy' | 'stressed' | 'withering' | 'dying' | 'dead';

export function plantHealthStatus(
  fraction: number,
  thresholds: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS,
): PlantHealthStatus {
  if (!Number.isFinite(fraction)) return 'healthy';
  if (fraction <= 0) return 'dead';
  if (fraction < thresholds.withering) return 'dying';
  if (fraction < thresholds.stressed) return 'withering';
  if (fraction < thresholds.healthy) return 'stressed';
  return 'healthy';
}

export function plantHealthLabel(status: PlantHealthStatus): string {
  const labels: Record<PlantHealthStatus, string> = {
    healthy: 'Healthy',
    stressed: 'Stressed',
    withering: 'Withering',
    dying: 'Dying',
    dead: 'Dead',
  };
  return labels[status];
}

export type NodeHealthStatus = 'growing' | 'intact' | 'fading' | 'depleted' | 'gone';

export function nodeHealthStatus(health: number, growthProgress = 1): NodeHealthStatus {
  if (!(health > 0)) return 'gone';
  // A part still filling in is not damaged; the server says the same.
  if (growthProgress < 1) return 'growing';
  // Three bands, not five: a part that has lost a tenth of its tissue is still
  // whole to the player, and calling that "Fading" made the panel shout damage
  // at a plant nobody had touched. Only a real loss gets a warning word.
  if (health >= 0.85) return 'intact';
  if (health >= 0.5) return 'fading';
  return 'depleted';
}

/**
 * What a health band looks like *on the plant*, not in a panel.
 *
 * The inspect panel could say "Wilted" while the 3D part was drawn in the same
 * green as a healthy one: the status existed in one place and the scene in
 * another, so the sentence and the picture disagreed. These numbers hang off the
 * same bands the panel prints, so the plant cannot look healthy and read wilted.
 */
export interface NodeHealthLook {
  /** How far the part's colour is pulled toward dry straw (0..1). */
  straw: number;
  /** How much saturation it loses (0..1): dry tissue is not vivid. */
  desaturate: number;
  /** Extra surface scatter; dry tissue is less glossy. */
  roughness: number;
}

export function nodeHealthLook(status: NodeHealthStatus): NodeHealthLook {
  switch (status) {
    case 'depleted':
      return { straw: 0.72, desaturate: 0.42, roughness: 0.55 };
    case 'gone':
      return { straw: 1, desaturate: 0.6, roughness: 0.7 };
    case 'fading':
      return { straw: 0.32, desaturate: 0.18, roughness: 0.28 };
    // Filling in is not damage, and neither is being whole: both keep their own
    // colour, so the panel's "Growing" and "Healthy" look the same in the world.
    default:
      return { straw: 0, desaturate: 0, roughness: 0 };
  }
}

export function nodeHealthLabel(status: NodeHealthStatus): string {
  const labels: Record<NodeHealthStatus, string> = {
    growing: 'Growing',
    intact: 'Healthy',
    fading: 'Damaged',
    depleted: 'Wilted',
    gone: 'Gone',
  };
  return labels[status];
}

/** Human-readable elapsed time for the inspect and death panels. */
export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(rest).padStart(2, '0')}s`;
  return `${rest}s`;
}
