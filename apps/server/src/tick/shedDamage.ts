/**
 * Coalescing for upkeep damage on the wire.
 *
 * `PlantWorld.drainShedDamage` batches tissue loss per plant per tick, so a
 * wilting plant produced a PLANT_DAMAGE message every tick (20 Hz). The client
 * draws one damage cue per message, which turned upkeep into a constant
 * flicker. Accumulating here and flushing on the damage pipeline's cadence
 * (tickRate/2) keeps the numbers exact - the amounts are summed, not sampled -
 * while cutting the message rate.
 */
export interface ShedDamage {
  plantId: string;
  amount: number;
  totalBiomass: number;
}

/** The damage pipeline's own broadcast cadence: twice a second at 20 Hz. */
export function shedFlushIntervalTicks(tickRateHz: number): number {
  const rate = Number.isFinite(tickRateHz) && tickRateHz > 0 ? tickRateHz : 20;
  return Math.max(1, Math.round(rate / 2));
}

/** Add one tick's loss to what is waiting for that plant. */
export function accumulateShedDamage(queued: Map<string, ShedDamage>, shed: ShedDamage): void {
  if (!Number.isFinite(shed.amount) || shed.amount <= 0) return;
  const prior = queued.get(shed.plantId);
  queued.set(shed.plantId, {
    plantId: shed.plantId,
    amount: (prior?.amount ?? 0) + shed.amount,
    totalBiomass: shed.totalBiomass,
  });
}

/** The losses worth one message each, rounded for the wire. Draining clears. */
export function drainQueuedShedDamage(queued: Map<string, ShedDamage>): ShedDamage[] {
  if (queued.size === 0) return [];
  const drained = Array.from(queued.values(), (entry) => ({
    plantId: entry.plantId,
    amount: Number(entry.amount.toFixed(3)),
    totalBiomass: Number(entry.totalBiomass.toFixed(3)),
  }));
  queued.clear();
  return drained;
}
