import type { PlantEvent } from './persistence/plantPersistence.ts';

/**
 * In-memory per-plant event log (INV-PR-07).
 *
 * The log is written to `world_plants.event_log` on every save, so it survives
 * restarts and stays a real audit trail rather than a placeholder. It is bounded
 * by `world.event_log_compaction_threshold`: when a plant exceeds the limit the
 * oldest entries are dropped, keeping the newest history instead of growing a
 * JSONB column without limit for the life of the plant.
 */
export class PlantEventLog {
  private readonly events = new Map<string, PlantEvent[]>();
  private readonly limit: number;

  constructor(compactionThreshold: number) {
    this.limit = Math.max(1, Math.floor(compactionThreshold));
  }

  /** Append one event, trimming the oldest entries past the threshold. */
  append(plantId: string, event: PlantEvent): void {
    let list = this.events.get(plantId);
    if (!list) {
      list = [];
      this.events.set(plantId, list);
    }
    list.push(event);
    if (list.length > this.limit) {
      list.splice(0, list.length - this.limit);
    }
  }

  /** Events for a plant, oldest first. Never returns the internal array. */
  get(plantId: string): PlantEvent[] {
    return this.events.get(plantId)?.slice() ?? [];
  }

  /** Adopt events loaded from the database, applying the same bound. */
  seed(plantId: string, events: PlantEvent[]): void {
    if (events.length === 0) return;
    this.events.set(plantId, events.slice(-this.limit));
  }

  /** Drop a plant's history once its row is deleted from persistence. */
  delete(plantId: string): void {
    this.events.delete(plantId);
  }

  size(plantId: string): number {
    return this.events.get(plantId)?.length ?? 0;
  }

  get plantCount(): number {
    return this.events.size;
  }
}
