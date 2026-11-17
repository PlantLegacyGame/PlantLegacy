/**
 * The dev commands that drive the clock, the saves and the logs.
 *
 * These are the commands that kept the dev switch inside `World`: they reach for
 * the tick clock, the interest manager, the persistence layer and the send
 * counters, so a simple "move the switch" would have meant passing a forty-member
 * façade. The port below is the verbs they actually use, which is both smaller
 * and honest about what a dev command is allowed to touch; the rest of the switch
 * is splitting into families the same way.
 */
export interface DevAction {
  type: string;
  [key: string]: unknown;
}

export interface SimulationCommandPorts {
  setTickRate(hz: number): void;
  pauseSimulation(): void;
  resumeSimulation(): void;
  stepSimulationOnce(): void;
  setInterestCellSize(size: number): void;
  setInterestRingRadius(radius: number): void;
  setTierRates(rates: { nearTickRateHz?: number; dormantStepIntervalSec?: number }): void;
  /** Saves every plant and reports what landed. */
  savePlants(): Promise<Record<string, unknown>>;
  clearPersistence(): Promise<void>;
  createRandomPlants(count: number): void;
  applyConfig(key: string, value: unknown): Record<string, unknown>;
  plantSummaries(): Array<{ id: string; owner: string; biomass: number }>;
  resourceTiles(): unknown;
  networkStats(): Record<string, unknown>;
  respond(actionType: string, payload: Record<string, unknown>): void;
  logInfo(message: string, meta?: Record<string, unknown>): void;
}

/** Runs one clock/save/log dev command; false when the action is not one of ours. */
export function handleSimulationCommand(ports: SimulationCommandPorts, action: DevAction): boolean {
  switch (action.type) {
    case 'dev_set_tick_rate': {
      if (action.rate !== undefined) ports.setTickRate(action.rate as number);
      ports.respond(action.type, { ok: true });
      return true;
    }
    case 'dev_pause_simulation': {
      ports.pauseSimulation();
      ports.respond(action.type, { ok: true });
      return true;
    }
    case 'dev_resume_simulation': {
      ports.resumeSimulation();
      ports.respond(action.type, { ok: true });
      return true;
    }
    case 'dev_step_simulation': {
      ports.stepSimulationOnce();
      ports.respond(action.type, { ok: true });
      return true;
    }
    case 'dev_set_simulation': {
      if (action.cell_size !== undefined) ports.setInterestCellSize(action.cell_size as number);
      if (action.interest_ring_radius !== undefined) {
        ports.setInterestRingRadius(action.interest_ring_radius as number);
      }
      // These three used to call InterestManager no-ops, so the controls did
      // nothing. The active rate changes the single simulation/wire clock, which
      // also updates the plant tier rates; near/dormant only exist in PlantWorld.
      if (action.active_tick_rate_hz !== undefined) {
        const hz = Number(action.active_tick_rate_hz);
        if (Number.isFinite(hz) && hz > 0) ports.setTickRate(hz);
      }
      if (action.near_tick_rate_hz !== undefined) {
        ports.setTierRates({ nearTickRateHz: Number(action.near_tick_rate_hz) });
      }
      if (action.dormant_step_interval_sec !== undefined) {
        ports.setTierRates({
          dormantStepIntervalSec: Number(action.dormant_step_interval_sec),
        });
      }
      ports.respond(action.type, { ok: true });
      return true;
    }
    case 'dev_force_save': {
      // This used to call a placeholder that saved nothing and ignored the
      // returned promise. Save for real, and report what actually landed.
      ports
        .savePlants()
        .then((result) => ports.respond(action.type, { ok: true, ...result }))
        .catch((error: unknown) => ports.respond(action.type, { ok: false, error: String(error) }));
      return true;
    }
    case 'dev_clear_persistence': {
      ports
        .clearPersistence()
        .then(() => ports.respond(action.type, { ok: true }))
        .catch((error: unknown) => ports.respond(action.type, { ok: false, error: String(error) }));
      return true;
    }
    case 'dev_log_plants': {
      ports.logInfo('Dev: Plant dump', { plants: ports.plantSummaries() });
      ports.respond(action.type, { ok: true });
      return true;
    }
    case 'dev_log_resources': {
      ports.logInfo('Dev: Resource dump', { resources: ports.resourceTiles() });
      ports.respond(action.type, { ok: true });
      return true;
    }
    case 'dev_log_network': {
      const stats = ports.networkStats();
      ports.logInfo('Dev: Network stats', { ...stats });
      ports.respond(action.type, { ok: true, ...stats });
      return true;
    }
    case 'dev_toggle_webgpu':
    case 'dev_reinit_renderer':
    case 'dev_dump_shaders': {
      // Client-side only actions, just acknowledge.
      ports.respond(action.type, { ok: true });
      return true;
    }
    case 'dev_stress_test': {
      // Clamp: the count arrives from the client and an unbounded value would
      // create plants until the server runs out of memory.
      const requested = Number(action.count);
      const count = Number.isFinite(requested)
        ? Math.max(1, Math.min(500, Math.floor(requested)))
        : 100;
      ports.createRandomPlants(count);
      ports.respond(action.type, { ok: true, created: count });
      return true;
    }
    case 'dev_set_config': {
      const key = action.key as string;
      const value = action.value;
      if (!key || value === undefined) {
        ports.respond(action.type, { ok: false, error: 'missing_key_or_value' });
        return true;
      }
      // Exactly one response per request. The previous version sent a success
      // after the error branch too, so failures looked successful.
      ports.respond(action.type, ports.applyConfig(key, value));
      return true;
    }
    default:
      return false;
  }
}
