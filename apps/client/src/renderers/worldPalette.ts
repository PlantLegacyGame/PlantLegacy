/**
 * A01: the world's lights and its water take their colour from the palette.
 *
 * The soil shader's sun and sky fill, the plant's sun, the water material and
 * the rain were the last places a shader named a hex of its own - the sun was
 * `#ffffee` in two files, water had three teals in the material and three
 * different ones in the config that overrode them. They now ask the role map,
 * like the HUD and the plant: `sunlight` and `sky_bounce` are light rather than
 * paint, which is why they were the two kinds of role the palette still lacked.
 *
 * A caller gets a fresh `THREE.Color` each time, because uniforms and lerp
 * targets are mutated by whoever holds them.
 */
import * as THREE from 'three';
import type { PaletteConfig } from '../config/clientConfig.ts';
import { paletteRoleHexes } from '../config/paletteColours.ts';

/**
 * The roles the renderers ask for by name. Listed here so the test can hold
 * them to the palette and so boot fails on a missing one, before a shader is
 * built with an undefined uniform.
 */
export const WORLD_ROLES = [
  'sunlight',
  'sky_bounce',
  'sky_horizon',
  // The top of the sky, so a puddle's reflection is the sky's own gradient and
  // not one flat tint of it.
  'sky_zenith',
  'soil_lit',
  'soil_mid',
  'soil_shade',
  'soil_wet',
  'water_shallow',
  'water_body',
  'water_deep',
] as const;

let roles: Record<string, string> | null = null;

/** Resolve the palette's roles. Call once, before any renderer is built. */
export function applyWorldPalette(palette: PaletteConfig): void {
  roles = paletteRoleHexes(palette);
  const missing = WORLD_ROLES.filter((role) => !roles?.[role]);
  if (missing.length > 0) throw new Error(`the palette has no role ${missing.join(', ')}`);
}

/**
 * A fresh colour for a role. Takes the config's role names too
 * (`config/water.json` holds roles, not hexes), and throws rather than painting
 * a default, which the config validator rejects before it ships.
 */
export function worldColour(role: string): THREE.Color {
  if (!roles) {
    throw new Error('worldPalette: call applyWorldPalette(palette) before building the world');
  }
  const hex = roles[role];
  if (!hex) throw new Error(`the palette has no role ${role}`);
  return new THREE.Color(hex);
}
