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

export function createStyleVarWriter(targets: VarTargets): StyleVarWriter {
  const last = new Map<string, string>();
  // Resolved per write: the layers exist by the time the first tick runs, and the
  // screen layer is created on first use.
  const resolve = (): HTMLElement[] => {
    const list =
      typeof targets === 'function' ? targets() : Array.isArray(targets) ? targets : [targets];
    return list.filter((el): el is HTMLElement => Boolean(el));
  };
  return {
    set(name: string, value: string): void {
      if (last.get(name) === value) return;
      last.set(name, value);
      for (const el of resolve()) el.style.setProperty(name, value);
    },
    reset(): void {
      last.clear();
    },
  };
}
