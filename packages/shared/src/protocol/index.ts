/**
 * Wire protocol placeholder.
 *
 * T03P (Gate 0) decides and documents the protocol (DESIGN.md Part 13.8); T03
 * implements it. Until then this module only fixes the frame header shape so
 * nothing else invents one.
 */

import type { PlantNode } from '../growth/index.ts';

/** Bumped on any breaking wire change. Mismatch shows an "update required" screen. */
/** v2 adds MUTATION_STATE/MUTATION_SHED (T04); v3 adds MUTATION_LEVEL. */
export const PROTOCOL_VERSION = 3;

/** `[version:u8][type:u8][payload]` — payload encoding is T03P's decision. */
export const FRAME_HEADER_BYTES = 2;

export interface FrameHeader {
  version: number;
  type: number;
}

/**
 * Wire message numbers. One table, imported by the server, the client and the
 * bot harness.
 *
 * It used to live twice — in `apps/server/src/ops/net.ts` and as a literal in
 * `apps/client/src/main.ts` — so the two could drift and a new message could be
 * sent with a number the other side did not know. `REPORT` sharing `WELCOME`'s
 * number 10 is the bug that shape allowed.
 */
export const MESSAGE_TYPE = {
  // Client -> Server
  HELLO: 1,
  INPUT: 2,
  PING: 3,
  GROWTH_INTENT: 4,
  RESOURCE_QUERY: 5,
  PLANT_SYNC_REQUEST: 6,
  GROWTH_OPTIONS_REQUEST: 7,
  DEV_ACTION: 8,
  CHAT_MESSAGE: 9,
  REPORT: 29,
  BLOCK: 30,
  INVENTORY_REQUEST: 24,
  INVENTORY_SLOT_USE: 25,
  INVENTORY_SLOT_SWAP: 26,
  MUTATION_SHED: 36,
  /** Client asks to raise a mutation a level (deals cards, then takes one). */
  MUTATION_LEVEL: 45,
  REROOT_INTENT: 37,
  TERRAIN_REGION_REQUEST: 32,

  // Server -> Client
  WELCOME: 10,
  STATE: 11,
  KEYFRAME: 12,
  REJECT: 13,
  PONG: 14,
  ERROR: 15,
  GROWTH_EVENT: 16,
  RESOURCE_UPDATE: 17,
  PLANT_SYNC: 18,
  PLANT_CREATED: 19,
  PLANT_REMOVED: 20,
  WEATHER_UPDATE: 21,
  SEASON_UPDATE: 31,
  GROWTH_OPTIONS_RESULT: 22,
  CHAT_BROADCAST: 23,
  INVENTORY_SYNC: 27,
  INVENTORY_SLOT_UPDATE: 28,
  MUTATION_STATE: 35,
  PLANT_DAMAGE: 38,
  PLANT_UPROOT: 39,
  DROP_SPAWN: 40,
  DROP_EXPIRED: 41,
  FAUNA_EVENT: 42,
  KILL_CREDIT: 43,
  TERRAIN_REGION: 33,
  TERRAIN_EDITS: 34,

  // Dev commands (server -> client)
  DEV_RESPONSE: 99,
} as const;

export type MessageNumber = (typeof MESSAGE_TYPE)[keyof typeof MESSAGE_TYPE];

/** Reverse lookup, for logs and bot reports that print a name instead of a number. */
export const MESSAGE_NAME: Readonly<Record<number, string>> = Object.fromEntries(
  Object.entries(MESSAGE_TYPE).map(([name, number]) => [number, name]),
);

/**
 * Who may send each message, as data.
 *
 * The client checks its handler table against `SERVER_TO_CLIENT_TYPES` at
 * startup, and the dispatch test asserts these two lists together cover
 * `MESSAGE_TYPE` exactly once. A message added to the protocol in one direction
 * therefore cannot be silently forgotten by the other side.
 */
export const CLIENT_TO_SERVER_TYPES: readonly MessageNumber[] = [
  MESSAGE_TYPE.HELLO,
  MESSAGE_TYPE.INPUT,
  MESSAGE_TYPE.PING,
  MESSAGE_TYPE.GROWTH_INTENT,
  MESSAGE_TYPE.RESOURCE_QUERY,
  MESSAGE_TYPE.PLANT_SYNC_REQUEST,
  MESSAGE_TYPE.GROWTH_OPTIONS_REQUEST,
  MESSAGE_TYPE.DEV_ACTION,
  MESSAGE_TYPE.CHAT_MESSAGE,
  MESSAGE_TYPE.REPORT,
  MESSAGE_TYPE.BLOCK,
  MESSAGE_TYPE.INVENTORY_REQUEST,
  MESSAGE_TYPE.INVENTORY_SLOT_USE,
  MESSAGE_TYPE.INVENTORY_SLOT_SWAP,
  MESSAGE_TYPE.MUTATION_SHED,
  MESSAGE_TYPE.MUTATION_LEVEL,
  MESSAGE_TYPE.REROOT_INTENT,
  MESSAGE_TYPE.TERRAIN_REGION_REQUEST,
];

/** Messages the server may send to a client. */
export const SERVER_TO_CLIENT_TYPES: readonly MessageNumber[] = [
  MESSAGE_TYPE.WELCOME,
  MESSAGE_TYPE.STATE,
  MESSAGE_TYPE.KEYFRAME,
  MESSAGE_TYPE.REJECT,
  MESSAGE_TYPE.PONG,
  MESSAGE_TYPE.ERROR,
  MESSAGE_TYPE.GROWTH_EVENT,
  MESSAGE_TYPE.RESOURCE_UPDATE,
  MESSAGE_TYPE.PLANT_SYNC,
  MESSAGE_TYPE.PLANT_CREATED,
  MESSAGE_TYPE.PLANT_REMOVED,
  MESSAGE_TYPE.WEATHER_UPDATE,
  MESSAGE_TYPE.SEASON_UPDATE,
  MESSAGE_TYPE.GROWTH_OPTIONS_RESULT,
  MESSAGE_TYPE.CHAT_BROADCAST,
  MESSAGE_TYPE.INVENTORY_SYNC,
  MESSAGE_TYPE.INVENTORY_SLOT_UPDATE,
  MESSAGE_TYPE.MUTATION_STATE,
  MESSAGE_TYPE.PLANT_DAMAGE,
  MESSAGE_TYPE.PLANT_UPROOT,
  MESSAGE_TYPE.DROP_SPAWN,
  MESSAGE_TYPE.DROP_EXPIRED,
  MESSAGE_TYPE.FAUNA_EVENT,
  MESSAGE_TYPE.KILL_CREDIT,
  MESSAGE_TYPE.TERRAIN_REGION,
  MESSAGE_TYPE.TERRAIN_EDITS,
  MESSAGE_TYPE.DEV_RESPONSE,
];

export interface GrowthEventPayload {
  plantId: string;
  /** Single-node growth (normal growth). Absent for multi-node germination. */
  newNode?: PlantNode;
  /** Multi-node growth (germination: radicle + cotyledons). */
  newNodes?: PlantNode[];
  /** Replaced node (germination: the seed becomes the root). */
  updatedParentNode?: PlantNode;
  totalBiomass?: number;
  totalEnergy?: number;
}

export * from './messageSchemas.ts';
