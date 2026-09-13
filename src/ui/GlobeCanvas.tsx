import { Canvas } from '@react-three/fiber';
import { useMemo, useState, type JSX } from 'react';

import { textureSetForTier, type QualityTier } from '@/core';
import type { EarthChannel } from '@/globe';

import { viewPreset, type ViewPresetId } from './globe/debugControls';
import { GlobeDebugPanel } from './globe/GlobeDebugPanel';
import { GlobeScene } from './globe/GlobeScene';
import { useLiveClock } from './globe/useLiveClock';

export interface GlobeCanvasProps {
  readonly tier: QualityTier;
}

/**
 * The one <Canvas> in the app.
 *
 * - frameloop="demand": nothing draws unless something calls invalidate().
 * - flat: NoToneMapping. r3f otherwise defaults to ACESFilmic, which shifts
 *   every colour and makes "does this texture look right" unanswerable.
 * - dpr capped at 2: a 3x phone would otherwise fill 2.25x the pixels of 2x
 *   for no visible gain on a sphere.
 */
export function GlobeCanvas({ tier }: GlobeCanvasProps): JSX.Element {
  const [view, setView] = useState<ViewPresetId>('primeMeridian');
  const [channel, setChannel] = useState<EarthChannel>('lit');
  const [cloudsVisible, setCloudsVisible] = useState(true);
  useLiveClock();

  // BASE_URL is resolved here, not in src/core, which must not read Vite globals.
  const textures = useMemo(
    () => textureSetForTier(tier, `${import.meta.env.BASE_URL}textures`),
    [tier],
  );

  return (
    <div className="absolute inset-0">
      <Canvas
        frameloop="demand"
        flat
        dpr={[1, 2]}
        camera={{ fov: 35, near: 0.1, far: 100, position: [4, 0, 0] }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        role="img"
        aria-label="Globe of Earth"
        fallback={
          <p className="p-6 text-sm text-muted">
            This globe needs WebGL, which is unavailable in this browser.
          </p>
        }
      >
        <GlobeScene
          textures={textures}
          channel={channel}
          cloudsVisible={cloudsVisible}
          view={viewPreset(view).at}
        />
      </Canvas>

      {/* Inspection tooling only; compiled out of production builds. */}
      {import.meta.env.DEV && (
        <GlobeDebugPanel
          view={view}
          onViewChange={setView}
          channel={channel}
          onChannelChange={setChannel}
          cloudsVisible={cloudsVisible}
          onCloudsVisibleChange={setCloudsVisible}
        />
      )}
    </div>
  );
}
