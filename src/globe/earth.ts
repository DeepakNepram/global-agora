import { Group, Mesh, SphereGeometry, type Object3D } from 'three';

import { GLOBE_RADIUS, type TextureSet } from '@/core';

import { createCloudMaterial } from './cloudMaterial';
import { createEarthMaterial } from './earthMaterial';
import type { EarthChannel } from './shaders/earth.glsl';
import { loadEarthTextures } from './textureLoading';
import { earthTiltQuaternion } from './views';

export const EARTH_SEGMENTS = 128;

/**
 * 0.3% above the surface is ~19km at Earth scale — high enough to clear
 * z-fighting at 24-bit depth from any sane camera distance, low enough that
 * clouds don't visibly float off the limb.
 */
export const CLOUD_RADIUS = GLOBE_RADIUS * 1.003;

/** One revolution every 10 minutes, eastward: slow enough to read as weather. */
export const CLOUD_ANGULAR_SPEED = (2 * Math.PI) / 600;

/**
 * With frameloop="demand", the frame delta is time since the last *rendered*
 * frame, which after a hidden tab can be minutes. Clamped so clouds drift
 * instead of jumping when the page comes back.
 */
const MAX_STEP_SECONDS = 0.25;

const TAU = Math.PI * 2;

export interface EarthOptions {
  readonly textures: TextureSet;
  readonly maxAnisotropy: number;
  /** A texture finished loading; the host must schedule a frame. */
  readonly onTextureLoad: () => void;
  readonly channel?: EarthChannel;
  readonly cloudsVisible?: boolean;
}

export interface EarthLayer {
  /** Add this to the scene. Carries the axial tilt. */
  readonly object3d: Object3D;
  setChannel(channel: EarthChannel): void;
  setCloudsVisible(visible: boolean): void;
  /** Advance time-driven motion. Returns true if anything moved. */
  advance(dtSeconds: number): boolean;
  dispose(): void;
}

/**
 * Builds the base Earth.
 *
 *   tilt            quaternion = 23.44° about X
 *    ├─ earth       SphereGeometry(1.0) + flat ShaderMaterial
 *    └─ cloudSpin   rotation.y advances
 *        └─ clouds  SphereGeometry(1.003) + transparent basic material
 *
 * Tilt lives on one parent so clouds inherit it and spin about the *tilted*
 * axis, as real weather does.
 */
export function createEarth(options: EarthOptions): EarthLayer {
  const textures = loadEarthTextures(options.textures, {
    maxAnisotropy: options.maxAnisotropy,
    onLoad: () => options.onTextureLoad(),
  });

  const earthGeometry = new SphereGeometry(GLOBE_RADIUS, EARTH_SEGMENTS, EARTH_SEGMENTS);
  const earthMaterial = createEarthMaterial(textures, options.channel ?? 'day');
  const earth = new Mesh(earthGeometry, earthMaterial.material);
  earth.name = 'earth';

  // Clouds are low-frequency, so half the latitude bands of the surface is plenty.
  const cloudGeometry = new SphereGeometry(CLOUD_RADIUS, EARTH_SEGMENTS, EARTH_SEGMENTS / 2);
  const cloudMaterial = createCloudMaterial(textures.clouds);
  const clouds = new Mesh(cloudGeometry, cloudMaterial);
  clouds.name = 'clouds';
  // Draw after the opaque surface regardless of camera-distance sorting.
  clouds.renderOrder = 1;

  const cloudSpin = new Group();
  cloudSpin.name = 'cloud-spin';
  cloudSpin.add(clouds);
  cloudSpin.visible = options.cloudsVisible ?? true;

  const tilt = new Group();
  tilt.name = 'earth-tilt';
  earthTiltQuaternion(tilt.quaternion);
  tilt.add(earth, cloudSpin);

  return {
    object3d: tilt,

    setChannel(channel) {
      earthMaterial.setChannel(channel);
    },

    setCloudsVisible(visible) {
      cloudSpin.visible = visible;
    },

    advance(dtSeconds) {
      if (!cloudSpin.visible || dtSeconds <= 0) return false;
      // Constant angular velocity, so plain rate * dt is already frame-rate
      // independent. The exp() smoothing rule in CLAUDE.md is for easing toward
      // a target; there is no target here.
      const step = Math.min(dtSeconds, MAX_STEP_SECONDS);
      cloudSpin.rotation.y = (cloudSpin.rotation.y + CLOUD_ANGULAR_SPEED * step) % TAU;
      return true;
    },

    dispose() {
      tilt.removeFromParent();
      earthGeometry.dispose();
      cloudGeometry.dispose();
      earthMaterial.material.dispose();
      cloudMaterial.dispose();
      for (const texture of Object.values(textures)) texture.dispose();
    },
  };
}
