/**
 * Wire protocol placeholder.
 *
 * T03P (Gate 0) decides and documents the protocol (DESIGN.md Part 13.8); T03
 * implements it. Until then this module only fixes the frame header shape so
 * nothing else invents one.
 */

import type { PlantNode } from '../growth/index.ts';

/** Bumped on any breaking wire change. Mismatch shows an "update required" screen. */
export const PROTOCOL_VERSION = 1;

/** `[version:u8][type:u8][payload]` — payload encoding is T03P's decision. */
export const FRAME_HEADER_BYTES = 2;

export interface FrameHeader {
  version: number;
  type: number;
}

export interface GrowthEventPayload {
  plantId: string;
  /** Single-node growth (normal growth). Absent for multi-node germination. */
  newNode?: PlantNode;
  /** Multi-node growth (germination: radicle + cotyledons). */
  newNodes?: PlantNode[];
  /** Replaced node (germination: the seed becomes the root). */
  updatedParentNode?: PlantNode;
  damageDealt?: number;
  totalBiomass?: number;
  totalEnergy?: number;
}

export * from './messageSchemas.ts';
