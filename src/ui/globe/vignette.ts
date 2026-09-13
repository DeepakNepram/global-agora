/**
 * CSS stand-in for the composer's vignette on the LOW tier, which has no
 * composer. Derived from the same parameters so the two tiers match.
 */

export interface VignetteParams {
  readonly offset: number;
  readonly darkness: number;
}

/**
 * postprocessing's VignetteEffect (default technique), d = UV distance from the
 * centre (not aspect-corrected, so the shape is an ellipse):
 *   factor = smoothstep(0.8, offset * 0.799, d * (darkness + offset))
 * It multiplies linear colour after tone mapping.
 */
export function vignetteFactor(d: number, { offset, darkness }: VignetteParams): number {
  const edge0 = 0.8;
  const edge1 = offset * 0.799;
  const t = Math.min(Math.max((d * (darkness + offset) - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Display gamma: a black overlay of alpha a scales the already-encoded colour by 1 - a. */
const DISPLAY_GAMMA = 2.2;

/** Corner distance in UV units. */
const CORNER = Math.SQRT1_2;
const STEPS = 8;

/**
 * An elliptical radial gradient of black whose alpha reproduces the factor.
 * Ellipse radii of 50% width/height put 100% at d = 0.5, so stop percent = 200d.
 */
export function vignetteCssGradient(params: VignetteParams): string {
  const stops: string[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const d = 0.3 + ((CORNER - 0.3) * i) / STEPS;
    const encoded = Math.pow(vignetteFactor(d, params), 1 / DISPLAY_GAMMA);
    const alpha = Math.max(0, 1 - encoded);
    stops.push(`rgba(0, 0, 0, ${alpha.toFixed(3)}) ${(d * 200).toFixed(1)}%`);
  }
  return `radial-gradient(ellipse 50% 50% at 50% 50%, ${stops.join(', ')})`;
}
