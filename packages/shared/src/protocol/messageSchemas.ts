/**
 * Wire-message schemas used at `onmessage` boundaries (Phase 2 of the
 * state-machine audit).
 *
 * Every message that crosses a trust boundary is validated against a schema
 * before it is acted on. Malformed messages are rejected with an `ERROR`
 * (server) or skipped with a warning (client) instead of being silently
 * dropped or `as`-cast into shape (INV-NET-08).
 *
 * These are pure, dependency-free validators: they check presence, type and
 * shape only — they never touch simulation state.
 */

export interface MessageSchemaIssue {
  path: string;
  code: string;
  message: string;
}

export interface MessageValidationResult {
  ok: boolean;
  issues: MessageSchemaIssue[];
}

type FieldType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';

interface FieldRule {
  type: FieldType;
  required?: boolean;
  nullable?: boolean;
  items?: FieldRule;
  fields?: Record<string, FieldRule>;
  enum?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function push(issues: MessageSchemaIssue[], path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}

function checkValue(
  issues: MessageSchemaIssue[],
  path: string,
  value: unknown,
  rule: FieldRule,
): void {
  // Allow null for nullable fields
  if (value === null && rule.nullable === true) {
    return;
  }

  switch (rule.type) {
    case 'string':
      if (typeof value !== 'string') {
        push(issues, path, 'message.field_type', `expected string, got ${typeof value}`);
      } else if (rule.enum && !rule.enum.includes(value)) {
        push(issues, path, 'message.field_enum', `value not in ${rule.enum.join(', ')}`);
      }
      break;
    case 'number':
      if (!isFiniteNumber(value)) {
        push(issues, path, 'message.field_type', `expected finite number, got ${typeof value}`);
      }
      break;
    case 'integer':
      if (!Number.isInteger(value)) {
        push(issues, path, 'message.field_type', `expected integer, got ${typeof value}`);
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') {
        push(issues, path, 'message.field_type', `expected boolean, got ${typeof value}`);
      }
      break;
    case 'object':
      if (!isRecord(value)) {
        push(issues, path, 'message.field_type', `expected object, got ${typeof value}`);
      } else if (rule.fields) {
        validateObject(value, rule.fields, path, issues);
      }
      break;
    case 'array':
      if (!Array.isArray(value)) {
        push(issues, path, 'message.field_type', `expected array, got ${typeof value}`);
      } else if (rule.items) {
        const items = rule.items;
        value.forEach((item, index) => {
          if (items.fields && isRecord(item)) {
            validateObject(item, items.fields, `${path}[${index}]`, issues);
          }
        });
      }
      break;
  }
}

function validateObject(
  value: Record<string, unknown>,
  schema: Record<string, FieldRule>,
  path: string,
  issues: MessageSchemaIssue[],
): void {
  for (const [key, rule] of Object.entries(schema)) {
    const fullPath = path ? `${path}.${key}` : key;
    if (!(key in value)) {
      if (rule.required) {
        push(issues, fullPath, 'message.field_missing', `required field "${key}" is absent`);
      }
      continue;
    }
    checkValue(issues, fullPath, value[key], rule);
  }
}

/**
 * Validates a decoded wire message payload against the schema for its type.
 * Returns `{ ok, issues }`. Callers decide what to do on `ok === false`
 * (server: send `ERROR`; client: warn + skip).
 */
export function validateMessage(type: number, payload: unknown): MessageValidationResult {
  const issues: MessageSchemaIssue[] = [];
  const schema = MESSAGE_SCHEMAS[type];
  if (!schema) {
    // Unknown message type: still require a payload object so consumers can
    // read it safely.
    if (!isRecord(payload)) {
      push(issues, '', 'message.payload_type', `payload for type ${type} must be an object`);
    }
    return { ok: issues.length === 0, issues };
  }
  if (!isRecord(payload)) {
    push(issues, '', 'message.payload_type', `payload for type ${type} must be an object`);
    return { ok: false, issues };
  }
  validateObject(payload, schema, '', issues);
  return { ok: issues.length === 0, issues };
}

/** Human-readable rendering of one validation issue. */
export function formatMessageIssue(issue: MessageSchemaIssue): string {
  const location = issue.path ? `${issue.path}` : '(root)';
  return `${location}  [${issue.code}] ${issue.message}`;
}

/* ------------------------------------------------------------------ */
/* Schemas                                                            */
/* ------------------------------------------------------------------ */

const vec3: FieldRule = {
  type: 'object',
  required: true,
  fields: {
    x: { type: 'number', required: true },
    y: { type: 'number', required: true },
    z: { type: 'number', required: true },
  },
};

const nodeType: FieldRule = { type: 'string', required: true };

// Simplified root node (what server sends in WELCOME.rootNode)
const simpleRootNode: FieldRule = {
  type: 'object',
  required: true,
  fields: {
    id: { type: 'string', required: false }, // empty string when no root node yet
    x: { type: 'number', required: true },
    y: { type: 'number', required: true },
    z: { type: 'number', required: true },
    type: nodeType,
    biomass: { type: 'number', required: true },
  },
};

// Full node schema (what server sends in WELCOME.nodes, PLANT_SYNC, PLANT_CREATED, GROWTH_EVENT)
const fullNode: FieldRule = {
  type: 'object',
  required: true,
  fields: {
    id: { type: 'string', required: true },
    plantId: { type: 'string', required: true },
    type: nodeType,
    layer: { type: 'string', required: true },
    x: { type: 'number', required: true },
    y: { type: 'number', required: true },
    z: { type: 'number', required: true },
    biomass: { type: 'number', required: true },
    age: { type: 'number', required: true },
    parentId: { type: 'string', required: false, nullable: true }, // null for root node
    children: { type: 'array', required: true },
    statModifiers: { type: 'object', required: true },
    resourceDrawWater: { type: 'number', required: true },
    resourceDrawNutrients: { type: 'number', required: true },
    upkeepBiomassPerSecond: { type: 'number', required: true },
    growthDirectionBias: { type: 'string', required: true },
    lastGrowthTick: { type: 'number', required: true },
    growthProgress: { type: 'number', required: true },
    isSeed: { type: 'boolean', required: true },
  },
};

// Plant summary (what server sends in STATE/KEYFRAME)
const plantSummary: FieldRule = {
  type: 'object',
  required: true,
  fields: {
    id: { type: 'string', required: true },
    totalBiomass: { type: 'number', required: true },
    totalEnergy: { type: 'number', required: true },
    totalUpkeep: { type: 'number', required: true },
  },
};

// Plant summary for keyframe (no totalEnergy)
const keyframePlantSummary: FieldRule = {
  type: 'object',
  required: true,
  fields: {
    id: { type: 'string', required: true },
    totalBiomass: { type: 'number', required: true },
    totalUpkeep: { type: 'number', required: true },
  },
};

const worldBounds: FieldRule = {
  type: 'object',
  required: true,
  fields: {
    minX: { type: 'number', required: true },
    maxX: { type: 'number', required: true },
    minZ: { type: 'number', required: true },
    maxZ: { type: 'number', required: true },
  },
};

const tile: FieldRule = {
  type: 'object',
  required: true,
  fields: {
    tileX: { type: 'number' },
    tileZ: { type: 'number' },
    light: { type: 'number', required: true },
    moisture: { type: 'number', required: true },
    minerals: { type: 'number', required: true },
  },
};

export const MESSAGE_SCHEMAS: Record<number, Record<string, FieldRule>> = {
  // Client -> Server
  1: {
    // HELLO
    clientVersion: { type: 'number', required: true },
    accessToken: { type: 'string' },
    plantId: { type: 'string' },
  },
  2: {
    // INPUT
    input: {
      type: 'object',
      required: true,
      fields: {
        moveForward: { type: 'boolean', required: true },
        moveBackward: { type: 'boolean', required: true },
        moveLeft: { type: 'boolean', required: true },
        moveRight: { type: 'boolean', required: true },
        tick: { type: 'number', required: true },
      },
    },
  },
  3: {
    // PING (empty payload)
  },
  4: {
    // GROWTH_INTENT
    plantId: { type: 'string', required: true },
    nodeId: { type: 'string', required: true },
    direction: vec3,
    nodeType,
    isAttack: { type: 'boolean', required: true },
    tick: { type: 'number', required: true },
    growthMode: { type: 'string' },
  },
  5: {
    // RESOURCE_QUERY — tile or world coordinates
    tileX: { type: 'number' },
    tileZ: { type: 'number' },
    worldX: { type: 'number' },
    worldZ: { type: 'number' },
  },
  6: {
    // PLANT_SYNC_REQUEST (empty payload)
  },
  7: {
    // GROWTH_OPTIONS_REQUEST
    plantId: { type: 'string', required: true },
    nodeId: { type: 'string', required: true },
  },

  // Server -> Client
  10: {
    // WELCOME
    playerId: { type: 'string', required: true },
    plantId: { type: 'string', required: true },
    tick: { type: 'number', required: true },
    rootNode: simpleRootNode,
    totalBiomass: { type: 'number', required: true },
    totalEnergy: { type: 'number', required: true },
    nodes: {
      type: 'array',
      items: { type: 'object', fields: fullNode.fields as Record<string, FieldRule> },
    },
  },
  11: {
    // STATE
    tick: { type: 'number', required: true },
    plants: {
      type: 'array',
      items: { type: 'object', fields: plantSummary.fields as Record<string, FieldRule> },
    },
    worldBounds: worldBounds,
    tileSize: { type: 'number', required: true },
  },
  12: {
    // KEYFRAME
    tick: { type: 'number', required: true },
    plants: {
      type: 'array',
      items: { type: 'object', fields: keyframePlantSummary.fields as Record<string, FieldRule> },
    },
    worldBounds: worldBounds,
    tileSize: { type: 'number', required: true },
  },
  13: {
    // REJECT
    reason: { type: 'string', required: true },
    originalType: { type: 'number', required: true },
  },
  14: {
    // PONG
    tick: { type: 'number' },
  },
  15: {
    // ERROR
    code: { type: 'string', required: true },
    message: { type: 'string', required: true },
  },
  16: {
    // GROWTH_EVENT
    plantId: { type: 'string', required: true },
    // Normal growth sends newNode; germination sends newNodes plus a replaced
    // parent node, so neither is individually required.
    newNode: { ...fullNode, required: false },
    newNodes: { type: 'array', items: { ...fullNode, required: false } },
    updatedParentNode: { ...fullNode, required: false },
    damageDealt: { type: 'number' },
    totalBiomass: { type: 'number' },
    totalEnergy: { type: 'number' },
  },
  17: {
    // RESOURCE_UPDATE
    tick: { type: 'number', required: true },
    tiles: {
      type: 'array',
      items: { type: 'object', fields: tile.fields as Record<string, FieldRule> },
    },
    width: { type: 'number', required: true },
    height: { type: 'number', required: true },
    tileSize: { type: 'number', required: true },
    totalEnergy: { type: 'number', required: false },
    totalBiomass: { type: 'number', required: false },
    storedWater: { type: 'number', required: false },
    storedMinerals: { type: 'number', required: false },
    rootTileCount: { type: 'number', required: false },
  },
  18: {
    // PLANT_SYNC
    plants: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        fields: {
          id: { type: 'string', required: true },
          ownerId: { type: 'string', required: true },
          rootNodeId: { type: 'string', required: false, nullable: true }, // null for ungerminated plants
          totalBiomass: { type: 'number', required: true },
          totalEnergy: { type: 'number', required: true },
          totalUpkeep: { type: 'number', required: true },
          nodes: {
            type: 'array',
            items: { type: 'object', fields: fullNode.fields as Record<string, FieldRule> },
          },
        },
      },
    },
  },
  19: {
    // PLANT_CREATED
    plant: {
      type: 'object',
      required: true,
      fields: {
        id: { type: 'string', required: true },
        ownerId: { type: 'string', required: true },
        rootNodeId: { type: 'string', required: false, nullable: true }, // null for ungerminated plants
        totalBiomass: { type: 'number', required: true },
        totalEnergy: { type: 'number', required: true },
        totalUpkeep: { type: 'number', required: true },
        nodes: {
          type: 'array',
          items: { type: 'object', fields: fullNode.fields as Record<string, FieldRule> },
        },
      },
    },
  },
  20: {
    // PLANT_REMOVED
    plantId: { type: 'string', required: true },
  },
  21: {
    // WEATHER_UPDATE
    tick: { type: 'number', required: true },
    timeOfDay: { type: 'number', required: true },
    isDay: { type: 'boolean', required: true },
    sunIntensity: { type: 'number', required: true },
    weatherState: { type: 'string', required: true },
    conditionToken: { type: 'string', required: true },
    stateTimeRemainingS: { type: 'number', required: true },
    forecast: {
      type: 'object',
      required: true,
      fields: {
        nextWeatherState: { type: 'string', required: true },
        timeUntilNextStateS: { type: 'number', required: true },
      },
    },
  },
  22: {
    // GROWTH_OPTIONS_RESULT
    nodeId: { type: 'string', required: true },
    nodeType,
    isSeed: { type: 'boolean', required: true },
    energy: { type: 'number', required: true },
    biomass: { type: 'number', required: true },
    options: { type: 'array' },
  },
};
