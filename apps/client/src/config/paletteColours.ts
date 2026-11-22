/**
 * `config/palette.json`, resolved to hex.
 *
 * The palette stores OKLCH steps; three.js wants hex and CSS can take either.
 * Both consumers - `ui/theme.ts` publishing `--palette-*`, and
 * `renderers/organPalette.ts` painting the plant - resolve through here, so a
 * role means the same colour in the HUD and in the world.
 */
import { oklchToHex } from '@plant-legacy/shared/color';
import type { PaletteConfig } from './clientConfig.js';

/** Every step's hex, keyed `ramp.step` (`bark.900`). */
export function paletteStepHexes(palette: PaletteConfig): Map<string, string> {
  const steps = new Map<string, string>();
  for (const ramp of palette.ramps ?? []) {
    for (const step of ramp.steps ?? []) {
      steps.set(`${ramp.name}.${step.step}`, oklchToHex(step).hex);
    }
  }
  return steps;
}

/**
 * Every role's hex, keyed by role name. A role pointing at a step that is not in
 * the file is a palette bug the palette build rejects; here it is left out, so
 * whoever asked for it fails loudly instead of painting something else.
 */
export function paletteRoleHexes(palette: PaletteConfig): Record<string, string> {
  const steps = paletteStepHexes(palette);
  const roles: Record<string, string> = {};
  for (const role of palette.roles ?? []) {
    const hex = steps.get(`${role.ramp}.${role.step}`);
    if (hex) roles[role.name] = hex;
  }
  return roles;
}
