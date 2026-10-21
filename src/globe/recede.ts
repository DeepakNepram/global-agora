import { BlendFunction, Effect, KawaseBlurPass, KernelSize } from 'postprocessing';
import {
  Uniform,
  WebGLRenderTarget,
  type Texture,
  type TextureDataType,
  type WebGLRenderer,
} from 'three';

/**
 * The globe receding behind the discussion panel (Prompt 4.5): a lens-style
 * rack focus, the focus pulled toward the viewer so the globe's blur grows
 * from nothing, with the colour drained and the light dimmed.
 *
 * Not a depth-buffer depth of field. With the focal plane in front of the
 * globe, every pixel of it is far behind focus and its circle of confusion
 * comes out nearly uniform; a real one would need a depth texture under MSAA
 * and a CoC pass for no visible difference (docs/DECISIONS.md).
 */

export interface RecedeLook {
  /** Share of the blurred image in the output. Rises fast, so the radius does the work. */
  readonly blurMix: number;
  /** Kawase scale per unit of pixel ratio: a constant radius in CSS pixels at any resolution. */
  readonly blurScalePerDpr: number;
  readonly desaturation: number;
  readonly dim: number;
  /** Multiplies the bloom's intensity. */
  readonly bloomScale: number;
}

/**
 * HUGE's offsets sum to ~50 texels at scale 1, measured in the full buffer's
 * texels (KawaseBlurMaterial), so 0.5 per unit of pixel ratio is ~25 CSS px.
 */
const MAX_BLUR_SCALE_PER_DPR = 0.5;
const MAX_DESATURATION = 0.8;
const MAX_DIM = 0.3;
const MIN_BLOOM_SCALE = 0.5;
/** The blurred image fades in over the first fifth, while its radius is still tiny. */
const BLUR_MIX_RAMP = 0.2;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** The look at `amount` (0, the globe as normal, to 1, fully behind the panel). */
export function recedeLook(amount: number): RecedeLook {
  const a = Number.isFinite(amount) ? Math.min(1, Math.max(0, amount)) : 0;
  return {
    blurMix: a === 0 ? 0 : smoothstep(0, BLUR_MIX_RAMP, a),
    blurScalePerDpr: MAX_BLUR_SCALE_PER_DPR * a,
    desaturation: MAX_DESATURATION * a,
    dim: MAX_DIM * a,
    bloomScale: 1 - (1 - MIN_BLOOM_SCALE) * a,
  };
}

const FRAGMENT = /* glsl */ `
uniform sampler2D blurBuffer;
uniform float blurMix;
uniform float desaturation;
uniform float dim;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 color = inputColor.rgb;
  // A uniform branch: every pixel takes the same side, so with the globe as
  // normal (blurMix 0) this is one comparison and no texture read.
  if (blurMix > 0.0) {
    color = mix(color, texture2D(blurBuffer, uv).rgb, blurMix);
    // Rec. 709 luminance of linear light: L = 0.2126 R + 0.7152 G + 0.0722 B.
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(color, vec3(luma), desaturation) * (1.0 - dim);
  }
  outputColor = vec4(color, inputColor.a);
}
`;

interface RecedeUniforms {
  readonly blurBuffer: Uniform<Texture | null>;
  readonly blurMix: Uniform<number>;
  readonly desaturation: Uniform<number>;
  readonly dim: Uniform<number>;
}

/**
 * First in the merged EffectPass, so bloom, ACES and the vignette apply on
 * top. Its blur runs in update(), before the pass draws, and only while the
 * amount is above 0: at rest on the globe it adds no pass and no texture read,
 * and since it is always in the pass, entering a discussion never recompiles.
 */
export class RecedeEffect extends Effect {
  private readonly values: RecedeUniforms;
  private readonly blurPass: KawaseBlurPass;
  private readonly blurTarget: WebGLRenderTarget;
  private amount = 0;

  constructor() {
    const values: RecedeUniforms = {
      blurBuffer: new Uniform<Texture | null>(null),
      blurMix: new Uniform(0),
      desaturation: new Uniform(0),
      dim: new Uniform(0),
    };
    super('RecedeEffect', FRAGMENT, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, Uniform>(Object.entries(values)),
    });
    this.values = values;
    // A quarter of the buffer's resolution: the blur is soft by definition,
    // its radius is set in full-buffer texels (KawaseBlurMaterial), and its
    // cost scales with the pixels it touches: 10% off every transition frame
    // against half (Prompt 4.5's benchmark).
    this.blurPass = new KawaseBlurPass({ kernelSize: KernelSize.HUGE, resolutionScale: 0.25 });
    this.blurTarget = new WebGLRenderTarget(1, 1, { depthBuffer: false });
    this.blurTarget.texture.name = 'Recede.Blur';
    values.blurBuffer.value = this.blurTarget.texture;
  }

  /** 0 (the globe as normal) to 1 (fully behind the panel). */
  setAmount(amount: number): void {
    const look = recedeLook(amount);
    this.amount = look.blurScalePerDpr > 0 ? amount : 0;
    this.values.blurMix.value = look.blurMix;
    this.values.desaturation.value = look.desaturation;
    this.values.dim.value = look.dim;
  }

  override update(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget): void {
    if (this.amount <= 0) return;
    const look = recedeLook(this.amount);
    this.blurPass.blurMaterial.scale = look.blurScalePerDpr * renderer.getPixelRatio();
    this.blurPass.render(renderer, inputBuffer, this.blurTarget);
  }

  override setSize(width: number, height: number): void {
    this.blurPass.setSize(width, height);
    this.blurTarget.setSize(this.blurPass.resolution.width, this.blurPass.resolution.height);
  }

  /**
   * Compiles the blur's two shaders now, at startup with every other one,
   * rather than lazily in the first frame of the first discussion's
   * transition (a 10 ms hitch on a laptop, more on a phone).
   */
  warm(renderer: WebGLRenderer): void {
    const previous = renderer.getRenderTarget();
    const source = new WebGLRenderTarget(4, 4, { depthBuffer: false });
    source.texture.type = this.blurTarget.texture.type;
    this.blurPass.render(renderer, source, this.blurTarget);
    renderer.setRenderTarget(previous);
    source.dispose();
  }

  override initialize(renderer: WebGLRenderer, alpha: boolean, frameBufferType: number): void {
    this.blurPass.initialize(renderer, alpha, frameBufferType);
    // Half float like the scene buffer: city lights above 1.0 stay bright through the blur.
    this.blurTarget.texture.type = frameBufferType as TextureDataType;
  }
}
