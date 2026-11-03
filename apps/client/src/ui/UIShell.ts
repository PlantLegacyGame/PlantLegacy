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

export interface UIConfig {
  textScale: number;
  layers: Record<string, number>;
  theme: Record<string, string>;
  toastDurationMs: number;
  toastMaxStack: number;
  hintCardDurationMs: number;
  hintCardMaxLines: number;
  panelDefaultWidthPx: number;
  panelAnimationMs: number;
  reducedMotion: boolean;
  safeAreaPaddingPx: number;
}

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

export class UIShell {
  private readonly root: HTMLElement;
  private readonly layers = new Map<string, HTMLElement>();
  private readonly toasts: HTMLElement[] = [];
  private readonly panelListeners = new Set<PanelListener>();
  private textScale = 1.0;

  constructor(
    private readonly config: UIConfig,
    root: HTMLElement = document.body,
  ) {
    this.root = root;
    this.textScale = config.textScale;
    this.applyTheme(config.theme);
    this.applyTextScale();
    this.createLayers();
  }

  // ---- Theme / scale -------------------------------------------------

  private applyTheme(theme: Record<string, string>): void {
    const style = document.documentElement.style;
    for (const [name, color] of Object.entries(theme)) {
      const cssVar = `--${name.replace(/_/g, '-')}`;
      style.setProperty(cssVar, color);
    }
  }

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
    const el = document.createElement('div');
    el.className = `ui-toast ui-toast-${options.kind ?? 'info'}`;
    el.textContent = options.message;
    el.style.cssText = `
      position: fixed;
      left: 50%;
      bottom: calc(24px + env(safe-area-inset-bottom));
      transform: translateX(-50%) translateY(20px);
      background: var(--loam-900, #14180f);
      border: 1px solid var(--bark-700, #2a281f);
      border-radius: 8px;
      padding: 10px 16px;
      color: var(--bone-100, #efe9d8);
      font-size: calc(14px * var(--text-scale, 1));
      z-index: ${this.config.layers.toast};
      opacity: 0;
      transition: opacity 200ms ease, transform 200ms ease;
      pointer-events: auto;
      max-width: 90vw;
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
