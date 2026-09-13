import { Group, Mesh, SphereGeometry, type Object3D } from 'three';

import { GLOBE_RADIUS, type TextureSet, type Vec3 } from '@/core';

import { createCloudMaterial } from './cloudMaterial';
import { createEarthMaterial } from './earthMaterial';
import type { EarthChannel } from './shaders/earth.glsl';
import { sunInSpinFrame, toVector3 } from './sunFrame';
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
  /**
   * Unit vector toward the sun, Earth-fixed frame. Required so the first frame
   * is lit for the right instant rather than for a placeholder sun.
   */
  readonly sunDirection: Vec3;
  readonly channel?: EarthChannel;
  readonly cloudsVisible?: boolean;
}

export interface EarthLayer {
  /** Add this to the scene. Carries the axial tilt. */
  readonly object3d: Object3D;
  setChannel(channel: EarthChannel): void;
  setCloudsVisible(visible: boolean): void;
  /** Unit vector toward the sun, Earth-fixed frame (src/core sunDirection). */
  setSunDirection(direction: Vec3): void;
  /** Advance time-driven motion. Returns true if anything moved. */
  advance(dtSeconds: number): boolean;
  dispose(): void;
}

/**
 * Builds the base Earth.
 *
 *   tilt            quaternion = 23.44° about X
 *    ├─ earth       SphereGeometry(1.0) + sun-lit ShaderMaterial
 *    └─ cloudSpin   rotation.y advances
 *        └─ clouds  SphereGeometry(1.003) + sun-lit transparent ShaderMaterial
 *
 * Tilt lives on one parent so clouds inherit it and spin about the *tilted*
 * axis, as real weather does. The layer never reads the clock: the sun arrives
 * through setSunDirection, driven by whatever instant the host is showing.
 */
export function createEarth(options: EarthOptions): EarthLayer {
  const textures = loadEarthTextures(options.textures, {
    maxAnisotropy: options.maxAnisotropy,
    onLoad: () => options.onTextureLoad(),
  });

  const earthGeometry = new SphereGeometry(GLOBE_RADIUS, EARTH_SEGMENTS, EARTH_SEGMENTS);
  const earthMaterial = createEarthMaterial(
    textures,
    options.channel ?? 'lit',
    options.sunDirection,
  );
  const earth = new Mesh(earthGeometry, earthMaterial.material);
  earth.name = 'earth';

  // Clouds are low-frequency, so half the latitude bands of the surface is plenty.
  const cloudGeometry = new SphereGeometry(CLOUD_RADIUS, EARTH_SEGMENTS, EARTH_SEGMENTS / 2);
  const cloudMaterial = createCloudMaterial(textures.clouds);
  const clouds = new Mesh(cloudGeometry, cloudMaterial.material);
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

  // The Earth-fixed sun is kept so the cloud shell's copy can be re-derived
  // whenever either the sun moves or the shell spins under it.
  const sun = toVector3(options.sunDirection);
  const syncCloudSun = (): void => {
    sunInSpinFrame(sun, cloudSpin.rotation.y, cloudMaterial.sunDirection);
  };
  syncCloudSun();

  return {
    object3d: tilt,

    setChannel(channel) {
      earthMaterial.setChannel(channel);
    },

    setCloudsVisible(visible) {
      cloudSpin.visible = visible;
    },

    setSunDirection(direction) {
      toVector3(direction, sun);
      earthMaterial.setSunDirection(direction);
      syncCloudSun();
    },

    advance(dtSeconds) {
      if (!cloudSpin.visible || dtSeconds <= 0) return false;
      // Constant angular velocity, so plain rate * dt is already frame-rate
      // independent. The exp() smoothing rule in CLAUDE.md is for easing toward
      // a target; there is no target here.
      const step = Math.min(dtSeconds, MAX_STEP_SECONDS);
      cloudSpin.rotation.y = (cloudSpin.rotation.y + CLOUD_ANGULAR_SPEED * step) % TAU;
      syncCloudSun();
      return true;
    },

    dispose() {
      tilt.removeFromParent();
      earthGeometry.dispose();
      cloudGeometry.dispose();
      earthMaterial.material.dispose();
      cloudMaterial.material.dispose();
      for (const texture of Object.values(textures)) texture.dispose();
    },
  };
}
