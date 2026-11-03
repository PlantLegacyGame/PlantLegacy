/**
 * C01 debug overlay.
 *
 * Live metrics drawn over the world: fps, frame ms, triangles, draw calls,
 * renderer memory, WebSocket KB/s in, KB/s out. Toggled by `config/render.json`
 * `debug_overlay_key` (default `` ` ``). No per-frame allocations: the DOM
 * nodes are reused, only their text content changes.
 *
 * DESIGN.md C01 acceptance: "Debug overlay shows live metrics."
 */

export interface DebugMetrics {
  fps: number;
  frameMs: number;
  triangles: number;
  drawCalls: number;
  memoryMb: number | null;
  kbInPerSec: number;
  kbOutPerSec: number;
  pixelRatio: number;
}

const EMPTY_METRICS: DebugMetrics = {
  fps: 0,
  frameMs: 0,
  triangles: 0,
  drawCalls: 0,
  memoryMb: null,
  kbInPerSec: 0,
  kbOutPerSec: 0,
  pixelRatio: 1,
};

export class DebugOverlay {
  private readonly el: HTMLDivElement;
  private metrics: DebugMetrics = { ...EMPTY_METRICS };
  private visible = false;
  private lastFrameTime = performance.now();
  private frameCount = 0;
  private frameAccumMs = 0;
  private bytesIn = 0;
  private bytesOut = 0;
  private lastByteSample = performance.now();

  constructor(layer: HTMLElement, _toggleKey: string) {
    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute;
      top: 8px;
      right: 8px;
      background: rgba(20, 24, 15, 0.85);
      border: 1px solid var(--bark-700, #2a281f);
      border-radius: 6px;
      padding: 8px 12px;
      color: var(--bone-100, #efe9d8);
      font-family: ui-monospace, "JetBrains Mono", monospace;
      font-size: 11px;
      line-height: 1.5;
      min-width: 180px;
      pointer-events: none;
      display: none;
    `;
    layer.appendChild(this.el);
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.el.style.display = on ? 'block' : 'none';
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Record bytes transferred by the WebSocket since the last sample. */
  recordBytes(inBytes: number, outBytes: number): void {
    this.bytesIn += inBytes;
    this.bytesOut += outBytes;
  }

  /** Call once per frame with the renderer's info and a timestamp. */
  update(info: { triangles?: number; drawCalls?: number } | null, now = performance.now()): void {
    const dt = now - this.lastFrameTime;
    this.lastFrameTime = now;
    this.frameCount += 1;
    this.frameAccumMs += dt;

    // Sample metrics every ~250 ms to avoid thrashing the DOM.
    if (dt > 0 && this.frameAccumMs >= 250) {
      const seconds = this.frameAccumMs / 1000;
      const byteDt = (now - this.lastByteSample) / 1000;
      this.lastByteSample = now;

      this.metrics = {
        fps: Math.round(this.frameCount / seconds),
        frameMs: Math.round((this.frameAccumMs / this.frameCount) * 100) / 100,
        triangles: info?.triangles ?? 0,
        drawCalls: info?.drawCalls ?? 0,
        memoryMb: this.readMemoryMb(),
        kbInPerSec: byteDt > 0 ? Math.round(this.bytesIn / byteDt / 1024) : 0,
        kbOutPerSec: byteDt > 0 ? Math.round(this.bytesOut / byteDt / 1024) : 0,
        pixelRatio: window.devicePixelRatio,
      };
      this.bytesIn = 0;
      this.bytesOut = 0;
      this.frameCount = 0;
      this.frameAccumMs = 0;
      this.render();
    }
  }

  private readMemoryMb(): number | null {
    const perf = performance as unknown as { memory?: { usedJSHeapSize?: number } };
    const used = perf.memory?.usedJSHeapSize;
    return typeof used === 'number' ? Math.round(used / 1048576) : null;
  }

  private render(): void {
    const m = this.metrics;
    const mem = m.memoryMb != null ? `${m.memoryMb}MB` : 'n/a';
    this.el.textContent = [
      `fps ${m.fps}  (${m.frameMs} ms)`,
      `tri ${m.triangles.toLocaleString()}  draws ${m.drawCalls}`,
      `mem ${mem}`,
      `net  in ${m.kbInPerSec} KB/s  out ${m.kbOutPerSec} KB/s`,
      `dpr ${m.pixelRatio}`,
    ].join('\n');
  }
}

export function createDebugOverlay(layer: HTMLElement, toggleKey: string): DebugOverlay {
  return new DebugOverlay(layer, toggleKey);
}
