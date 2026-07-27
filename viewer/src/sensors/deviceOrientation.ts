import * as THREE from "three";

export interface DeviceOrientationSample {
  altDeg: number;
  azDeg: number;
}

export function isDeviceOrientationSupported(): boolean {
  return typeof DeviceOrientationEvent !== "undefined";
}

interface RequestPermissionCapable {
  requestPermission?: () => Promise<"granted" | "denied">;
}

/** iOS 13+ gates DeviceOrientationEvent behind an explicit user-gesture permission prompt. */
export async function requestDeviceOrientationPermission(): Promise<boolean> {
  const ctor = DeviceOrientationEvent as unknown as RequestPermissionCapable;
  if (typeof ctor.requestPermission !== "function") {
    return true;
  }
  try {
    return (await ctor.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

interface CompassCapableEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
}

/**
 * Resolves a true "alpha" (rotation around Z, referenced to North, per the
 * DeviceOrientationEvent spec convention) from whichever compass reference
 * the platform actually exposes:
 * - iOS Safari: `webkitCompassHeading` (0=N, clockwise) -> alpha = 360 - heading.
 * - Chrome/Android: `deviceorientationabsolute` with absolute===true, whose
 *   `alpha` is already spec-referenced.
 * Returns null when no absolute compass reference is available yet (plain
 * relative `deviceorientation` on desktop, or before the compass settles).
 */
function resolveAlphaDeg(event: DeviceOrientationEvent): number | null {
  const iosHeading = (event as CompassCapableEvent).webkitCompassHeading;
  // iOS reports webkitCompassHeading === -1 when the compass is
  // uncalibrated/invalid (not a real 0-360 heading). Treating it as valid
  // caused alpha to snap to ~361deg (=~1deg, i.e. ~north) every time the
  // compass briefly glitched, producing large sudden jumps.
  if (typeof iosHeading === "number" && !Number.isNaN(iosHeading) && iosHeading >= 0) {
    return 360 - iosHeading;
  }
  if (event.absolute && typeof event.alpha === "number") {
    return event.alpha;
  }
  return null;
}

function screenOrientationAngleDeg(): number {
  return window.screen.orientation?.angle ?? 0;
}

const FORWARD = new THREE.Vector3(0, 0, -1);
// -90deg around X: camera looks out the back of the device, not off its top edge.
const SCREEN_TO_CAMERA = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));

/**
 * Same construction as the historical THREE.DeviceOrientationControls:
 * North = world -Z, East = world +X, Up = world +Y, in this helper's own
 * local frame (unrelated to the sky sphere's world frame - only azDeg/altDeg
 * are extracted from it below).
 */
function computeAltAz(alphaDeg: number, betaDeg: number, gammaDeg: number, screenAngleDeg: number): DeviceOrientationSample {
  const alpha = THREE.MathUtils.degToRad(alphaDeg);
  const beta = THREE.MathUtils.degToRad(betaDeg);
  const gamma = THREE.MathUtils.degToRad(gammaDeg);
  const orient = THREE.MathUtils.degToRad(screenAngleDeg);

  const euler = new THREE.Euler(beta, alpha, -gamma, "YXZ");
  const quaternion = new THREE.Quaternion().setFromEuler(euler);
  quaternion.multiply(SCREEN_TO_CAMERA);
  quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -orient));

  const forward = FORWARD.clone().applyQuaternion(quaternion);
  const azDeg = (THREE.MathUtils.radToDeg(Math.atan2(forward.x, -forward.z)) + 360) % 360;
  const altDeg = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1)));

  return { altDeg, azDeg };
}

type Listener = (sample: DeviceOrientationSample) => void;

export class DeviceOrientationTracker {
  private listener: Listener | null = null;
  private readonly handleEvent = (event: Event): void => {
    if (!this.listener) return;
    const orientationEvent = event as DeviceOrientationEvent;
    if (orientationEvent.beta === null || orientationEvent.gamma === null) return;

    const alphaDeg = resolveAlphaDeg(orientationEvent);
    if (alphaDeg === null) return;

    this.listener(computeAltAz(alphaDeg, orientationEvent.beta, orientationEvent.gamma, screenOrientationAngleDeg()));
  };

  start(listener: Listener): void {
    this.listener = listener;
    window.addEventListener("deviceorientationabsolute", this.handleEvent, true);
    window.addEventListener("deviceorientation", this.handleEvent, true);
  }

  stop(): void {
    this.listener = null;
    window.removeEventListener("deviceorientationabsolute", this.handleEvent, true);
    window.removeEventListener("deviceorientation", this.handleEvent, true);
  }
}
