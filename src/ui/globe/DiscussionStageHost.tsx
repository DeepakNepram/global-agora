import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';

import {
  applyShot,
  earthTiltQuaternion,
  orbitShot,
  planShotMove,
  poseShot,
  shotDistanceKm,
  shotTransform,
  type OrbitGlobeControls,
  type ShotMove,
  type ShotPose,
  type ShotTransform,
} from '@/globe';
import { discussionStageStore, monotonicNowMs, type CameraMove } from '@/state';

import { cameraFraction, lensShiftFor, segmentAt, stageLayout } from '../discussion/stageMotion';

/**
 * After the orbit controls (−1), which still write the saved pose every
 * frame, and before scene updates (0): the frame is drawn from the shot.
 */
const SHOT_PRIORITY = -0.5;

export interface DiscussionStageHostProps {
  readonly controls: OrbitGlobeControls | null;
}

interface ShotState {
  active: boolean;
  /** The leg being flown, and the stage move it was planned for. */
  move: ShotMove | null;
  plannedFor: CameraMove | null;
  /** The pose last drawn: where a new leg starts, even mid-flight. */
  last: ShotPose | null;
}

/**
 * The camera behind the discussion panel (Prompt 4.5), inside <Canvas>.
 * Entering flies from the saved pose down to the story's city and tilts
 * into a slow orbit; leaving flies back from wherever it is, and once the
 * stage has closed the controls take the camera back at exactly the saved
 * pose. The lens shift follows the panel. Under reduced motion the camera
 * never moves: the globe only recedes.
 */
export function DiscussionStageHost({ controls }: DiscussionStageHostProps): null {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const body = useMemo(() => earthTiltQuaternion(), []);
  const transform = useMemo<ShotTransform>(
    () => ({ position: new Vector3(), quaternion: new Quaternion() }),
    [],
  );
  const shot = useRef<ShotState>({ active: false, move: null, plannedFor: null, last: null });

  // Every change of stage asks for a frame; motion then keeps asking.
  useEffect(() => discussionStageStore.subscribe(() => invalidate()), [invalidate]);

  useFrame(() => {
    const stage = discussionStageStore.getState();
    const s = shot.current;
    if (!(camera instanceof PerspectiveCamera)) return;

    // No saved pose: the discussion opened from the list or the flat map,
    // and the camera takes no part (Prompt 5.1).
    const saved = stage.target?.savedPose ?? null;
    if (stage.phase === 'closed' || stage.target === null || saved === null) {
      if (!s.active) return;
      // Handed back: no lens shift, and the controls' exact saved pose.
      s.active = false;
      s.move = null;
      s.plannedFor = null;
      s.last = null;
      camera.clearViewOffset();
      if (saved) controls?.setState(saved);
      invalidate();
      return;
    }

    s.active = true;
    const now = monotonicNowMs();
    const layout = stageLayout(stage.width, stage.height);
    const shift = lensShiftFor(segmentAt(stage.panel, now), layout);
    if (stage.reducedMotion) {
      // The camera stays where it was; only the framing moves the globe out
      // from behind the panel, which is not motion: it lands at once.
      camera.setViewOffset(shift.width, shift.height, shift.x, shift.y, shift.width, shift.height);
      return;
    }

    const { target } = stage;
    const distanceKm = shotDistanceKm(saved.altitudeKm);
    let pose: ShotPose;
    if (stage.camera) {
      if (s.plannedFor !== stage.camera || s.move === null) {
        const to =
          stage.camera.direction === 'in' ? orbitShot(target.city, distanceKm, 0) : poseShot(saved);
        s.move = planShotMove(s.last ?? poseShot(saved), to, controls?.getLimits().maxKm ?? 0);
        s.plannedFor = stage.camera;
      }
      pose = s.move.sample(cameraFraction(stage.camera, now));
    } else if (stage.orbitFromMs !== null) {
      pose = orbitShot(target.city, distanceKm, (now - stage.orbitFromMs) / 1000);
    } else {
      pose = s.last ?? poseShot(saved);
    }
    s.last = pose;

    applyShot(camera, shotTransform(pose, body, transform), pose.distanceKm, shift);
    // A leg, a drag or the orbit is always moving; the governor caps it at rest.
    invalidate();
  }, SHOT_PRIORITY);

  return null;
}
