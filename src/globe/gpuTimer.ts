/**
 * GPU frame timing through EXT_disjoint_timer_query_webgl2.
 *
 * CPU timing of a WebGL frame only measures command submission; the GPU works
 * asynchronously. A timer query measures the GPU's own time for everything
 * between begin() and end(), and resolves a few frames later.
 *
 * Results are dropped when the GPU reports a disjoint event (context switch,
 * power state change), because the measured interval is then meaningless.
 */

/** The two constants this module needs; lib.dom types getExtension() as `any`. */
interface TimerQueryExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

export interface GpuTimer {
  /** False where the extension is missing: begin/end/poll are then no-ops. */
  readonly supported: boolean;
  begin(): void;
  end(): void;
  /** Delivers every finished measurement, in milliseconds, oldest first. */
  poll(onResult: (milliseconds: number) => void): void;
  dispose(): void;
}

/** Unresolved queries allowed before new frames stop being measured. */
const MAX_PENDING = 8;

const NOOP_TIMER: GpuTimer = {
  supported: false,
  begin() {},
  end() {},
  poll() {},
  dispose() {},
};

function isWebGl2(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
): gl is WebGL2RenderingContext {
  return typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
}

export function createGpuTimer(gl: WebGLRenderingContext | WebGL2RenderingContext): GpuTimer {
  if (!isWebGl2(gl)) return NOOP_TIMER;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExtension | null;
  if (!ext) return NOOP_TIMER;

  const free: WebGLQuery[] = [];
  const pending: WebGLQuery[] = [];
  let active: WebGLQuery | null = null;

  return {
    supported: true,

    begin() {
      // One TIME_ELAPSED query may be active at a time; skip rather than nest.
      if (active || pending.length >= MAX_PENDING) return;
      const query = free.pop() ?? gl.createQuery();
      if (!query) return;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      active = query;
    },

    end() {
      if (!active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
    },

    poll(onResult) {
      // Checked once for the whole batch: a disjoint event invalidates every
      // query that was in flight when it happened.
      const disjoint = Boolean(gl.getParameter(ext.GPU_DISJOINT_EXT));
      while (pending.length > 0) {
        const query = pending[0]!;
        if (!disjoint && !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
        pending.shift();
        if (!disjoint) {
          const nanoseconds = Number(gl.getQueryParameter(query, gl.QUERY_RESULT));
          onResult(nanoseconds / 1e6);
        }
        free.push(query);
      }
    },

    dispose() {
      if (active) gl.endQuery(ext.TIME_ELAPSED_EXT);
      for (const query of [...free, ...pending]) gl.deleteQuery(query);
      if (active) gl.deleteQuery(active);
      free.length = 0;
      pending.length = 0;
      active = null;
    },
  };
}
