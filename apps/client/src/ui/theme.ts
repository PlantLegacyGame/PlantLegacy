/**
 * Turns the palette into the HUD's colours.
 *
 * A01: `config/palette.json` is the only place a colour value lives. The UI's
 * tokens (`config/ui.json` -> `theme`) name a palette role, not a hex, so the
 * HUD cannot drift from the world a hand-edited colour at a time: change a ramp
 * step and every surface that asks for that role follows.
 *
 * The shell already publishes each token as a `--<token>` custom property on the
 * document root (`bark_700` -> `--bark-700`). Resolving the tokens to hex before
 * the shell is built means that one publish path carries the palette's value,
 * and `styles.css` keeps its own hexes only as the fallback for a missing or
 * partial palette.
 */
import { oklchToHex } from '@plant-legacy/shared/color';
import type { PaletteConfig } from '../config/clientConfig.js';

// The shape is the loader's, so the route and the resolver cannot disagree
// about what `/config/palette` returns.
export type {
  PaletteConfig,
  PaletteRamp,
  PaletteRole,
  PaletteStep,
} from '../config/clientConfig.js';

/** Every role's colour, resolved through the ramps: `role -> #rrggbb`. */
export function roleHexes(palette: PaletteConfig): Record<string, string> {
  const steps = new Map<string, string>();
  for (const ramp of palette.ramps ?? []) {
    for (const step of ramp.steps ?? []) {
      steps.set(`${ramp.name}.${step.step}`, oklchToHex(step).hex);
    }
  }
  const colours: Record<string, string> = {};
  for (const role of palette.roles ?? []) {
    const hex = steps.get(`${role.ramp}.${role.step}`);
    // A role pointing at a step that is not in the file is a palette bug, and
    // the palette build rejects it. Here it simply leaves the stylesheet's
    // fallback in place instead of painting something arbitrary.
    if (hex) colours[role.name] = hex;
  }
  return colours;
}

/**
 * `theme` tokens resolved to hex, keyed by the token name `config/ui.json` uses.
 *
 * A token whose role does not resolve is left out, so the shell publishes
 * nothing for it and the stylesheet's own value stands.
 */
export function resolveTheme(
  theme: Record<string, string> | undefined,
  palette: PaletteConfig,
): Record<string, string> {
  const roles = roleHexes(palette);
  const resolved: Record<string, string> = {};
  for (const [token, role] of Object.entries(theme ?? {})) {
    const hex = roles[role];
    if (hex) resolved[token] = hex;
  }
  return resolved;
}
