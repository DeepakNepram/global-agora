import { Quaternion, Vector3, type PerspectiveCamera } from 'three';

import { GLOBE_RADIUS, degToRad, kmToWorld, vec3ToLatLon, type LatLon } from '@/core';

import * as scale from './cameraMath';
import * as orient from './orientation';

export const MAX_LAT_RAD = degToRad(scale.MAX_LATITUDE_DEG);

/**
 * The camera's pose and everything derived from it: world placement, clip
 * planes, finger deltas to rotation, and pixel rays. The controls decide *when*
 * the pose changes; the rig decides *what* a change means geometrically.
 *
 * World pose = body (axial tilt) * q, with the camera at distance 1 + altitude
 * along the rig's +Z. No lookAt: the orientation already is the camera's.
 */
export interface CameraRig {
  altitudeKm: number;
  readonly width: number;
  readonly height: number;
  readonly aspect: number;
  setViewport(widthPx: number, heightPx: number): void;
  clampAltitude(km: number): number;
  /** Writes the pose to the three camera. */
  apply(): void;
  /** Rotates by a finger delta in screen heights. True if pitch hit the clamp. */
  turnByScreen(sx: number, sy: number): boolean;
  /** Remembers the surface point under a pixel; false over space. */
  setAnchor(x: number, y: number): boolean;
  /** Moves the remembered pixel without re-picking the point (pinch midpoint). */
  moveAnchor(x: number, y: number): void;
  clearAnchor(): void;
  /** Re-aims so the anchored point is under its pixel again. */
  holdAnchor(): void;
  place(pose: scale.CameraPose): void;
  /** North-up view of a centre direction (flights). */
  lookDown(centre: Vector3): void;
  pose(): scale.CameraPose;
  pointAt(x: number, y: number): LatLon | null;
}

export function createCameraRig(camera: PerspectiveCamera, body: Quaternion): CameraRig {
  const q = new Quaternion();
  const anchor = new Vector3();
  const scratch = new Vector3();
  const view = { tanHalfFov: Math.tan(degToRad(camera.fov) / 2), aspect: 1 };
  let width = 1;
  let height = 1;
  let anchored = false;
  let anchorX = 0;
  let anchorY = 0;
  let appliedAltitudeKm = -1;

  const distance = (): number => GLOBE_RADIUS + kmToWorld(rig.altitudeKm);
  const ndcX = (x: number): number => (x / width) * 2 - 1;
  const ndcY = (y: number): number => 1 - (y / height) * 2;

  const rig: CameraRig = {
    altitudeKm: scale.fitAltitudeKm(1),

    get width() {
      return width;
    },
    get height() {
      return height;
    },
    get aspect() {
      return view.aspect;
    },

    setViewport(widthPx, heightPx) {
      width = Math.max(1, widthPx);
      height = Math.max(1, heightPx);
      view.aspect = width / height;
      view.tanHalfFov = Math.tan(degToRad(camera.fov) / 2);
    },

    clampAltitude: (km) => scale.clampAltitudeKm(km, view.aspect),

    apply() {
      camera.quaternion.copy(body).multiply(q);
      camera.position.set(0, 0, distance()).applyQuaternion(camera.quaternion);
      if (rig.altitudeKm !== appliedAltitudeKm) {
        const planes = scale.clipPlanes(rig.altitudeKm);
        camera.near = planes.near;
        camera.far = planes.far;
        camera.updateProjectionMatrix();
        appliedAltitudeKm = rig.altitudeKm;
      }
      camera.updateMatrixWorld();
    },

    turnByScreen(sx, sy) {
      const rad = scale.radiansPerScreenHeight(rig.altitudeKm, camera.fov);
      // Finger right drags the ground east, so the camera heads west: negative yaw.
      const yaw = -sx * rad * scale.yawCompensation(orient.latitudeOf(q));
      const pitch = sy * rad;
      return Math.abs(orient.rotateYawPitch(q, yaw, pitch, MAX_LAT_RAD) - pitch) > 1e-12;
    },

    setAnchor(x, y) {
      anchorX = x;
      anchorY = y;
      anchored = orient.rayHitUnitSphere(q, distance(), ndcX(x), ndcY(y), view, anchor);
      return anchored;
    },

    moveAnchor(x, y) {
      anchorX = x;
      anchorY = y;
    },

    clearAnchor() {
      anchored = false;
    },

    holdAnchor() {
      if (!anchored) return;
      const nx = ndcX(anchorX);
      const ny = ndcY(anchorY);
      orient.keepPointUnderRay(q, distance(), nx, ny, view, anchor, MAX_LAT_RAD);
    },

    place(pose) {
      const lat = Math.min(scale.MAX_LATITUDE_DEG, Math.max(-scale.MAX_LATITUDE_DEG, pose.lat));
      orient.orientationFor({ lat, lon: pose.lon }, q);
      rig.altitudeKm = rig.clampAltitude(pose.altitudeKm);
    },

    lookDown(centre) {
      orient.orientationForDirection(centre, MAX_LAT_RAD, q);
    },

    pose() {
      const centre = vec3ToLatLon(orient.centreOf(q, scratch));
      return { lat: centre.lat, lon: centre.lon, altitudeKm: rig.altitudeKm };
    },

    pointAt(x, y) {
      const hit = orient.rayHitUnitSphere(q, distance(), ndcX(x), ndcY(y), view, scratch);
      return hit ? vec3ToLatLon(scratch) : null;
    },
  };

  return rig;
}
