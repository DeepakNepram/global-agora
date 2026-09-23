import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useState, type JSX } from 'react';

import { sunDirection, type PreviewTextureSet, type TextureSet } from '@/core';
import { createEarth, type AtmosphereMode, type EarthChannel, type EarthLayer } from '@/globe';
import { timeStore } from '@/state';

import { useCloudTicker } from './useCloudTicker';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

export interface GlobeSceneProps {
  readonly textures: TextureSet;
  /** Drawn while `textures` download; see previewTextureSet. */
  readonly previewTextures: PreviewTextureSet;
  readonly channel: EarthChannel;
  readonly cloudsVisible: boolean;
  readonly atmosphere: AtmosphereMode;
}

/**
 * The r3f adapter for src/globe. It owns lifecycle and frame scheduling only;
 * everything that draws lives in src/globe and knows nothing about React. The
 * camera is not placed here: useGlobeControls owns it.
 */
export function GlobeScene({
  textures,
  previewTextures,
  channel,
  cloudsVisible,
  atmosphere,
}: GlobeSceneProps): JSX.Element | null {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const reducedMotion = usePrefersReducedMotion();

  const [earth, setEarth] = useState<EarthLayer | null>(null);

  // Built and disposed inside one effect so StrictMode's mount/unmount/mount in
  // dev yields a fresh globe on the second mount instead of a disposed one.
  useEffect(() => {
    const layer = createEarth({
      textures,
      previewTextures,
      maxAnisotropy: gl.capabilities.getMaxAnisotropy(),
      onTextureLoad: () => invalidate(),
      sunDirection: sunDirection(new Date(timeStore.getState().timeMs)),
    });
    setEarth(layer);
    return () => {
      setEarth(null);
      layer.dispose();
    };
  }, [textures, previewTextures, gl, invalidate]);

  useEffect(() => {
    if (!earth) return;
    earth.setChannel(channel);
    invalidate();
  }, [earth, channel, invalidate]);

  useEffect(() => {
    if (!earth) return;
    earth.setCloudsVisible(cloudsVisible);
    invalidate();
  }, [earth, cloudsVisible, invalidate]);

  useEffect(() => {
    if (!earth) return;
    earth.setAtmosphereMode(atmosphere);
    invalidate();
  }, [earth, atmosphere, invalidate]);

  useEffect(() => {
    if (!earth) return;
    const showInstant = (timeMs: number): void => {
      earth.setSunDirection(sunDirection(new Date(timeMs)));
      invalidate();
    };
    showInstant(timeStore.getState().timeMs);
    // Subscribed outside React: dragging a time slider rewrites one uniform and
    // schedules one frame, with no component re-render in between.
    return timeStore.subscribe((state, previous) => {
      if (state.timeMs !== previous.timeMs) showInstant(state.timeMs);
    });
  }, [earth, invalidate]);

  useCloudTicker(invalidate, earth !== null && cloudsVisible && !reducedMotion);

  useFrame((_state, delta) => {
    if (earth && !reducedMotion) earth.advance(delta);
  });

  return earth ? <primitive object={earth.object3d} /> : null;
}
