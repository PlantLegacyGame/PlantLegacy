import type {
  GrowthConfig,
  GrowthIntent,
  GrowthResult,
  Layer,
  NodeType,
  Plant,
  PlantNode,
} from '@plant-legacy/shared/growth';
import { getLayerForNodeType, getNodeTypeDefinition } from '@plant-legacy/shared/growth';
import { newId } from '@plant-legacy/shared/ids';
import { clamp } from '@plant-legacy/shared/math';

function getGrowthSpeed(config: GrowthConfig, layer: Layer): number {
  return layer === 'root' ? config.rootGrowthSpeed : config.canopyGrowthSpeed;
}

function normalizeDirection(dir: { x: number; y: number; z: number }): {
  x: number;
  y: number;
  z: number;
} {
  const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  return { x: dir.x / len, y: dir.y / len, z: dir.z / len };
}

function distance3d(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export class PlantWorld {
  private plants = new Map<string, Plant>();
  private plantByOwner = new Map<string, Set<string>>();
  private nodeSpatialIndex = new Map<string, Set<string>>();
  private readonly cellSize = 10;
  private tick = 0;
  private readonly config: GrowthConfig;
  private readonly worldBounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    minY: number;
    maxY: number;
  };

  constructor(
    config: GrowthConfig,
    worldBounds: {
      minX: number;
      maxX: number;
      minZ: number;
      maxZ: number;
      minY: number;
      maxY: number;
    },
  ) {
    this.config = config;
    this.worldBounds = worldBounds;
  }

  private getCellKey(x: number, y: number, z: number): string {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    return `${cx},${cy},${cz}`;
  }

  private getCellKeysForRadius(x: number, y: number, z: number, radius: number): string[] {
    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCy = Math.floor((y - radius) / this.cellSize);
    const maxCy = Math.floor((y + radius) / this.cellSize);
    const minCz = Math.floor((z - radius) / this.cellSize);
    const maxCz = Math.floor((z + radius) / this.cellSize);
    const keys: string[] = [];
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        for (let cz = minCz; cz <= maxCz; cz++) {
          keys.push(`${cx},${cy},${cz}`);
        }
      }
    }
    return keys;
  }

  private addNodeToSpatialIndex(node: PlantNode): void {
    const key = this.getCellKey(node.x, node.y, node.z);
    if (!this.nodeSpatialIndex.has(key)) {
      this.nodeSpatialIndex.set(key, new Set());
    }
    this.nodeSpatialIndex.get(key)?.add(node.id);
  }

  private removeNodeFromSpatialIndex(node: PlantNode): void {
    const key = this.getCellKey(node.x, node.y, node.z);
    const set = this.nodeSpatialIndex.get(key);
    if (set) {
      set.delete(node.id);
      if (set.size === 0) {
        this.nodeSpatialIndex.delete(key);
      }
    }
  }

  private getNearbyNodeIds(x: number, y: number, z: number, radius: number): string[] {
    const keys = this.getCellKeysForRadius(x, y, z, radius);
    const ids = new Set<string>();
    for (const key of keys) {
      const set = this.nodeSpatialIndex.get(key);
      if (set) {
        for (const id of set) {
          ids.add(id);
        }
      }
    }
    return Array.from(ids);
  }

  createPlant(ownerId: string, worldId: string, startX: number, startZ: number): Plant {
    const plantId = newId('plant');
    const rootNodeId = newId('node');

    const rootDef = this.config.rootNode;
    const rootNode: PlantNode = {
      id: rootNodeId,
      plantId,
      type: 'root',
      layer: 'root',
      x: startX,
      y: 0,
      z: startZ,
      biomass: rootDef.biomass_cost,
      age: 0,
      parentId: null,
      children: [],
      statModifiers: { ...rootDef.stat_modifiers },
      resourceDrawWater: rootDef.resource_draw_water,
      resourceDrawNutrients: rootDef.resource_draw_nutrients,
      upkeepBiomassPerSecond: rootDef.upkeep_biomass_per_second,
      growthDirectionBias: rootDef.growth_direction_bias,
      lastGrowthTick: 0,
    };

    // Start with enough biomass for the root plus some extra for initial growth
    const initialBiomass = rootDef.biomass_cost + this.config.nodeCostBase * 2;

    const plant: Plant = {
      id: plantId,
      ownerId,
      worldId,
      nodes: new Map([[rootNodeId, rootNode]]),
      rootNodeId,
      totalBiomass: initialBiomass,
      totalUpkeep: rootDef.upkeep_biomass_per_second,
      lastGrowthTick: 0,
      growthCooldownUntil: 0,
    };

    this.plants.set(plantId, plant);
    if (!this.plantByOwner.has(ownerId)) {
      this.plantByOwner.set(ownerId, new Set());
    }
    this.plantByOwner.get(ownerId)?.add(plantId);
    this.addNodeToSpatialIndex(rootNode);

    return plant;
  }

  getPlant(plantId: string): Plant | undefined {
    return this.plants.get(plantId);
  }

  getPlantsByOwner(ownerId: string): Plant[] {
    const ids = this.plantByOwner.get(ownerId);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.plants.get(id))
      .filter((p): p is Plant => p !== undefined);
  }

  getAllPlants(): Plant[] {
    return Array.from(this.plants.values());
  }

  step(dt: number): void {
    this.tick++;
    for (const plant of this.plants.values()) {
      this.processPlantUpkeep(plant, dt);
      this.processRootOverlapDamage(plant);
    }
  }

  private processPlantUpkeep(plant: Plant, dt: number): void {
    let biomassChange = -plant.totalUpkeep * dt;
    for (const node of plant.nodes.values()) {
      biomassChange -= node.upkeepBiomassPerSecond * dt;
    }
    plant.totalBiomass = Math.max(0, plant.totalBiomass + biomassChange);
    if (plant.totalBiomass <= 0) {
      this.removePlant(plant.id);
    }
  }

  private processRootOverlapDamage(plant: Plant): void {
    for (const node of plant.nodes.values()) {
      if (node.layer !== 'root') continue;
      const nearbyIds = this.getNearbyNodeIds(node.x, node.y, node.z, 2.0);
      for (const nearbyId of nearbyIds) {
        if (nearbyId === node.id) continue;
        const nearbyPlant = this.findPlantByNodeId(nearbyId);
        if (!nearbyPlant || nearbyPlant.id === plant.id) continue;
        const nearbyNode = nearbyPlant.nodes.get(nearbyId);
        if (nearbyNode?.layer !== 'root') continue;
        const dist = distance3d(node, nearbyNode);
        if (dist < 1.5) {
          const damage = this.config.rootOverlapPressureDamage;
          this.applyDamageToPlant(nearbyPlant, damage);
        }
      }
    }
  }

  private findPlantByNodeId(nodeId: string): Plant | undefined {
    for (const plant of this.plants.values()) {
      if (plant.nodes.has(nodeId)) return plant;
    }
    return undefined;
  }

  private applyDamageToPlant(plant: Plant, damage: number): void {
    plant.totalBiomass = Math.max(0, plant.totalBiomass - damage);
    if (plant.totalBiomass <= 0) {
      this.removePlant(plant.id);
    }
  }

  tryGrow(intent: GrowthIntent): GrowthResult {
    const plant = this.plants.get(intent.plantId);
    if (!plant) return { success: false, reason: 'plant_not_found' };
    if (plant.ownerId !== intent.plantId.split('_')[1] && !intent.plantId.startsWith('p_')) {
    }
    if (this.tick < plant.growthCooldownUntil) {
      return { success: false, reason: 'growth_on_cooldown' };
    }
    if (plant.nodes.size >= this.config.maxNodesPerPlant) {
      return { success: false, reason: 'max_nodes_reached' };
    }

    const parentNode = plant.nodes.get(intent.nodeId);
    if (!parentNode) return { success: false, reason: 'parent_node_not_found' };

    const targetType = intent.nodeType;
    const targetLayer = getLayerForNodeType(targetType);
    const parentLayer = parentNode.layer;

    if (targetLayer !== parentLayer && !this.canCrossLayer(parentNode, targetType)) {
      return { success: false, reason: 'cannot_cross_layer' };
    }

    const dir = normalizeDirection(intent.direction);
    const speed = getGrowthSpeed(this.config, targetLayer);
    const newX = parentNode.x + dir.x * speed;
    const newY = parentNode.y + dir.y * speed;
    const newZ = parentNode.z + dir.z * speed;

    if (!this.isInBounds(newX, newY, newZ)) {
      return { success: false, reason: 'out_of_bounds' };
    }

    const nodeDef = getNodeTypeDefinition(this.config, targetType);
    const cost = nodeDef.biomass_cost;

    if (plant.totalBiomass < cost) {
      return { success: false, reason: 'insufficient_biomass_for_node' };
    }

    if (plant.totalBiomass < this.config.nodeCostBase) {
      return { success: false, reason: 'insufficient_biomass' };
    }

    const newNodeId = newId('node');
    const newNode: PlantNode = {
      id: newNodeId,
      plantId: plant.id,
      type: targetType,
      layer: targetLayer,
      x: newX,
      y: newY,
      z: newZ,
      biomass: cost,
      age: 0,
      parentId: intent.nodeId,
      children: [],
      statModifiers: { ...nodeDef.stat_modifiers },
      resourceDrawWater: nodeDef.resource_draw_water,
      resourceDrawNutrients: nodeDef.resource_draw_nutrients,
      upkeepBiomassPerSecond: nodeDef.upkeep_biomass_per_second,
      growthDirectionBias: nodeDef.growth_direction_bias,
      lastGrowthTick: this.tick,
    };

    plant.nodes.set(newNodeId, newNode);
    plant.totalBiomass -= cost;
    plant.totalUpkeep += nodeDef.upkeep_biomass_per_second;
    plant.lastGrowthTick = this.tick;
    plant.growthCooldownUntil = this.tick + Math.ceil(this.config.growthCooldown * 20);

    parentNode.children.push(newNodeId);
    this.addNodeToSpatialIndex(newNode);

    let damageDealt = 0;
    if (intent.isAttack && targetLayer === 'root') {
      damageDealt = this.processRootAttack(newNode, plant);
    }

    return { success: true, newNode, damageDealt: damageDealt > 0 ? damageDealt : undefined };
  }

  private canCrossLayer(parent: PlantNode, targetType: NodeType): boolean {
    if (parent.type === 'root' && targetType === 'stem') return true;
    if (
      parent.type === 'stem' &&
      (targetType === 'leaf' ||
        targetType === 'flower' ||
        targetType === 'spore_sac' ||
        targetType === 'vine')
    )
      return true;
    if (
      parent.type === 'vine' &&
      (targetType === 'leaf' || targetType === 'flower' || targetType === 'spore_sac')
    )
      return true;
    return false;
  }

  private isInBounds(x: number, y: number, z: number): boolean {
    return (
      x >= this.worldBounds.minX &&
      x <= this.worldBounds.maxX &&
      y >= this.worldBounds.minY &&
      y <= this.worldBounds.maxY &&
      z >= this.worldBounds.minZ &&
      z <= this.worldBounds.maxZ
    );
  }

  private processRootAttack(newNode: PlantNode, attackerPlant: Plant): number {
    const nearbyIds = this.getNearbyNodeIds(newNode.x, newNode.y, newNode.z, 2.0);
    let totalDamage = 0;
    for (const nearbyId of nearbyIds) {
      if (nearbyId === newNode.id) continue;
      const nearbyPlant = this.findPlantByNodeId(nearbyId);
      if (!nearbyPlant || nearbyPlant.id === attackerPlant.id) continue;
      const nearbyNode = nearbyPlant.nodes.get(nearbyId);
      if (nearbyNode?.layer !== 'root') continue;
      const dist = distance3d(newNode, nearbyNode);
      if (dist < 1.5) {
        const damage =
          this.config.rootOverlapPressureDamage * this.config.rootAttackDamageMultiplier;
        this.applyDamageToPlant(nearbyPlant, damage);
        totalDamage += damage;
      }
    }
    return totalDamage;
  }

  removePlant(plantId: string): void {
    const plant = this.plants.get(plantId);
    if (!plant) return;
    for (const node of plant.nodes.values()) {
      this.removeNodeFromSpatialIndex(node);
    }
    this.plants.delete(plantId);
    const ownerPlants = this.plantByOwner.get(plant.ownerId);
    if (ownerPlants) {
      ownerPlants.delete(plantId);
      if (ownerPlants.size === 0) {
        this.plantByOwner.delete(plant.ownerId);
      }
    }
  }

  getCanopyShadingAt(x: number, z: number): number {
    let totalShading = 0;
    for (const plant of this.plants.values()) {
      for (const node of plant.nodes.values()) {
        if (node.layer !== 'canopy') continue;
        const dx = node.x - x;
        const dz = node.z - z;
        const distSq = dx * dx + dz * dz;
        if (distSq < 16) {
          totalShading += this.config.lightBlockingPerNode * (1 - distSq / 16);
        }
      }
    }
    return clamp(totalShading, 0, 100);
  }

  getPlantStateForClient(plantId: string): Plant | undefined {
    return this.plants.get(plantId);
  }
}
