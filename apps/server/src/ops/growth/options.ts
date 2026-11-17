/**
 * Builds the server-authoritative growth menu for one node (INV-GR-13).
 *
 * The menu is a pure function of the plant, the node and the tile under it, so
 * it lives beside the other growth rules instead of inside `PlantWorld`. Every
 * figure it quotes starts from `computeGrowthCostQuote` and then carries the
 * same charge scale `tryGrow` applies (soil resistance, mutation cost/speed), so
 * the price on a card is the price the server takes.
 */
import type {
  GrowthConfig,
  GrowthOption,
  GrowthOptionsResult,
  NodeType,
  NodeTypeDefinition,
  Plant,
  PlantNode,
} from '@plant-legacy/shared/growth';
import {
  getAvailableGrowthTypes,
  getLayerForNodeType,
  getNodeTypeDefinition,
} from '@plant-legacy/shared/growth';
import {
  canGrow,
  computeGrowthCostQuote,
  type GrowthChargeScale,
  germinationGateReason,
  maxCotyledonsForPlant,
  NEUTRAL_GROWTH_SCALE,
  scaleGrowthQuote,
} from './rules.ts';

export interface GrowableTile {
  light: number;
  moisture: number;
  minerals: number;
}

/** Tile values used when the world has no resource provider (tests, early boot). */
const FALLBACK_TILE: GrowableTile = { light: 100, moisture: 100, minerals: 100 };

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * All node types this plant may add to this node, with cost, availability and a
 * plain reason when unavailable.
 */
export function buildGrowthOptions(
  config: GrowthConfig,
  plant: Plant,
  node: PlantNode,
  tile: GrowableTile = FALLBACK_TILE,
  /** Node types a mutation unlocked on top of the base rules (T04). */
  unlockedTypes: NodeType[] = [],
  /** Share of the stored-resource gate a clonal network covers (T04). */
  storedResourceSharing = 0,
  /**
   * Tissue mass the grown part holds per unit of build cost (T04 size
   * mutations: `scale³` for the parent node's layer). Quoted so the menu
   * matches the mass the part actually ends up with.
   */
  massScale = 1,
  /**
   * What the charge adds on top of the bare quote for this target type. The
   * menu must quote the price the server will actually charge, or a card can
   * offer growth the server then refuses.
   */
  chargeScaleFor: (targetType: NodeType) => GrowthChargeScale = () => NEUTRAL_GROWTH_SCALE,
): GrowthOptionsResult {
  const safeMoisture = finiteOr(tile.moisture, 40);
  const safeLight = finiteOr(tile.light, 80);

  // For germination: check tile light/moisture (respects dev germinationGate)
  // For growth: check plant's stored water/minerals
  const germinationOk =
    config.germinationGate === false ||
    (safeLight >= config.germinationMinLight && safeMoisture >= config.germinationMinMoisture);

  // Check if plant has enough stored resources for growth
  const hasStoredWater = plant.storedWater >= config.growthMinWater;
  const hasStoredMinerals = plant.storedMinerals >= config.growthMinMinerals;

  const conditions = {
    light: safeLight,
    moisture: safeMoisture,
    storedWater: plant.storedWater,
    storedMinerals: plant.storedMinerals,
    minLight: config.germinationMinLight,
    minMoisture: config.germinationMinMoisture,
    growthMinWater: config.growthMinWater,
    growthMinMinerals: config.growthMinMinerals,
    ok: germinationOk, // For germination check
    growthOk: hasStoredWater && hasStoredMinerals, // For growth check
  };

  const options: GrowthOption[] = [];

  /** One quote, already carrying the soil/mutation multipliers of the charge. */
  const quoteFor = (def: NodeTypeDefinition, targetType: NodeType) =>
    scaleGrowthQuote(computeGrowthCostQuote(config, def, massScale), chargeScaleFor(targetType));

  const addOption = (
    type: NodeType,
    label: string,
    energyCost: number,
    biomassGain: number,
    expectedSeconds: number,
    available: boolean,
    reason?: string,
    risk?: string,
    waterCost?: number,
    nutrientCost?: number,
    mineralCost?: number,
  ) => {
    options.push({
      type,
      label,
      energyCost,
      biomassGain,
      expectedSeconds,
      available,
      reason,
      risk,
      waterCost,
      nutrientCost,
      mineralCost,
    });
  };

  const result = (): GrowthOptionsResult => ({
    nodeId: node.id,
    nodeType: node.type,
    isSeed: !!node.isSeed,
    energy: plant.totalEnergy,
    biomass: plant.totalBiomass,
    options,
    conditions,
  });

  /**
   * Energy plus stored-resource availability, phrased for the panel.
   *
   * The storage half delegates to `canGrow`, the predicate `tryGrow` enforces. A
   * hand-written copy here checked `growth_min_minerals` (6) while `canGrow` also
   * required `growth_min_nutrients` (8), so the panel offered growth that the
   * server then rejected.
   */
  const storageReason = (energyCost: number): { available: boolean; reason?: string } => {
    if (plant.totalEnergy < energyCost) return { available: false, reason: 'Insufficient energy' };
    const storage = canGrow(plant, config, storedResourceSharing);
    if (!storage.ok) return { available: false, reason: storage.reason };
    return { available: true };
  };

  if (node.type === 'seed') {
    const radicleDef = config.radicleNode;
    const cotyledonDef = config.cotyledonNode;
    const hasRadicle = node.children.some((id) => {
      const child = plant.nodes.get(id);
      return child && (child.type === 'radicle' || child.type === 'root');
    });
    const cotyledonCount = node.children.filter(
      (id) => plant.nodes.get(id)?.type === 'cotyledon',
    ).length;
    const maxCotyledons = maxCotyledonsForPlant(config);

    if (node.isSeed) {
      if (!hasRadicle) {
        const costs = quoteFor(radicleDef, 'radicle');
        addOption(
          'radicle',
          'Sprout Radicle',
          costs.energyCost,
          costs.biomassGain,
          costs.growthTimeSeconds,
          germinationOk && plant.totalEnergy >= costs.energyCost,
          germinationOk
            ? plant.totalEnergy < costs.energyCost
              ? 'Insufficient energy'
              : undefined
            : germinationGateReason(safeLight, safeMoisture, config),
          germinationOk ? 'Failure can destroy the seed if conditions are not met' : undefined,
          costs.waterCost,
          costs.nutrientCost,
          costs.mineralCost,
        );
        return result();
      }

      if (cotyledonCount < maxCotyledons) {
        const costs = quoteFor(cotyledonDef, 'cotyledon');
        addOption(
          'cotyledon',
          `Add Cotyledon ${cotyledonCount + 1}/${maxCotyledons}`,
          costs.energyCost,
          costs.biomassGain,
          costs.growthTimeSeconds,
          plant.totalEnergy >= costs.energyCost,
          plant.totalEnergy < costs.energyCost ? 'Insufficient energy' : undefined,
          undefined,
          costs.waterCost,
          costs.nutrientCost,
          costs.mineralCost,
        );
        return result();
      }
    } else if (cotyledonCount < maxCotyledons) {
      // An established crown (isSeed cleared) that has not reached its cotyledon
      // limit is still a cotyledon parent in `tryGrow`. Offering it here keeps the
      // menu from skipping straight to a stem the server would refuse with
      // `establish_seed_before_stem`.
      const costs = quoteFor(cotyledonDef, 'cotyledon');
      addOption(
        'cotyledon',
        `Add Cotyledon ${cotyledonCount + 1}/${maxCotyledons}`,
        costs.energyCost,
        costs.biomassGain,
        costs.growthTimeSeconds,
        plant.totalEnergy >= costs.energyCost,
        plant.totalEnergy < costs.energyCost ? 'Insufficient energy' : undefined,
        undefined,
        costs.waterCost,
        costs.nutrientCost,
        costs.mineralCost,
      );
      return result();
    }

    // Established crown (its cotyledon limit reached): offer stem. tryGrow
    // allows a stem from a seed crown once that limit is met.
    {
      const costs = quoteFor(config.stemNode, 'stem');
      const { available, reason } = storageReason(costs.energyCost);
      addOption(
        'stem',
        'Grow Stem',
        costs.energyCost,
        costs.biomassGain,
        costs.growthTimeSeconds,
        available,
        reason,
        undefined,
        costs.waterCost,
        costs.nutrientCost,
        costs.mineralCost,
      );
      return result();
    }
  }

  // Canopy parts only sprout from the crown. "Grow Stem" used to be offered on
  // any root node, so picking it sent a stem out of a buried root and it read
  // as another root growing sideways.
  const baseTypes = getAvailableGrowthTypes(node.type, config);
  // A mutation can open a menu entry the base rules refuse. Unlocked types are
  // held to the same layer rule: a mutation never grows canopy from a buried root.
  const extraTypes = unlockedTypes.filter(
    (targetType) =>
      !baseTypes.includes(targetType) && getLayerForNodeType(targetType) === node.layer,
  );
  const availableTypes = [...baseTypes, ...extraTypes].filter(
    (targetType) =>
      !(
        getLayerForNodeType(targetType) === 'canopy' &&
        node.layer === 'root' &&
        node.id !== plant.rootNodeId
      ),
  );

  for (const targetType of availableTypes) {
    const nodeDef = getNodeTypeDefinition(config, targetType);
    const costs = quoteFor(nodeDef, targetType);
    const { available, reason } = storageReason(costs.energyCost);

    addOption(
      targetType,
      `Grow ${targetType.replace('_', ' ')}`,
      costs.energyCost,
      costs.biomassGain,
      costs.growthTimeSeconds,
      available,
      reason,
      undefined,
      costs.waterCost,
      costs.nutrientCost,
      costs.mineralCost,
    );
  }

  return result();
}
