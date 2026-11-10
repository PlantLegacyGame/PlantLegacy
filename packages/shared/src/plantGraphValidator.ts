/**
 * Plant graph boundary validation (Phase 2 of the state-machine audit).
 *
 * Pure, simulation-free checks over a shared `Plant`. Used as the load-time
 * boundary guard (`PlantWorld.loadPlant`) and as a dev-mode periodic sanity
 * check on the live world. Nothing here mutates state.
 *
 * Checks enforced:
 *  - exactly one root node (`parentId === null`), and `rootNodeId` names it
 *  - every node's `plantId` matches the owning plant
 *  - `parentId`/`children` are reciprocal (INV-GR-02)
 *  - referenced parents/children exist (no dangling links)
 *  - every node is reachable from the root (no orphans, no cycles)
 *  - node positions are finite and inside world bounds
 *  - biomass, age, upkeep, growthProgress are finite and in range
 *  - `totalUpkeep` equals the sum of node upkeeps (INV-GR-06, enforced)
 *
 * `totalBiomass` is deliberately NOT compared to the node sum: it is an
 * independently maintained accumulator (photosynthesis/damage/growth apply
 * deltas directly), so equality would be a false positive.
 */

import type { Plant } from './growth/index.ts';

export interface PlantGraphIssue {
  /** Dotted path into the plant (e.g. `nodes.abc123.parentId`). */
  path: string;
  /** Stable machine-readable code. */
  code: string;
  /** Human-readable description. */
  message: string;
  severity: 'error' | 'warning';
}

export interface PlantGraphValidationResult {
  ok: boolean;
  issues: PlantGraphIssue[];
}

export interface PlantGraphOptions {
  /** Absolute tolerance for the total-upkeep vs node-sum comparison. */
  readonly upkeepTolerance?: number;
}

/** Minimal bounds shape accepted by the validator. */
export interface PlantGraphBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function push(
  issues: PlantGraphIssue[],
  path: string,
  code: string,
  message: string,
  severity: 'error' | 'warning' = 'error',
): void {
  issues.push({ path, code, message, severity });
}

/**
 * Validates a plant graph and returns all issues found. Does not mutate.
 *
 * @param plant The plant to validate.
 * @param bounds World bounds used to reject out-of-range node positions.
 * @param options Optional tolerance overrides.
 */
export function validatePlantGraph(
  plant: Plant,
  bounds: PlantGraphBounds,
  options: PlantGraphOptions = {},
): PlantGraphValidationResult {
  const issues: PlantGraphIssue[] = [];
  const upkeepTolerance = options.upkeepTolerance ?? 1e-6;
  const nodes = plant.nodes;

  // --- Root / structure -------------------------------------------------
  // Pre-germination seeds are valid plants with `rootNodeId === null` and one
  // rootless seed node. Stepwise germination may use a seed/root crown as the
  // structural root (`rootNodeId` points to it, `isSeed` may remain true while
  // directed radicle/cotyledons are added).
  const rootlessSeed = [...nodes.values()].find((n) => n.isSeed && n.parentId === null) ?? null;
  if (plant.rootNodeId === null || plant.rootNodeId === undefined || plant.rootNodeId === '') {
    if (!rootlessSeed) {
      push(issues, 'rootNodeId', 'plant.missing_root', 'Plant declares no root node.');
    }
  } else if (!nodes.has(plant.rootNodeId)) {
    push(
      issues,
      `rootNodeId/${String(plant.rootNodeId)}`,
      'plant.root_node_missing',
      `rootNodeId "${plant.rootNodeId}" does not name a node of this plant.`,
    );
  }

  let rootCount = 0;
  for (const node of nodes.values()) {
    if (node.parentId === null) rootCount += 1;
  }
  if (rootCount !== 1) {
    push(
      issues,
      '',
      'plant.multiple_roots',
      `Expected exactly one root node (parentId === null), found ${rootCount}.`,
    );
  }

  // Pre-germination: accept a single seed node as the structural root.
  if (rootlessSeed && rootCount === 1 && nodes.size === 1) {
    // No other structural issues possible for a lone seed.
  }

  // --- Per-node checks --------------------------------------------------
  const seenIds = new Set<string>();
  for (const node of nodes.values()) {
    const base = `nodes.${node.id}`;

    if (seenIds.has(node.id)) {
      push(issues, base, 'node.duplicate_id', `Duplicate node id "${node.id}".`);
    }
    seenIds.add(node.id);

    if (node.plantId !== plant.id) {
      push(
        issues,
        `${base}.plantId`,
        'node.plant_id_mismatch',
        `node.plantId "${node.plantId}" does not match plant.id "${plant.id}".`,
      );
    }

    if (!isFiniteNumber(node.x) || !isFiniteNumber(node.y) || !isFiniteNumber(node.z)) {
      push(
        issues,
        `${base}.position`,
        'node.non_finite_position',
        `Node "${node.id}" has a non-finite position.`,
      );
    } else if (
      node.x < bounds.minX ||
      node.x > bounds.maxX ||
      node.y < bounds.minY ||
      node.y > bounds.maxY ||
      node.z < bounds.minZ ||
      node.z > bounds.maxZ
    ) {
      push(
        issues,
        `${base}.position`,
        'node.out_of_bounds',
        `Node "${node.id}" is outside world bounds.`,
      );
    }

    if (!isFiniteNumber(node.biomass) || node.biomass < 0) {
      push(
        issues,
        `${base}.biomass`,
        'node.invalid_biomass',
        `Node "${node.id}" biomass must be a finite non-negative number.`,
      );
    }
    if (!isFiniteNumber(node.age) || node.age < 0) {
      push(
        issues,
        `${base}.age`,
        'node.invalid_age',
        `Node "${node.id}" age must be a finite non-negative number.`,
      );
    }
    if (!isFiniteNumber(node.upkeepBiomassPerSecond) || node.upkeepBiomassPerSecond < 0) {
      push(
        issues,
        `${base}.upkeepBiomassPerSecond`,
        'node.invalid_upkeep',
        `Node "${node.id}" upkeep must be a finite non-negative number.`,
      );
    }
    if (
      !isFiniteNumber(node.growthProgress) ||
      node.growthProgress < 0 ||
      node.growthProgress > 1
    ) {
      push(
        issues,
        `${base}.growthProgress`,
        'node.invalid_growth_progress',
        `Node "${node.id}" growthProgress must be in [0, 1].`,
      );
    }

    // Parent must reference an existing node.
    if (node.parentId !== null && !nodes.has(node.parentId)) {
      push(
        issues,
        `${base}.parentId`,
        'node.parent_missing',
        `Node "${node.id}" references parentId "${node.parentId}" which does not exist.`,
      );
    }
  }

  // --- Reciprocity: parentId <-> children ------------------------------
  for (const node of nodes.values()) {
    const base = `nodes.${node.id}`;
    const parent = node.parentId !== null ? nodes.get(node.parentId) : undefined;

    if (parent) {
      if (!parent.children.includes(node.id)) {
        push(
          issues,
          `${base}.parentId`,
          'node.children_not_reciprocal',
          `Parent "${node.parentId}" does not list child "${node.id}" in children.`,
        );
      }
    } else if (node.id !== plant.rootNodeId) {
      push(
        issues,
        `${base}.parentId`,
        'node.orphan',
        `Node "${node.id}" has no parent but is not the plant root.`,
      );
    }

    for (const childId of node.children) {
      if (!nodes.has(childId)) {
        push(
          issues,
          `${base}.children`,
          'node.child_missing',
          `Node "${node.id}" lists child "${childId}" which does not exist.`,
        );
        continue;
      }
      const child = nodes.get(childId);
      if (child && child.parentId !== node.id) {
        push(
          issues,
          `${base}.children`,
          'node.parent_not_reciprocal',
          `Child "${childId}" lists parentId "${child.parentId}" not "${node.id}".`,
        );
      }
    }
  }

  // --- Reachability from root (catches orphans and cycles) -------------
  const rootId = plant.rootNodeId;
  if (typeof rootId === 'string' && rootId.length > 0 && nodes.has(rootId)) {
    const visited = new Set<string>();
    const stack = [rootId];
    while (stack.length > 0) {
      const id = stack.pop();
      if (!id) continue;
      if (visited.has(id)) continue;
      visited.add(id);
      const n = nodes.get(id);
      if (n) {
        for (const childId of n.children) {
          if (!visited.has(childId)) stack.push(childId);
        }
      }
    }
    for (const id of nodes.keys()) {
      if (!visited.has(id)) {
        push(
          issues,
          `nodes.${id}`,
          'node.unreachable',
          `Node "${id}" is not reachable from the root (orphan or cycle).`,
        );
      }
    }
  }

  // --- Totals -----------------------------------------------------------
  // totalUpkeep is the enforced invariant: it must equal the node sum.
  const sumUpkeep = [...nodes.values()].reduce((acc, node) => acc + node.upkeepBiomassPerSecond, 0);
  if (!isFiniteNumber(plant.totalUpkeep)) {
    push(
      issues,
      'totalUpkeep',
      'plant.invalid_total_upkeep',
      `plant.totalUpkeep must be a finite number.`,
    );
  } else if (Math.abs(plant.totalUpkeep - sumUpkeep) > upkeepTolerance) {
    push(
      issues,
      'totalUpkeep',
      'plant.total_upkeep_mismatch',
      `plant.totalUpkeep (${plant.totalUpkeep}) does not equal the node upkeep sum (${sumUpkeep}).`,
    );
  }

  if (!isFiniteNumber(plant.totalBiomass) || plant.totalBiomass < 0) {
    push(
      issues,
      'totalBiomass',
      'plant.invalid_total_biomass',
      `plant.totalBiomass must be a finite non-negative number.`,
    );
  }

  if (!isFiniteNumber(plant.totalEnergy) || plant.totalEnergy < 0) {
    push(
      issues,
      'totalEnergy',
      'plant.invalid_total_energy',
      `plant.totalEnergy must be a finite non-negative number.`,
    );
  }

  return { ok: issues.length === 0, issues };
}
