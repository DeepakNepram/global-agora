import type { JSX } from 'react';

import type { QualityTier } from '@/core';
import type { OrbitGlobeControls, RenderSettings } from '@/globe';

import { BloomBenchmark } from './BloomBenchmark';
import type { PresentLog } from './bloomReport';
import { CameraDebugControls } from './CameraDebugControls';
import { CameraOverlay } from './CameraOverlay';
import type { FrameProbe } from './frameProbe';
import { FrameTimeOverlay } from './FrameTimeOverlay';
import { GlobeDebugPanel } from './GlobeDebugPanel';
import { PinBenchmark } from './PinBenchmark';
import { PinDebugControls } from './PinDebugControls';
import { RenderDebugControls } from './RenderDebugControls';
import { ScrubBenchmark } from './ScrubBenchmark';
import { TierDebugControls } from './TierDebugControls';
import type { DevSettings } from './useDevSettings';

export interface GlobeDevToolsProps {
  readonly dev: DevSettings;
  readonly tier: QualityTier;
  readonly settings: RenderSettings;
  readonly probe: FrameProbe | null;
  readonly presentLog: PresentLog | null;
  readonly controls: OrbitGlobeControls | null;
  readonly reducedMotionPreferred: boolean;
  /** AppConfig.historyWindowHours, for the scrub benchmark. */
  readonly historyHours: number;
}

/**
 * Inspection tooling over the globe: the debug panel, the camera and frame
 * overlays and the benchmarks. GlobeCanvas mounts it only in development, so
 * production builds compile it out.
 */
export function GlobeDevTools(props: GlobeDevToolsProps): JSX.Element {
  const { dev, tier, settings, probe, presentLog, controls, reducedMotionPreferred } = props;
  const { historyHours } = props;

  return (
    <>
      <GlobeDebugPanel
        hidden={dev.benchmarking}
        channel={dev.channel}
        onChannelChange={dev.setChannel}
        cloudsVisible={dev.cloudsVisible}
        onCloudsVisibleChange={dev.setCloudsVisible}
      >
        <CameraDebugControls
          controls={controls}
          reducedMotionPreferred={reducedMotionPreferred}
          fullMotion={dev.fullMotion}
          onFullMotionChange={dev.setFullMotion}
        />
        <PinDebugControls
          visible={dev.pinsVisible}
          onVisibleChange={dev.setPinsVisible}
          source={dev.pinSource}
          onSourceChange={dev.setPinSource}
          clustering={dev.clustering}
          onClusteringChange={dev.setClustering}
        />
        {probe && (
          <PinBenchmark
            probe={probe}
            tier={tier}
            controls={controls}
            pinsVisible={dev.pinsVisible}
            pinSource={dev.pinSource}
            clustering={dev.clustering}
            onPinsVisibleChange={dev.setPinsVisible}
            onPinSourceChange={dev.setPinSource}
            onClusteringChange={dev.setClustering}
            onRunningChange={dev.setBenchmarking}
          />
        )}
        {probe && presentLog && (
          <BloomBenchmark
            probe={probe}
            log={presentLog}
            tier={tier}
            controls={controls}
            pinSource={dev.pinSource}
            clustering={dev.clustering}
            fullMotion={dev.fullMotion}
            onPinSourceChange={dev.setPinSource}
            onClusteringChange={dev.setClustering}
            onFullMotionChange={dev.setFullMotion}
            onRunningChange={dev.setBenchmarking}
          />
        )}
        {probe && presentLog && (
          <ScrubBenchmark
            probe={probe}
            log={presentLog}
            tier={tier}
            controls={controls}
            historyHours={historyHours}
            pinSource={dev.pinSource}
            clustering={dev.clustering}
            fullMotion={dev.fullMotion}
            onPinSourceChange={dev.setPinSource}
            onClusteringChange={dev.setClustering}
            onFullMotionChange={dev.setFullMotion}
            onRunningChange={dev.setBenchmarking}
          />
        )}
        <RenderDebugControls
          atmosphere={dev.atmosphere}
          onAtmosphereChange={dev.setAtmosphere}
          bloomEnabled={dev.bloomEnabled}
          onBloomEnabledChange={dev.setBloomEnabled}
          bloomAvailable={settings.postprocessing}
        />
        <TierDebugControls tier={tier} />
      </GlobeDebugPanel>

      <div hidden={dev.benchmarking}>
        {controls && <CameraOverlay controls={controls} />}
        {probe && (
          <FrameTimeOverlay
            probe={probe}
            tier={tier}
            atmosphere={dev.atmosphere}
            bloomEnabled={settings.postprocessing && dev.bloomEnabled}
          />
        )}
      </div>
      {dev.benchmarking && (
        // Plain, not blurred, so it costs the same with pins off and on.
        <p
          role="status"
          className="absolute left-4 top-4 rounded bg-void px-2 py-1 text-xs text-ink"
        >
          Benchmark running. Keep this page in front.
        </p>
      )}
    </>
  );
}
