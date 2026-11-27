/**
 * What the plant's genes do to the aim the player drags.
 *
 * The aim was already clamped by `clampGrowthDirectionByGene` before it was
 * drawn, so the arrow never pointed somewhere the part could not go - but nothing
 * said so. Dragging past a sector edge stopped the arrow dead with no change on
 * screen at all, which reads as a fixed direction and a broken control (G02).
 *
 * This answers the two questions that make the clamp visible: the direction the
 * part will actually take, and whether the genes turned the aim to get there.
 * Pure, so the answer can be tested without a scene.
 */
import { clampGrowthDirectionByGene } from '@plant-legacy/shared/growth';

export interface AimGeneResult {
  /** Unit direction the part will grow along. */
  direction: { x: number; y: number; z: number };
  /** True when the genes turned the aim away from where the drag put it. */
  held: boolean;
  /** How far they turned it, radians. */
  turnedRad: number;
}

/**
 * A drag landing within a degree of the sector's edge is not "held".
 *
 * The clamp returns the same vector for an aim already inside the sector, so the
 * only question is how much it moved. A hair of floating-point drift around the
 * edge would otherwise flicker the arrow's ink and the hint every frame.
 */
export const AIM_GENE_HOLD_TOLERANCE_RAD = 0.0175;

/** The gene sector's answer for one dragged aim. */
export function clampAimToGenes(
  nodeType: string,
  aim: { x: number; y: number; z: number },
): AimGeneResult {
  const length = Math.hypot(aim.x, aim.y, aim.z);
  // A zero aim has no direction to be turned from: the clamp supplies the
  // type's own preferred direction and this reports nothing as held.
  if (!Number.isFinite(length) || length < 1e-4) {
    const fallback = clampGrowthDirectionByGene(nodeType, { x: 0, y: 0, z: 0 });
    return { direction: fallback, held: false, turnedRad: 0 };
  }
  const requested = { x: aim.x / length, y: aim.y / length, z: aim.z / length };
  const direction = clampGrowthDirectionByGene(nodeType, requested);
  const dot = requested.x * direction.x + requested.y * direction.y + requested.z * direction.z;
  const turnedRad = Math.acos(Math.max(-1, Math.min(1, dot)));
  return { direction, held: turnedRad > AIM_GENE_HOLD_TOLERANCE_RAD, turnedRad };
}
