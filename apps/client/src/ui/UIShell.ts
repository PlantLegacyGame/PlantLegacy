/**
 * C01 UI shell.
 *
 * DOM overlay with named layers (world, hud, panel, menu, modal, toast,
 * tooltip, debug). Layers stack by z-index from `config/ui.json`; higher
 * layers always win. Theme tokens are CSS variables on :root.
 *
 * DESIGN.md 18.1, 17.8, 19.8. RULE_13: no editorial text, no exclamation
 * marks, no celebratory visuals.
 */

/**
 * The UI surface's view of `config/ui.json`. Defined once in the config loader
 * and re-exported here, so the shell and its panels cannot drift apart.
 */
import type { UIConfig } from '../config/clientConfig.ts';

export type { UIConfig };

export interface ToastOptions {
  message: string;
  durationMs?: number;
  kind?: 'info' | 'state' | 'error';
}

export interface PanelDescriptor {
  id: string;
  title: string;
  open: boolean;
}

type PanelListener = (panelId: string, open: boolean, title?: string) => void;
type ToastListener = (options: ToastOptions) => void;

export class UIShell {
  private readonly root: HTMLElement;
  private readonly layers = new Map<string, HTMLElement>();
  private readonly toasts: HTMLElement[] = [];
  private readonly panelListeners = new Set<PanelListener>();
  private readonly toastListeners = new Set<ToastListener>();
  private textScale = 1.0;
  private toastsEnabled = true;

  constructor(
    private readonly config: UIConfig,
    root: HTMLElement = document.body,
  ) {
    this.root = root;
    this.textScale = config.textScale;
    this.applyTextScale();
    this.createLayers();
  }

  // ---- Scale ---------------------------------------------------------

  // A01: colour is not the shell's business. `ui/theme.ts` publishes the palette
  // and the design tokens once at boot; the shell used to write the raw tokens as
  // `--<token>`, which put a role name where a colour belonged and shadowed the
  // stylesheet's own ramp variables of the same name.

  private applyTextScale(): void {
    document.documentElement.style.setProperty('--text-scale', String(this.textScale));
  }

  setTextScale(scale: number): void {
    this.textScale = Math.max(0.8, Math.min(1.5, scale));
    this.applyTextScale();
  }

  // ---- Layers --------------------------------------------------------

  private createLayers(): void {
    const ordered = Object.entries(this.config.layers).sort((a, b) => a[1] - b[1]);
    for (const [name, _z] of ordered) {
      const el = document.createElement('div');
      el.className = `ui-layer ui-layer-${name}`;
      el.style.cssText = `
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: ${this.config.layers[name]};
        overflow: hidden;
      `;
      this.root.appendChild(el);
      this.layers.set(name, el);
    }
  }

  getLayer(name: string): HTMLElement | undefined {
    return this.layers.get(name);
  }

  /** Append a child to a named layer (pointer-events auto by default). */
  attachTo(layerName: string, element: HTMLElement): void {
    const layer = this.layers.get(layerName);
    if (!layer) {
      document.body.appendChild(element);
      return;
    }
    element.style.pointerEvents = 'auto';
    layer.appendChild(element);
  }

  // ---- Toasts --------------------------------------------------------

  toast(options: ToastOptions): void {
    if (!this.toastsEnabled) return;
    for (const listener of this.toastListeners) listener(options);
    const el = document.createElement('div');
    el.className = `ui-toast ui-toast-${options.kind ?? 'info'}`;
    el.textContent = options.message;
    el.style.cssText = `
      position: fixed;
      left: 50%;
      bottom: calc(24px + env(safe-area-inset-bottom));
      transform: translateX(-50%) translateY(20px);
      background: rgba(22, 27, 18, 0.92);
      border: 1px solid rgba(94, 122, 53, 0.25);
      border-radius: var(--hud-radius, 14px);
      padding: 9px 14px;
      color: var(--warm-ink, #efe9d8);
      font-family: inherit;
      font-size: 0.75rem;
      z-index: ${this.config.layers.toast};
      opacity: 0;
      transition: opacity 200ms ease, transform 200ms ease;
      pointer-events: auto;
      max-width: 90vw;
      box-shadow: var(--hud-shadow);
    `;
    this.root.appendChild(el);
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
    });

    this.toasts.push(el);
    if (this.toasts.length > this.config.toastMaxStack) {
      const stale = this.toasts.shift();
      stale?.remove();
    }

    const duration = options.durationMs ?? this.config.toastDurationMs;
    if (duration > 0) {
      setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(20px)';
        setTimeout(() => {
          el.remove();
          const idx = this.toasts.indexOf(el);
          if (idx >= 0) this.toasts.splice(idx, 1);
        }, 200);
      }, duration);
    }
  }

  /** Called for every toast the shell actually shows; history lives elsewhere. */
  onToast(listener: ToastListener): () => void {
    this.toastListeners.add(listener);
    return () => this.toastListeners.delete(listener);
  }

  /** Hide the toast stack, e.g. when the death screen takes over. */
  clearToasts(): void {
    for (const toast of this.toasts) toast.remove();
    this.toasts.length = 0;
  }

  /** Suppress new toasts while a modal owns the screen. */
  setToastsEnabled(enabled: boolean): void {
    this.toastsEnabled = enabled;
    if (!enabled) this.clearToasts();
  }

  // ---- Panels --------------------------------------------------------

  openPanel(panelId: string, title?: string): void {
    this.emitPanel(panelId, true, title);
  }

  closePanel(panelId: string): void {
    this.emitPanel(panelId, false);
  }

  onPanelChange(listener: PanelListener): () => void {
    this.panelListeners.add(listener);
    return () => this.panelListeners.delete(listener);
  }

  private emitPanel(panelId: string, open: boolean, title?: string): void {
    for (const listener of this.panelListeners) {
      listener(panelId, open, title);
    }
  }
}

/** Build a UIShell bound to the live document. */
export function createUIShell(config: UIConfig): UIShell {
  return new UIShell(config);
}
