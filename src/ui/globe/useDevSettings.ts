import { useState } from 'react';

import type { AtmosphereMode, EarthChannel, RenderSettings } from '@/globe';

import type { PinSource } from './debugControls';

/**
 * The dev panel's switches. They live with the canvas because the scene reads
 * them, and in production they simply keep their defaults.
 */
export interface DevSettings {
  readonly channel: EarthChannel;
  readonly setChannel: (channel: EarthChannel) => void;
  readonly cloudsVisible: boolean;
  readonly setCloudsVisible: (visible: boolean) => void;
  readonly atmosphere: AtmosphereMode;
  readonly setAtmosphere: (mode: AtmosphereMode) => void;
  readonly bloomEnabled: boolean;
  readonly setBloomEnabled: (enabled: boolean) => void;
  /** Overrides an OS reduced-motion preference, for checks and benchmarks. */
  readonly fullMotion: boolean;
  readonly setFullMotion: (full: boolean) => void;
  readonly pinsVisible: boolean;
  readonly setPinsVisible: (visible: boolean) => void;
  readonly pinSource: PinSource;
  readonly setPinSource: (source: PinSource) => void;
  readonly clustering: boolean;
  readonly setClustering: (clustering: boolean) => void;
  /**
   * Set while a benchmark runs. The dev overlays hide meanwhile: their backdrop
   * blur is recomposited over the canvas every frame, which costs a phone real
   * time and which production never pays.
   */
  readonly benchmarking: boolean;
  readonly setBenchmarking: (running: boolean) => void;
}

export function useDevSettings(settings: RenderSettings): DevSettings {
  const [channel, setChannel] = useState<EarthChannel>('lit');
  const [cloudsVisible, setCloudsVisible] = useState(true);
  const [atmosphere, setAtmosphere] = useState<AtmosphereMode>(settings.atmosphere);
  const [bloomEnabled, setBloomEnabled] = useState(settings.bloom);
  const [fullMotion, setFullMotion] = useState(false);
  const [pinsVisible, setPinsVisible] = useState(true);
  const [pinSource, setPinSource] = useState<PinSource>('live');
  const [clustering, setClustering] = useState(true);
  const [benchmarking, setBenchmarking] = useState(false);
  return {
    channel,
    setChannel,
    cloudsVisible,
    setCloudsVisible,
    atmosphere,
    setAtmosphere,
    bloomEnabled,
    setBloomEnabled,
    fullMotion,
    setFullMotion,
    pinsVisible,
    setPinsVisible,
    pinSource,
    setPinSource,
    clustering,
    setClustering,
    benchmarking,
    setBenchmarking,
  };
}
