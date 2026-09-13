import {
  BackSide,
  PerspectiveCamera,
  type Group,
  Scene,
  Vector3,
  type ShaderMaterial,
  type SphereGeometry,
  type WebGLRenderer,
} from 'three';
import { describe, expect, it } from 'vitest';

import { createAtmosphere } from './atmosphere';
import { ATMOSPHERE_RADIUS } from './shaders/atmosphere.glsl';

function material(layer: ReturnType<typeof createAtmosphere>): ShaderMaterial {
  return layer.mesh.material as ShaderMaterial;
}

describe('createAtmosphere', () => {
  it('builds a back-face shell at the radius the shaders assume', () => {
    const layer = createAtmosphere('rim', new Vector3(1, 0, 0));
    const geometry = layer.mesh.geometry as SphereGeometry;
    expect(geometry.parameters.radius).toBeCloseTo(ATMOSPHERE_RADIUS, 12);
    expect(material(layer).side).toBe(BackSide);
    // Clouds use renderOrder 1; the haze must composite over them.
    expect(layer.mesh.renderOrder).toBeGreaterThan(1);
    layer.dispose();
  });

  it('rim relies on depth to hide the far shell; scattering intersects the Earth itself', () => {
    const layer = createAtmosphere('rim', new Vector3(1, 0, 0));
    expect(material(layer).depthTest).toBe(true);
    layer.setMode('scattering');
    expect(material(layer).depthTest).toBe(false);
    expect(material(layer).depthWrite).toBe(false);
    layer.dispose();
  });

  it('shares the owner’s sun vector, so setSunDirection reaches the shell', () => {
    const sun = new Vector3(1, 0, 0);
    const layer = createAtmosphere('scattering', sun);
    expect(material(layer).uniforms.uSunDir?.value).toBe(sun);
    layer.dispose();
  });

  it('puts the camera into shell space before each draw', () => {
    const layer = createAtmosphere('rim', new Vector3(1, 0, 0));
    layer.mesh.rotation.x = Math.PI / 2;
    layer.mesh.updateMatrixWorld();
    const camera = new PerspectiveCamera();
    camera.position.set(0, 4, 0);
    camera.updateMatrixWorld();

    // The hook only reads the camera; the renderer and draw group are unused.
    const renderer = null as unknown as WebGLRenderer;
    const group = null as unknown as Group;
    const geometry = layer.mesh.geometry;
    layer.mesh.onBeforeRender(renderer, new Scene(), camera, geometry, material(layer), group);

    // World +Y seen from a frame rotated +90° about X is local -Z.
    const local = material(layer).uniforms.uCameraLocal?.value as Vector3;
    expect(local.x).toBeCloseTo(0, 9);
    expect(local.y).toBeCloseTo(0, 9);
    expect(local.z).toBeCloseTo(-4, 9);
    layer.dispose();
  });
});
