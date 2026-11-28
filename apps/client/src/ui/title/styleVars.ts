/**
 * CSS custom properties, written only when they change, onto the layers that
 * paint with them.
 *
 * The title's sky used to be custom properties on the menu root. A property on
 * that element reaches every descendant, and a step of the day cycle rewrites
 * about thirty of them at once: the whole menu - a 2D world, a 921-node plant, a
 * stack of panels - is invalidated and the browser repaints it as one picture.
 * The style recalculation of that is about 12 ms, which is what the first fix
 * here addressed (write only what changed). The *paint* is the expensive part:
 * the world's layered gradients over a pane-and-a-half of screen at dpr 1.425
 * measured 150-250 ms, and it happens whichever property changed, because the
 * root's values invalidate all of it.
 *
 * So the properties are written on the layers themselves now - the scene, the
 * soil stage, the plant, the weather - and a step repaints only the layers whose
 * own values moved. A sky step repaints the sky band; the cut face, on its own
 * much coarser clock, repaints the soil when the soil actually changes colour.
 *
 * Two rules for callers: give every layer that reads a property, and give no
 * layer twice (the dedupe and the writes are per property, not per element).
 */
export type VarTargets =
  | HTMLElement
  | Array<HTMLElement | null | undefined>
  | (() => Array<HTMLElement | null | undefined>);

export interface StyleVarWriter {
  /** Set a property, unless it already holds this value. */
  set(name: string, value: string): void;
  /** Forget what was written, so the next write goes through. */
  reset(): void;
}

export interface StyleVarWriterOptions {
  /**
   * Skip an `#rrggbb` write when every channel moved by at most this much.
   * 0 (the default) writes every change, as before.
   *
   * The day cycle moves a colour by a fraction of a level per step, and a
   * gradient that changes by one or two of 255 is not a visible change - but it
   * still repaints every layer that reads it. Skipping those writes is what turns
   * a repaint every step into one every few steps; the rendered colour is always
   * within this many levels of the clock's own value.
   */
  colourTolerance?: number;
}

/** The three channels of a six-digit hex colour, or null for anything else. */
function hexChannels(value: string): [number, number, number] | null {
  if (value.length !== 7 || value.charCodeAt(0) !== 35) return null;
  for (let index = 1; index < 7; index += 1) {
    const code = value.charCodeAt(index);
    const digit =
      (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
    if (!digit) return null;
  }
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

function withinTolerance(previous: string, next: string, tolerance: number): boolean {
  const a = hexChannels(previous);
  const b = hexChannels(next);
  if (!a || !b) return false;
  return (
    Math.abs(a[0] - b[0]) <= tolerance &&
    Math.abs(a[1] - b[1]) <= tolerance &&
    Math.abs(a[2] - b[2]) <= tolerance
  );
}

export function createStyleVarWriter(
  targets: VarTargets,
  options: StyleVarWriterOptions = {},
): StyleVarWriter {
  const last = new Map<string, string>();
  const tolerance = Math.max(0, Math.floor(options.colourTolerance ?? 0));
  // Resolved per write: the layers exist by the time the first tick runs, and the
  // screen layer is created on first use.
  const resolve = (): HTMLElement[] => {
    const list =
      typeof targets === 'function' ? targets() : Array.isArray(targets) ? targets : [targets];
    return list.filter((el): el is HTMLElement => Boolean(el));
  };
  return {
    set(name: string, value: string): void {
      const previous = last.get(name);
      if (previous === value) return;
      // Compare against what was last *written*, not the last attempt: the
      // difference is allowed to accumulate until it is worth a repaint.
      if (previous !== undefined && tolerance > 0 && withinTolerance(previous, value, tolerance)) {
        return;
      }
      last.set(name, value);
      for (const el of resolve()) el.style.setProperty(name, value);
    },
    reset(): void {
      last.clear();
    },
  };
}
