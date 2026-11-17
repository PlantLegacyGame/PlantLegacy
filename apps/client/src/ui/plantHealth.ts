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
  if (growthProgress < 1) return 'growing';
  if (health >= 0.7) return 'intact';
  if (health >= 0.4) return 'fading';
  return 'depleted';
}

export function nodeHealthLabel(status: NodeHealthStatus): string {
  const labels: Record<NodeHealthStatus, string> = {
    growing: 'Growing',
    intact: 'Intact',
    fading: 'Fading',
    depleted: 'Depleted',
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
