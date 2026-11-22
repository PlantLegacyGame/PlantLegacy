/**
 * Publishes the palette as CSS custom properties.
 *
 * A01: `config/palette.json` is the only place a colour value lives. At boot its
 * steps become `--palette-<ramp>-<step>` and its roles `--palette-<role>`, so
 * `styles.css` can name a ladder step or a role and never a hex. The UI's design
 * tokens (`config/ui.json` -> `theme`, each naming a role) become
 * `--pl-theme-<token>`: a surface asks for paper or hazard rather than a shade,
 * and the prefix keeps a token from shadowing a ramp variable the way an
 * unprefixed `--bone-100` did (paper vying with the sheet's lightest bone).
 *
 * Everything is published in one write. A palette that fails to load publishes
 * nothing, which leaves the stylesheet's `--palette-*` references unset -
 * deliberately loud, because a HUD with no colour source should look broken
 * rather than quietly keep a stale second copy of the palette.
 */

import type { PaletteConfig } from '../config/clientConfig.js';
import { paletteRoleHexes, paletteStepHexes } from '../config/paletteColours.ts';

/** Custom property for a name: `('--palette-', 'accent_life')` -> `--palette-accent-life`. */
const cssName = (prefix: string, name: string) => `${prefix}${name.replaceAll('_', '-')}`;

/**
 * Every palette step, every role, and the UI's design tokens, as custom
 * properties: `--palette-soil-500`, `--palette-paper`, `--pl-theme-paper-dim`.
 */
export function paletteCssVars(
  palette: PaletteConfig,
  theme: Record<string, string> | undefined,
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [key, hex] of paletteStepHexes(palette)) {
    vars[cssName('--palette-', key.replace('.', '-'))] = hex;
  }

  const roles = paletteRoleHexes(palette);
  for (const [role, hex] of Object.entries(roles)) vars[cssName('--palette-', role)] = hex;

  for (const [token, role] of Object.entries(theme ?? {})) {
    const hex = roles[role];
    if (hex) vars[cssName('--pl-theme-', token)] = hex;
  }
  return vars;
}

/** Writes {@link paletteCssVars} onto the root (or a root the caller supplies). */
export function applyPaletteCssVars(
  palette: PaletteConfig,
  theme: Record<string, string> | undefined,
  root: HTMLElement = document.documentElement,
): Record<string, string> {
  const vars = paletteCssVars(palette, theme);
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  return vars;
}
