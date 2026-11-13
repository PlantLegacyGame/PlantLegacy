import { type NodeRadiusProfile, setGrowthGeometryTunables } from '@plant-legacy/shared/growth';

/** Organism geometry published by `/config/growth`. */
export interface GrowthGeometryPayload {
  seed_body_height_ratio?: number;
  branch_attach_fraction?: number;
  node_radius_profiles?: Record<string, NodeRadiusProfile>;
}

/**
 * Apply the geometry the server grows with to the code that draws it.
 *
 * Placement, drawing and aiming all read one set of numbers from
 * `growth.json`; without this the client would fall back to the compiled
 * defaults and could draw a seed whose children leave it at a different point
 * than the server used.
 */
export function applyGrowthGeometry(payload: GrowthGeometryPayload): void {
  setGrowthGeometryTunables({
    seedBodyHeightRatio: payload.seed_body_height_ratio,
    nodeRadiusProfiles: payload.node_radius_profiles,
    branchAttachFraction: payload.branch_attach_fraction,
  });
}

/** Fetch and apply `/config/growth`. A failure leaves the shared defaults. */
export async function loadGrowthGeometryConfig(serverOrigin: string): Promise<void> {
  try {
    const response = await fetch(`${serverOrigin}/config/growth`, { cache: 'no-store' });
    if (!response.ok) return;
    applyGrowthGeometry((await response.json()) as GrowthGeometryPayload);
  } catch {
    // A missing endpoint must not stop the client rendering.
  }
}
