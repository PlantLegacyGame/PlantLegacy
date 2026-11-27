/**
 * The mutation state the HUD reads, and the one rule behind a shed control.
 *
 * T04's mutation list used to live on a bottom-left panel that was later retired
 * into the Inspect panel, and the panel - with the only `MUTATION_SHED` button in
 * the client - went with it while staying in the tree unmounted. So the server
 * charged upkeep for a mutation (E6: an unpaid bill stalls the plant) and nothing
 * on screen could stop it. The list lives in Inspect now; this module keeps the
 * wire payload to the fields the client reads and decides the shed control, so
 * that decision is testable without a browser.
 */

/** The `MUTATION_STATE` fields the client reads. */
export interface MutationStateView {
  mutations: Array<{
    id?: string;
    name: string;
    kind?: string;
    energyPerSecond: number;
    biomassPerSecond: number;
    level?: number;
    maxLevel?: number;
    levelCostEnergy?: number;
    levelCostBiomass?: number;
    levelBlocked?: string;
  }>;
  totalUpkeepEnergyPerSecond?: number;
  pressure?: Record<string, number>;
  shedCooldownRemainingS?: number;
  levelOffer?: {
    mutationId: string;
    level: number;
    cards: Array<{ id: string; label: string; step: number }>;
  } | null;
}

/**
 * The server's cooldown snapshot, counted down locally.
 *
 * `shedCooldownRemainingS` arrives with `MUTATION_STATE`, and the server sends
 * that only when the mutation set changes (a shed, a level, a growth). Held as a
 * snapshot, the number froze: the button stayed disabled after the cooldown had
 * run out, with the title still naming the seconds it started with. The weather
 * chip solves the same thing the same way - keep the arrival time and subtract.
 * The server still owns the refusal; this only keeps the control honest between
 * packets.
 */
export function cooldownRemainingS(snapshotS: number, elapsedS: number): number {
  if (!Number.isFinite(snapshotS) || snapshotS <= 0) return 0;
  if (!Number.isFinite(elapsedS) || elapsedS <= 0) return snapshotS;
  return Math.max(0, snapshotS - elapsedS);
}

export interface MutationShedControl {
  /** The id a click must send: the one the rule just validated. */
  id: string;
  disabled: boolean;
  title: string;
}

/**
 * The shed button for one held mutation, or `null` when there is nothing to name.
 *
 * A row with no id gets no button rather than a button that would send
 * `mutationId: undefined` and be refused. The cooldown is the server's, in
 * seconds: while it runs the button is drawn but cannot be pressed, and its
 * title says how long is left.
 */
export function mutationShedControl(
  mutationId: string | undefined,
  cooldownRemainingS: number,
): MutationShedControl | null {
  const id = mutationId?.trim() ?? '';
  if (id.length === 0) return null;
  const cooling = Number.isFinite(cooldownRemainingS) && cooldownRemainingS > 0;
  if (cooling) {
    return { id, disabled: true, title: `Cooling down ${Math.ceil(cooldownRemainingS)}s` };
  }
  return { id, disabled: false, title: 'Shed it: stop paying its upkeep' };
}
