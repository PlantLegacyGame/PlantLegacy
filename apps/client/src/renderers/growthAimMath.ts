import type * as THREE from 'three';

/** Screen-pixel drag to aim-direction gain. */
export const GROWTH_AIM_DRAG_GAIN = 0.0045;

/**
 * Turn an aim direction from a pointer drag, using the camera's own right and
 * up axes.
 *
 * World-space yaw/pitch deltas only line up with the screen when the camera
 * looks straight down +Z. From any orbit they invert: dragging right swings the
 * arrow left and dragging down pushes it up. Projecting the drag onto the
 * camera basis keeps the arrow under the cursor at every camera angle.
 */
export function aimDirectionFromScreenDrag(
  direction: THREE.Vector3,
  cameraRight: THREE.Vector3,
  cameraUp: THREE.Vector3,
  deltaX: number,
  deltaY: number,
  gain = GROWTH_AIM_DRAG_GAIN,
): THREE.Vector3 {
  return direction
    .clone()
    .addScaledVector(cameraRight, deltaX * gain)
    .addScaledVector(cameraUp, -deltaY * gain)
    .normalize();
}
