import type { DevAction } from './devAction.ts';

/** What the caller has to act on: a live plant, a player row, or neither. */
export interface PlantCommandContext {
  hasPlant: boolean;
  hasPlayer: boolean;
}

/** One successful root step, ready to broadcast. */
export interface RootGrowth {
  payload: Record<string, unknown>;
  x: number;
  z: number;
  newNodeId?: string;
}

export interface PlantCommandPorts {
  /** Sets the growth cooldown this many seconds from now. */
  setGrowthCooldown(seconds: number): void;
  setGerminationMins(patch: { moisture?: number; light?: number }): void;
  crownPosition(): { x: number; z: number } | null;
  mutationGallery(center: { x: number; z: number }): Record<string, unknown>;
  grantMutation(mutationId: string): { ok: boolean; reason?: string };
  clearMutations(): number;
  syncMutationState(): void;
  fillEnergy(): void;
  fillTissue(): number;
  fillStoredResources(): { water: number; minerals: number };
  /**
   * Grants items through the locked stored mutation. Resolves with the count the
   * row took and rejects when the write failed, so the answer is the commit and
   * not a prediction.
   */
  grantItem(itemId: string, count: number): Promise<number>;
  endSeason(): { season: string | number };
  /** Tops the plant up enough to grow; false when it no longer exists. */
  prepareRootGrowth(): boolean;
  /** Lowest root (or the crown when there is none), and whether roots exist. */
  rootParent(): { id: string; hasRoots: boolean } | null;
  growRoot(
    parentId: string,
    angle: number,
    nodeType: 'radicle' | 'lateral_root',
  ): { ok: true; growth: RootGrowth } | { ok: false; reason: string };
  broadcastGrowth(growth: RootGrowth): void;
  /** Replaces the plant; returns the new plant's id. */
  regenerate(): string | null;
  sendWelcome(): void;
  settleDeaths(): void;
  respond(actionType: string, payload: Record<string, unknown>): void;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function noPlant(ports: PlantCommandPorts, action: DevAction): true {
  ports.respond(action.type, { ok: false, error: 'no_plant' });
  return true;
}

/**
 * The dev commands that write to the plant itself: its growth gate, mutations,
 * energy, biomass, stored water and minerals, its root chain, items, the season
 * and regeneration.
 *
 * These read and write the handle rather than describing an action on it, which
 * is why they were the last family to leave the switch: the port below spells out
 * exactly which fields a dev command is allowed to touch, and the world keeps the
 * arithmetic that turns a config into a capacity.
 */
export function handlePlantCommand(
  ports: PlantCommandPorts,
  action: DevAction,
  ctx: PlantCommandContext,
): boolean {
  switch (action.type) {
    case 'dev_set_growth': {
      if (!ctx.hasPlant) return noPlant(ports, action);
      // Ticks, not milliseconds: tryGrow compares this field against the tick
      // counter, so a Date.now() value locked the plant out for good. A value
      // that is not a number used to produce a NaN cooldown, which blocked
      // growth just as permanently, so it is ignored instead.
      const cooldown = finite(action.growth_cooldown);
      if (cooldown !== undefined) ports.setGrowthCooldown(cooldown);
      ports.setGerminationMins({
        moisture: finite(action.germination_min_moisture),
        light: finite(action.germination_min_light),
      });
      ports.respond(action.type, { ok: true });
      return true;
    }
    case 'dev_mutation_gallery': {
      if (!ctx.hasPlant) return noPlant(ports, action);
      // Put the row in front of the player who asked for it, far enough back
      // that a mature body does not stand on their own plant.
      const crown = ports.crownPosition() ?? { x: 0, z: 0 };
      const gallery = ports.mutationGallery({ x: crown.x, z: crown.z - 16 });
      ports.respond(action.type, { ok: true, ...gallery });
      return true;
    }
    case 'dev_grant_mutation': {
      if (!ctx.hasPlant || !ctx.hasPlayer) return noPlant(ports, action);
      const mutationId = typeof action.mutationId === 'string' ? action.mutationId : '';
      const granted = ports.grantMutation(mutationId);
      if (granted.ok) ports.syncMutationState();
      ports.respond(action.type, {
        ok: granted.ok,
        reason: granted.reason,
        mutationId,
      });
      return true;
    }
    case 'dev_clear_mutations': {
      if (!ctx.hasPlant || !ctx.hasPlayer) return noPlant(ports, action);
      const cleared = ports.clearMutations();
      ports.syncMutationState();
      ports.respond(action.type, { ok: true, cleared });
      return true;
    }
    case 'dev_fill_energy': {
      if (!ctx.hasPlant) return noPlant(ports, action);
      ports.fillEnergy();
      ports.respond(action.type, { ok: true });
      return true;
    }
    case 'dev_fill_biomass': {
      if (!ctx.hasPlant) return noPlant(ports, action);
      const filled = ports.fillTissue();
      ports.respond(action.type, { ok: true, totalBiomass: filled });
      return true;
    }
    case 'dev_grow_roots': {
      // Root Sight only has something to excavate once the plant has pushed
      // roots down, and growing them by hand takes minutes of play. This grows a
      // chain of real root nodes through the same `tryGrow` the player's growth
      // menu uses, so the skeleton, tunnels and cavity the screenshots show are
      // the real thing.
      if (!ctx.hasPlant || !ctx.hasPlayer) return noPlant(ports, action);
      const steps = Math.max(1, Math.min(24, Number(action.count) || 6));
      const grown: string[] = [];
      const rejected: string[] = [];
      // Chain from the node this command just grew, not from the plant's deepest
      // root every time. A radicle and its laterals all sit at the same depth, so
      // re-asking `rootParent()` handed back the radicle for every step and all
      // the laterals came out of one point - a fan, not a chain of roots.
      let chainFrom: string | null = null;
      for (let step = 0; step < steps; step += 1) {
        if (!ports.prepareRootGrowth()) {
          rejected.push('plant_gone');
          break;
        }
        const parent: { id: string; hasRoots: boolean } | null = chainFrom
          ? { id: chainFrom, hasRoots: true }
          : ports.rootParent();
        if (!parent) {
          rejected.push('no_parent');
          break;
        }
        // A radicle is the only thing a seed may grow downwards, and after it
        // the root layer offers lateral roots (not `root`).
        const result = ports.growRoot(
          parent.id,
          step * 2.399,
          parent.hasRoots ? 'lateral_root' : 'radicle',
        );
        if (!result.ok) {
          rejected.push(result.reason);
          break;
        }
        if (result.growth.newNodeId) grown.push(result.growth.newNodeId);
        chainFrom = result.growth.newNodeId ?? parent.id;
        ports.broadcastGrowth(result.growth);
      }
      ports.respond(action.type, { ok: true, grown, rejected });
      return true;
    }
    case 'dev_fill_resources': {
      // Energy and biomass alone cannot buy growth: `canGrow` also gates on the
      // plant's own captured water and minerals, which only accumulate by
      // absorption over time. Without this action a dev-driven growth chain
      // stalls at the first post-establishment node and looks broken.
      if (!ctx.hasPlant) return noPlant(ports, action);
      const capacity = ports.fillStoredResources();
      ports.respond(action.type, {
        ok: true,
        water: capacity.water,
        minerals: capacity.minerals,
      });
      return true;
    }
    case 'dev_grant_item': {
      // Every item in config/items.json should be readable in the panel, but only
      // three are in a starting pouch and there is no other grant path. Without
      // this action half the definitions could not be seen at all.
      if (!ctx.hasPlayer) return noPlant(ports, action);
      const itemId = typeof action.itemId === 'string' ? action.itemId : '';
      const count =
        typeof action.count === 'number' && Number.isFinite(action.count)
          ? Math.floor(action.count)
          : 1;
      // The write is a locked stored mutation, so the answer is what Postgres
      // committed. A failed write must reach the panel as a failure instead of
      // hearing "applied" for a grant that never landed.
      void ports.grantItem(itemId, count).then(
        (added) => ports.respond(action.type, { ok: added > 0, itemId, added }),
        () => ports.respond(action.type, { ok: false, error: 'grant_failed', itemId }),
      );
      return true;
    }
    case 'dev_end_season': {
      const clock = ports.endSeason();
      ports.respond(action.type, { ok: true, season: clock.season });
      return true;
    }
    case 'dev_regenerate_plant': {
      if (!ctx.hasPlant) return noPlant(ports, action);
      const newPlantId = ports.regenerate();
      if (!newPlantId) return noPlant(ports, action);
      // WELCOME first: PLANT_REMOVED for the old plant must arrive after the
      // client has adopted the new one, or it reads as its own death.
      ports.sendWelcome();
      ports.settleDeaths();
      ports.respond(action.type, { ok: true, newPlantId });
      return true;
    }
    default:
      return false;
  }
}
