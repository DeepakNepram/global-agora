import {
  AdditiveBlending,
  BackSide,
  CustomBlending,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';

import { GLOBE_RADIUS } from '@/core';

import type { AtmosphereMode } from './renderSettings';
import {
  ATMOSPHERE_RADIUS,
  ATMOSPHERE_VERT,
  RIM_FRAG,
  SCATTER_FRAG,
} from './shaders/atmosphere.glsl';

export interface AtmosphereLayer {
  readonly mesh: Mesh;
  setMode(mode: AtmosphereMode): void;
  dispose(): void;
}

/**
 * The atmosphere shell. `sun` is shared by reference with the owner, which
 * keeps it pointing at the sun in the Earth-fixed frame.
 *
 * Both materials exist from the start but only the active one is ever drawn,
 * so the inactive one is never compiled.
 */
export function createAtmosphere(mode: AtmosphereMode, sun: Vector3): AtmosphereLayer {
  const uniforms = {
    uSunDir: { value: sun },
    uCameraLocal: { value: new Vector3() },
  };

  const rim = new ShaderMaterial({
    vertexShader: ATMOSPHERE_VERT,
    fragmentShader: RIM_FRAG,
    uniforms,
    side: BackSide,
    transparent: true,
    depthWrite: false,
    // Additive glow outside the limb; the Earth's depth hides the far shell.
    blending: AdditiveBlending,
  });

  const scattering = new ShaderMaterial({
    vertexShader: ATMOSPHERE_VERT,
    fragmentShader: SCATTER_FRAG,
    uniforms,
    side: BackSide,
    transparent: true,
    depthWrite: false,
    // The shader intersects the Earth itself, so depth would only cut the haze
    // off at the limb. Premultiplied, so haze dims what it lies over.
    depthTest: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
  });

  // Silhouette smoothness matters more than latitude detail on a glow shell.
  const geometry = new SphereGeometry(GLOBE_RADIUS * ATMOSPHERE_RADIUS, 96, 48);
  const mesh = new Mesh(geometry, mode === 'rim' ? rim : scattering);
  mesh.name = 'atmosphere';
  // After the surface and the clouds, so the haze composites over both.
  mesh.renderOrder = 2;

  // The camera moves independently of the tilted globe; re-derive its position
  // in shell space right before each draw. matrixWorld is current by then.
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    mesh.worldToLocal(uniforms.uCameraLocal.value.setFromMatrixPosition(camera.matrixWorld));
  };

  return {
    mesh,
    setMode(next) {
      mesh.material = next === 'rim' ? rim : scattering;
    },
    dispose() {
      geometry.dispose();
      rim.dispose();
      scattering.dispose();
    },
  };
}
