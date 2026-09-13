import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useState, type JSX } from 'react';

import { sunDirection, type LatLon, type TextureSet } from '@/core';
import { aimCamera, createEarth, type EarthChannel, type EarthLayer } from '@/globe';
import { timeStore } from '@/state';

import { useCloudTicker } from './useCloudTicker';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * Camera distance in globe radii for a landscape viewport. With a 35° vertical
 * FOV the globe fills ~80% of the height.
 */
const CAMERA_DISTANCE = 4;

export interface GlobeSceneProps {
  readonly textures: TextureSet;
  readonly channel: EarthChannel;
  readonly cloudsVisible: boolean;
  readonly view: LatLon;
}

/**
 * The r3f adapter for src/globe. It owns lifecycle and frame scheduling only;
 * everything that draws lives in src/globe and knows nothing about React.
 */
export function GlobeScene({
  textures,
  channel,
  cloudsVisible,
  view,
}: GlobeSceneProps): JSX.Element | null {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const aspect = useThree((state) => state.size.width / Math.max(1, state.size.height));
  const reducedMotion = usePrefersReducedMotion();

  const [earth, setEarth] = useState<EarthLayer | null>(null);

  // Built and disposed inside one effect so StrictMode's mount/unmount/mount in
  // dev yields a fresh globe on the second mount instead of a disposed one.
  useEffect(() => {
    const layer = createEarth({
      textures,
      maxAnisotropy: gl.capabilities.getMaxAnisotropy(),
      onTextureLoad: () => invalidate(),
      sunDirection: sunDirection(new Date(timeStore.getState().timeMs)),
    });
    setEarth(layer);
    return () => {
      setEarth(null);
      layer.dispose();
    };
  }, [textures, gl, invalidate]);

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

  useEffect(() => {
    // Portrait viewports are width-limited; back off so the limb isn't clipped.
    aimCamera(camera, view, CAMERA_DISTANCE / Math.min(1, aspect));
    invalidate();
  }, [camera, view, aspect, invalidate]);

  useCloudTicker(invalidate, earth !== null && cloudsVisible && !reducedMotion);

  useFrame((_state, delta) => {
    if (earth && !reducedMotion) earth.advance(delta);
  });

  return earth ? <primitive object={earth.object3d} /> : null;
}
