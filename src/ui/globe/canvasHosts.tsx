import { useGlobeControls, type GlobeControlsOptions } from './useGlobeControls';
import { useRenderPipeline, type RenderPipelineOptions } from './useRenderPipeline';

/**
 * Hooks that must run inside <Canvas> (they read r3f's context), mounted as
 * render-nothing children of it.
 */

export function PipelineHost(props: RenderPipelineOptions): null {
  useRenderPipeline(props);
  return null;
}

export function ControlsHost(props: GlobeControlsOptions): null {
  useGlobeControls(props);
  return null;
}
