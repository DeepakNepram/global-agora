/**
 * Platform adapter: measures the device, reads the manual override.
 *
 * This is the impure half of the quality system. It lives in src/ui because it
 * touches WebGL, `navigator` and `localStorage` — none of which src/core or
 * src/globe are allowed to reach for. In a native port this file is the piece
 * that gets replaced; `src/core/quality.ts` is not.
 */
import {
  decideTier,
  parseTierOverride,
  QUALITY_OVERRIDE_STORAGE_KEY,
  type DeviceCapabilities,
  type QualityTier,
  type TierDecision,
} from '@/core';

/** Conservative stand-in for when WebGL cannot be created at all. */
const UNKNOWN_CAPABILITIES: DeviceCapabilities = {
  maxTextureSize: 0,
  rendererDescription: 'unavailable',
  deviceMemoryGb: null,
  hardwareConcurrency: null,
  screenWidth: 0,
  screenHeight: 0,
  devicePixelRatio: 1,
};

interface NavigatorWithMemory extends Navigator {
  readonly deviceMemory?: number;
}

function readRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  // WEBGL_debug_renderer_info is gated in some browsers; an empty string just
  // means the GPU-name heuristics sit out and the numeric checks decide.
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  if (ext) {
    const unmasked: unknown = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    if (typeof unmasked === 'string' && unmasked !== '') return unmasked;
  }
  const fallback: unknown = gl.getParameter(gl.RENDERER);
  return typeof fallback === 'string' ? fallback : '';
}

/**
 * Probes the device with a throwaway 1x1 context, which is then explicitly lost
 * — leaking GL contexts is how you hit the browser's per-page context cap.
 */
export function detectCapabilities(): DeviceCapabilities {
  if (typeof document === 'undefined' || typeof navigator === 'undefined') {
    return UNKNOWN_CAPABILITIES;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;

  const gl =
    canvas.getContext('webgl2') ??
    (canvas.getContext('webgl') as WebGLRenderingContext | null) ??
    null;

  if (gl === null) return UNKNOWN_CAPABILITIES;

  try {
    const maxTextureSize: unknown = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const nav = navigator as NavigatorWithMemory;

    return {
      maxTextureSize: typeof maxTextureSize === 'number' ? maxTextureSize : 0,
      rendererDescription: readRenderer(gl),
      deviceMemoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
      hardwareConcurrency:
        typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
      // Some embedded webviews report screen 0x0; the viewport is a usable
      // stand-in and is never 0 in a real window.
      screenWidth: window.screen.width || window.innerWidth,
      screenHeight: window.screen.height || window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    };
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/** Reads the manual override. Any storage failure degrades to auto-detection. */
export function readTierOverride(): QualityTier | null {
  try {
    return parseTierOverride(window.localStorage.getItem(QUALITY_OVERRIDE_STORAGE_KEY));
  } catch {
    // Private mode, blocked site data, or a sandboxed iframe.
    return null;
  }
}

/** Forces a tier for testing. Pass null to clear and return to auto-detection. */
export function writeTierOverride(tier: QualityTier | null): void {
  try {
    if (tier === null) {
      window.localStorage.removeItem(QUALITY_OVERRIDE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(QUALITY_OVERRIDE_STORAGE_KEY, tier);
    }
  } catch {
    console.warn('Could not persist the quality override; it will not survive a reload.');
  }
}

/** Measure, read the override, decide. The one call the app actually makes. */
export function resolveQuality(): TierDecision {
  return decideTier(detectCapabilities(), readTierOverride());
}
