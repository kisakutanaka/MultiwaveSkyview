import * as THREE from "three";
import { altAzToEquatorial, equatorialToGalactic } from "./astro/coords";
import { galacticToWorldDirection } from "./astro/galacticToDirection";
import { localSiderealTimeDeg } from "./astro/time";
import type { DeviceOrientationSample } from "./sensors/deviceOrientation";
import type { GeoPosition } from "./sensors/geolocation";

const target = new THREE.Camera();

/**
 * Computes the world-space orientation the camera should have to look at the
 * real sky point corresponding to `sample` (device-reported alt/az), for an
 * observer at `position` and `date`. Pure and stateless - `SkyLockController`
 * owns smoothing and applying the result to the live camera; this is kept
 * separate so it's unit-testable without mocking THREE.Camera/OrbitControls/
 * DOM sensors (see skyCameraOrientation.test.ts).
 *
 * Two easy-to-get-wrong choices baked in here, both found the hard way
 * (see docs/sky-lock-debug-plan.md):
 *
 * 1. The lookAt() proxy MUST be a THREE.Camera, not a plain Object3D.
 *    Object3D.prototype.lookAt() special-cases `this.isCamera` and swaps the
 *    eye/target argument order for non-camera objects (three/src/core/
 *    Object3D.js), producing a quaternion rotated 180deg from what
 *    Camera.lookAt() gives for the same inputs.
 * 2. The `up` reference must be a FIXED, far-away point (the true zenith),
 *    not a hint tracking a few degrees off `direction`. lookAt()'s internal
 *    `up x forward` cross product is numerically stable when the two
 *    vectors are far apart and unstable when nearly parallel; a
 *    direction-tracking hint keeps them nearly parallel at every altitude
 *    (unstable everywhere), whereas the fixed zenith is only nearly
 *    parallel to `direction` very close to the zenith itself (an
 *    unavoidable singularity shared by any az/alt sky viewer).
 */
export function computeSkyDirectionQuaternion(
  sample: DeviceOrientationSample,
  position: GeoPosition,
  date: Date,
): THREE.Quaternion {
  const lstDeg = localSiderealTimeDeg(date, position.longitudeDeg);

  const equatorial = altAzToEquatorial(sample, position.latitudeDeg, lstDeg);
  const galactic = equatorialToGalactic(equatorial);
  const direction = galacticToWorldDirection(galactic.lDeg, galactic.bDeg);

  const zenithEquatorial = altAzToEquatorial({ altDeg: 90, azDeg: 0 }, position.latitudeDeg, lstDeg);
  const zenithGalactic = equatorialToGalactic(zenithEquatorial);
  const worldZenith = galacticToWorldDirection(zenithGalactic.lDeg, zenithGalactic.bDeg);

  target.position.set(0, 0, 0);
  target.up.copy(worldZenith);
  target.lookAt(direction);
  return target.quaternion.clone();
}

/**
 * Frame-rate-independent smoothing factor for slerping toward a new target
 * this frame, given the elapsed time and a desired exponential time
 * constant (both in seconds). Replaces a fixed "20% per frame" factor,
 * which implicitly assumed ~60fps: at a lower/uneven frame rate the same
 * fixed fraction closes a larger/inconsistent fraction of the gap per
 * elapsed second, so smoothing strength drifted with frame rate instead of
 * staying constant - contributing to visible jitter passed through from
 * noisy raw compass/gyro readings.
 */
export function computeSmoothingFactor(deltaSeconds: number, timeConstantSeconds: number): number {
  return 1 - Math.exp(-Math.max(deltaSeconds, 0) / timeConstantSeconds);
}
