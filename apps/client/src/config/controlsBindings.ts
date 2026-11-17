/**
 * The controls binding table, read from either shape it arrives in.
 *
 * `config/controls.json` declares the desktop keys as a schema array of
 * `{ action, keys, mouse, mode, context }`; the `/config/controls` route serves
 * them as a record keyed by action. A client that understood only one shape
 * produced an *empty* binding table from the other, and an empty table is not an
 * error the player can see: R, Space, G and every other named action simply stop
 * existing. Both shapes are read here, and a table that names no actions is
 * reported as absent so the caller keeps its fallback.
 *
 * Pure and browser-free, so the shapes can be tested without a renderer.
 */
import type { Binding } from '@plant-legacy/input';

/** A binding as the file writes it: the action is a field on the entry. */
export interface ListedBinding extends Binding {
  action?: string;
}

/** The shape any controls-config source may hand over. */
export interface ControlsBindingsSource {
  bindings?: Record<string, Binding> | ListedBinding[];
  /** The file's own key, in case a reader passes the values map through. */
  bindings_desktop?: ListedBinding[];
  bindingsDesktop?: ListedBinding[];
}

export function normalizeBindings(
  source: ControlsBindingsSource,
): Record<string, Binding> | undefined {
  const raw = source.bindings ?? source.bindings_desktop ?? source.bindingsDesktop;
  if (!raw) return undefined;
  if (Array.isArray(raw)) {
    const byAction: Record<string, Binding> = {};
    for (const binding of raw) {
      if (binding && typeof binding.action === 'string') byAction[binding.action] = binding;
    }
    // An array that names no actions is a broken file, not an empty keymap:
    // hand back nothing so the caller's fallback keeps the game playable.
    return Object.keys(byAction).length > 0 ? byAction : undefined;
  }
  return Object.keys(raw).length > 0 ? raw : undefined;
}
