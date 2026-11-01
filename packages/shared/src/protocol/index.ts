/**
 * Wire protocol placeholder.
 *
 * T03P (Gate 0) decides and documents the protocol (DESIGN.md Part 13.8); T03
 * implements it. Until then this module only fixes the frame header shape so
 * nothing else invents one.
 */

/** Bumped on any breaking wire change. Mismatch shows an "update required" screen. */
export const PROTOCOL_VERSION = 1;

/** `[version:u8][type:u8][payload]` — payload encoding is T03P's decision. */
export const FRAME_HEADER_BYTES = 2;

export interface FrameHeader {
  version: number;
  type: number;
}
