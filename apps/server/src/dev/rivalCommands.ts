import type { DevAction } from './devAction.ts';

/** Distance from your own seed to the dev rival, metres. */
const DEV_RIVAL_OFFSET_M = 4;
/** How close a dev rival must be to count as already standing there. */
const DEV_RIVAL_KEEP_CLEAR_M = 6;
/** Owner id of a dev rival: readable in a label, never a real player's id. */
export const DEV_RIVAL_OWNER = 'dev_rival';
/** Noon, the fraction of the day the clock is set to. */
const NOON = 0.5;

export interface RivalCommandPorts {
  /** The caller's own root position, or null when they have no plant. */
  ownRoot(): { x: number; z: number } | null;
  /** Is a dev rival already within `withinM` of that point? */
  hasRivalNear(x: number, z: number, withinM: number): boolean;
  /** Create the rival; returns its id, or null when the world refused. */
  spawnRival(x: number, z: number): string | null;
  /** Put the clock at that fraction of the day and push it to everyone. */
  setDaylight(fraction: number): number;
  respond(actionType: string, payload: Record<string, unknown>): void;
}

/**
 * The rival-click check, made cheap.
 *
 * Confirming that another player's part is clickable used to take a second
 * browser profile (to have a second plant) and a clock reset (germination is
 * gated by light), which is a two-minute setup for a five-second look. One
 * action now stands a rival seed beside your own in daylight (play-test
 * 2026-11-24).
 *
 * `day: false` spawns without touching the clock, for checking the same path at
 * night; every other caller gets the light it needs to arm an aim at all.
 */
export function handleRivalCommand(ports: RivalCommandPorts, action: DevAction): boolean {
  if (action.type !== 'dev_spawn_rival') return false;

  const own = ports.ownRoot();
  if (!own) {
    ports.respond(action.type, { ok: false, reason: 'no_plant' });
    return true;
  }

  // East of your seed, so the rival can never land on top of it.
  const x = own.x + DEV_RIVAL_OFFSET_M;
  const z = own.z;
  const timeOfDay = action.day === false ? undefined : ports.setDaylight(NOON);

  // A second press means "again", not "another one": stacking dev rivals would
  // make the click's pick spheres overlap and the test ambiguous.
  if (ports.hasRivalNear(x, z, DEV_RIVAL_KEEP_CLEAR_M)) {
    ports.respond(action.type, { ok: false, reason: 'already_there', timeOfDay });
    return true;
  }

  const plantId = ports.spawnRival(x, z);
  ports.respond(
    action.type,
    plantId
      ? { ok: true, plantId, x, z, timeOfDay }
      : { ok: false, reason: 'spawn_failed', timeOfDay },
  );
  return true;
}
