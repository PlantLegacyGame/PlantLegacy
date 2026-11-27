/**
 * The rules that differ between the ground rig and a free-flight camera.
 *
 * These are pure so the mode split can be checked without a browser: in
 * particular, a free camera must keep the configured polar limit when Root
 * Sight opens a cavity, and none of the ground-follow / ground-clamp rules may
 * run while no input is being given.
 */
export type CameraRigMode = 'free' | 'ground';

/** Ground clamps, aim lean and pivot follow belong to the standing rig only. */
export function cameraGroundRulesApply(mode: CameraRigMode): boolean {
  return mode === 'ground';
}

/**
 * The orbit's polar ceiling.
 *
 * A free camera owns its configured limit. The ground rig may open it while the
 * player is deliberately below the soil with Root Sight, so the cavity is not
 * seen edge-on from above.
 */
export function cameraPolarLimit(
  mode: CameraRigMode,
  rootSightUnderground: boolean,
  configuredLimit: number,
): number {
  if (mode === 'free') return configuredLimit;
  return rootSightUnderground ? Math.PI - 0.05 : configuredLimit;
}
