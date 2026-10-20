import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';

import { createGpuTimer, createRenderPipeline, type RenderSettings } from '@/globe';
import { monotonicNowMs } from '@/state';

import { createFrameGovernor, frameDue } from './frameGovernor';
import type { FrameProbe } from './frameProbe';

/**
 * r3f priority for the render callback. Any positive priority tells r3f to stop
 * calling gl.render itself; lower-priority callbacks (scene updates) run first.
 */
const RENDER_PRIORITY = 1;

export interface RenderPipelineOptions {
  readonly settings: RenderSettings;
  readonly bloomEnabled: boolean;
  /** Frame timing sink. null in production: no timer queries, no bookkeeping. */
  readonly probe: FrameProbe | null;
  /**
   * Least time between draws, ms: the 30 fps cap behind a settled discussion
   * panel (Prompt 4.5). 0 draws every frame asked for.
   */
  readonly frameIntervalMs?: number;
  /** How far the globe has receded behind the discussion panel this frame, 0 to 1. */
  readonly recede?: () => number;
}

/**
 * Owns the frame: builds the tier's pipeline, keeps it sized, and draws every
 * frame r3f schedules. Timing wraps exactly the draw call, so the overlay shows
 * the cost of rendering and nothing else.
 */
export function useRenderPipeline(options: RenderPipelineOptions): void {
  const { settings, bloomEnabled, probe } = options;
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const width = useThree((state) => state.size.width);
  const height = useThree((state) => state.size.height);
  const dpr = useThree((state) => state.viewport.dpr);

  const pipelineRef = useRef<ReturnType<typeof createRenderPipeline> | null>(null);
  const timerRef = useRef<ReturnType<typeof createGpuTimer> | null>(null);
  const governor = useRef(createFrameGovernor());
  const intervalRef = useRef(options.frameIntervalMs ?? 0);
  const recedeRef = useRef(options.recede);

  useEffect(() => {
    intervalRef.current = options.frameIntervalMs ?? 0;
    recedeRef.current = options.recede;
  });

  useEffect(() => {
    const pipeline = createRenderPipeline(gl, scene, camera, settings);
    pipelineRef.current = pipeline;
    invalidate();
    return () => {
      pipelineRef.current = null;
      pipeline.dispose();
    };
  }, [gl, scene, camera, settings, invalidate]);

  useEffect(() => {
    pipelineRef.current?.setBloomEnabled(bloomEnabled);
    invalidate();
  }, [bloomEnabled, settings, invalidate]);

  useEffect(() => {
    pipelineRef.current?.setSize(width, height);
    probe?.setBufferSize(gl.domElement.width, gl.domElement.height);
    invalidate();
  }, [gl, width, height, dpr, settings, probe, invalidate]);

  useEffect(() => {
    if (!probe) return;
    const timer = createGpuTimer(gl.getContext());
    timerRef.current = timer;
    probe.setGpuSupported(timer.supported);
    const unsubscribe = probe.onBenchmarkStart(() => invalidate());
    return () => {
      unsubscribe();
      timerRef.current = null;
      timer.dispose();
    };
  }, [gl, probe, invalidate]);

  useFrame((_state, delta) => {
    const pipeline = pipelineRef.current;
    if (!pipeline) return;
    // Not due yet under a cap: skip this vsync and ask again on the next.
    if (!frameDue(governor.current, monotonicNowMs(), intervalRef.current)) {
      invalidate();
      return;
    }
    pipeline.setRecede(recedeRef.current?.() ?? 0);
    const timer = timerRef.current;
    if (!probe || !timer) {
      pipeline.render(delta);
      return;
    }

    const start = monotonicNowMs();
    timer.begin();
    pipeline.render(delta);
    timer.end();
    const needsAnotherFrame = probe.recordFrame(start, monotonicNowMs() - start);
    timer.poll((ms) => probe.recordGpu(ms));
    // Benchmarks draw continuously; everything else stays render-on-demand.
    if (needsAnotherFrame) invalidate();
  }, RENDER_PRIORITY);
}
