/**
 * AL-03 — GPU frame time.
 *
 * CPU frame time cannot tell you whether a 60 Hz frame has headroom: vsync
 * clamps it at the refresh rate. This reads a real GPU duration through
 * `EXT_disjoint_timer_query_webgl2` when the driver exposes it.
 *
 * The API shape differs by browser: WebGL2 puts `beginQuery` / `endQuery` /
 * `getQueryParameter` on the rendering context, and the extension only adds
 * `TIME_ELAPSED_EXT` and `GPU_DISJOINT_EXT`. Older code paths expose
 * `beginQueryEXT` / `endQueryEXT` on the extension object. Both are supported.
 *
 * The timer never blocks the frame. `begin()` queues a query, `end()` closes
 * it, and `readMs()` returns the most recently completed query. When the
 * extension is missing, or a result is disjoint (the GPU was reset), it returns
 * `null` and the caller falls back to CPU timing with the "estimated" flag set.
 */

type DisjointTimerExtension = {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
  beginQueryEXT?: (target: number, query: WebGLQuery) => void;
  endQueryEXT?: (target: number) => void;
  getQueryParameterEXT?: (query: WebGLQuery, pname: number) => number;
};

export interface GpuTimer {
  /** True when the driver reports real GPU timings. */
  readonly available: boolean;
  /** True when the last read was a real GPU measurement. */
  readonly measured: boolean;
  begin: () => void;
  end: () => void;
  /** Milliseconds of the last completed frame, or null when unavailable. */
  readMs: () => number | null;
  dispose: () => void;
}

const NULL_TIMER: GpuTimer = {
  available: false,
  measured: false,
  begin: () => undefined,
  end: () => undefined,
  readMs: () => null,
  dispose: () => undefined,
};

/**
 * Builds a timer for a WebGL2 context. Any missing piece degrades to the null
 * timer rather than throwing, so a browser without the extension plays normally.
 */
export function createGpuTimer(gl: WebGL2RenderingContext | null | undefined): GpuTimer {
  if (!gl) return NULL_TIMER;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as
    | DisjointTimerExtension
    | null
    | undefined;
  if (!ext) return NULL_TIMER;

  // Resolve the working shape once. A context method is preferred; the
  // extension form is only a fallback for older implementations.
  const beginQuery =
    typeof gl.beginQuery === 'function'
      ? (target: number, query: WebGLQuery) => gl.beginQuery(target, query)
      : typeof ext.beginQueryEXT === 'function'
        ? (target: number, query: WebGLQuery) => ext.beginQueryEXT?.(target, query)
        : null;
  const endQuery =
    typeof gl.endQuery === 'function'
      ? (target: number) => gl.endQuery(target)
      : typeof ext.endQueryEXT === 'function'
        ? (target: number) => ext.endQueryEXT?.(target)
        : null;
  // `QUERY_RESULT_AVAILABLE` comes back as a **boolean** in WebGL2 and
  // `QUERY_RESULT` as a number, so the return type is honestly both.
  const queryParameter =
    typeof gl.getQueryParameter === 'function'
      ? (query: WebGLQuery, pname: number) => gl.getQueryParameter(query, pname) as number | boolean
      : typeof ext.getQueryParameterEXT === 'function'
        ? (query: WebGLQuery, pname: number) => ext.getQueryParameterEXT?.(query, pname) ?? 0
        : null;

  if (!beginQuery || !endQuery || !queryParameter) return NULL_TIMER;

  let pending: WebGLQuery | null = null;
  // True between beginQuery and endQuery. A query may only be read once it has
  // been ended; asking a running query for its result is a GL error.
  let active = false;
  let lastMs: number | null = null;

  const poll = (): void => {
    if (!pending || active) return;
    const query = pending;
    try {
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
      // Read it for what it is. The old test was `!== 0`, and a boolean `false`
      // passes that (`false !== 0` is true), so every query counted as finished
      // on its very first poll: the result was read while the GPU still held it
      // (0), the query was deleted, and a new one started next frame. That is
      // why `readMs()` returned null on a driver whose timer queries work - a
      // raw query in the same page reports 67.8 us. A result is ready only when
      // the driver says `true` (or a non-zero number, for older shapes).
      const available = queryParameter(query, gl.QUERY_RESULT_AVAILABLE);
      const done = available === true || (typeof available === 'number' && available !== 0);
      if (!done) {
        // A disjoint event invalidates every outstanding query; drop it so the
        // next frame starts cleanly instead of waiting forever.
        if (disjoint) {
          gl.deleteQuery(query);
          pending = null;
        }
        return;
      }
      if (!disjoint) {
        const ns = queryParameter(query, gl.QUERY_RESULT) as number;
        if (Number.isFinite(ns) && ns > 0) lastMs = ns / 1e6;
      }
      gl.deleteQuery(query);
    } catch {
      // A lost context or a driver quirk must never break the frame loop.
      gl.deleteQuery(query);
    }
    pending = null;
  };

  return {
    available: true,
    get measured() {
      return lastMs !== null;
    },
    begin: () => {
      // Never queue a second query: the previous one is still being timed or
      // has not been collected yet, and its result is more useful than dropping it.
      if (pending) return;
      const query = gl.createQuery();
      if (!query) return;
      try {
        beginQuery(ext.TIME_ELAPSED_EXT, query);
      } catch {
        gl.deleteQuery(query);
        return;
      }
      pending = query;
      active = true;
    },
    end: () => {
      if (!pending || !active) return;
      try {
        endQuery(ext.TIME_ELAPSED_EXT);
      } catch {
        // Leave the query for poll() to drop.
        gl.deleteQuery(pending);
        pending = null;
        active = false;
        return;
      }
      active = false;
      poll();
    },
    readMs: () => {
      poll();
      return lastMs;
    },
    dispose: () => {
      if (pending) gl.deleteQuery(pending);
      pending = null;
      active = false;
      lastMs = null;
    },
  };
}
