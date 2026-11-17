import type { DevAction } from './devAction.ts';

export type UprootCause = 'saturation' | 'gust' | 'collapse' | 'structural_damage';

/**
 * The plant a dev command acts on, or `undefined` when the caller has none
 * (dead plant, or no damage pipeline). The caller resolves this once, so the
 * commands below share one "no plant" path instead of six copies of it.
 */
export interface PlantTarget {
  plantId: string;
  playerId: string;
  /** Crown position; the swarm and collapse commands start from it. */
  root: { x: number; z: number } | null;
}

export interface DamageCommandPorts {
  defaultToolDamage(): number;
  applyToolDamage(amount: number): void;
  killPlant(): void;
  forceUproot(cause: UprootCause): boolean;
  requestReroot(dirX: number, dirZ: number): boolean;
  forceSwarm(x: number, z: number): void;
  forceCollapse(x: number, z: number): void;
  processDamageEvents(): void;
  processPlantDeaths(): void;
  respond(actionType: string, payload: Record<string, unknown>): void;
}

/**
 * The dev commands that injure a plant: kill, tool damage, the two forced
 * uproots, reroot steering, the herbivore swarm and the terrain collapse.
 *
 * Each one ends by settling the damage it caused, and the order matters — the
 * death broadcast has to follow the death, and a collapse can kill what the
 * first settle already wounded. The sequences are kept exactly as they were
 * while they lived in the switch.
 */
export function handleDamageCommand(
  ports: DamageCommandPorts,
  action: DevAction,
  target: PlantTarget | undefined,
): boolean {
  switch (action.type) {
    case 'dev_kill_plant':
    case 'dev_damage_plant':
    case 'dev_uproot_plant':
    case 'dev_reroot':
    case 'dev_herbivore_swarm':
    case 'dev_terrain_collapse':
      break;
    default:
      return false;
  }

  if (!target) {
    ports.respond(action.type, { ok: false, error: 'no_plant' });
    return true;
  }

  switch (action.type) {
    case 'dev_kill_plant': {
      ports.killPlant();
      // Settle the death now: the broadcast normally waits for the next tick, so
      // with the simulation paused the client never heard about it.
      ports.processPlantDeaths();
      ports.processDamageEvents();
      ports.respond(action.type, { ok: true });
      return true;
    }
    case 'dev_damage_plant': {
      const requested = action.amount;
      const amount =
        typeof requested === 'number' && Number.isFinite(requested)
          ? requested
          : ports.defaultToolDamage();
      ports.applyToolDamage(amount);
      ports.processDamageEvents();
      ports.processPlantDeaths();
      ports.processDamageEvents();
      ports.respond(action.type, { ok: true, amount });
      return true;
    }
    case 'dev_uproot_plant': {
      const requested = action.cause;
      const cause: UprootCause =
        requested === 'saturation' ||
        requested === 'gust' ||
        requested === 'collapse' ||
        requested === 'structural_damage'
          ? requested
          : 'gust';
      const uprooted = ports.forceUproot(cause);
      ports.processDamageEvents();
      ports.respond(action.type, { ok: uprooted, cause });
      return true;
    }
    case 'dev_reroot': {
      const dirX = typeof action.dirX === 'number' ? action.dirX : 1;
      const dirZ = typeof action.dirZ === 'number' ? action.dirZ : 0;
      const steered = ports.requestReroot(dirX, dirZ);
      ports.respond(action.type, { ok: steered, dirX, dirZ });
      return true;
    }
    case 'dev_herbivore_swarm': {
      ports.forceSwarm(target.root?.x ?? 0, target.root?.z ?? 0);
      ports.processDamageEvents();
      ports.respond(action.type, { ok: true });
      return true;
    }
    case 'dev_terrain_collapse': {
      ports.forceCollapse(target.root?.x ?? 0, target.root?.z ?? 0);
      ports.processDamageEvents();
      ports.processPlantDeaths();
      ports.processDamageEvents();
      ports.respond(action.type, { ok: true });
      return true;
    }
    default:
      return false;
  }
}
