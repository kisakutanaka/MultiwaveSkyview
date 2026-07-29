import * as THREE from "three";
import {
  circularDeltaDeg,
  createOutlierFilterState,
  filterOutlier,
  linearDeltaDeg,
  type OutlierFilterState,
} from "./outlierFilter";

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

/** Raw per-event diagnostics, reported even when the event is rejected (no usable sample) - lets on-screen debug UI show *why* sky-lock isn't tracking on a real device without needing a remote debugger attached. */
export interface DeviceOrientationDebugInfo {
  eventType: string;
  alphaRaw: number | null;
  betaRaw: number | null;
  gammaRaw: number | null;
  absolute: boolean;
  webkitCompassHeading: number | null;
  resolvedAlphaDeg: number | null;
  sample: DeviceOrientationSample | null;
}

type DebugListener = (info: DeviceOrientationDebugInfo) => void;

export class DeviceOrientationTracker {
  private listener: Listener | null = null;
  private debugListener: DebugListener | null = null;
  // Rejects transient outliers in the resolved az/alt (see outlierFilter.ts)
  // - magnetometer glitches near metal/electronics (azimuth), and the
  // gimbal-lock-driven alpha/gamma noise that happens near the horizon
  // (altDeg near 0, i.e. the phone held near-vertical) regardless of which
  // way it's pointed. Reset on every start() so a stale reading from a
  // previous session doesn't get compared against.
  private headingFilterState: OutlierFilterState = createOutlierFilterState();
  private altitudeFilterState: OutlierFilterState = createOutlierFilterState();
  private readonly handleEvent = (event: Event): void => {
    const orientationEvent = event as DeviceOrientationEvent;
    const iosHeading = (orientationEvent as CompassCapableEvent).webkitCompassHeading;
    const alphaDeg = resolveAlphaDeg(orientationEvent);
    const rawSample =
      alphaDeg !== null && orientationEvent.beta !== null && orientationEvent.gamma !== null
        ? computeAltAz(alphaDeg, orientationEvent.beta, orientationEvent.gamma, screenOrientationAngleDeg())
        : null;
    const sample = rawSample
      ? {
          altDeg: filterOutlier(this.altitudeFilterState, rawSample.altDeg, linearDeltaDeg),
          azDeg: filterOutlier(this.headingFilterState, rawSample.azDeg, circularDeltaDeg),
        }
      : null;

    this.debugListener?.({
      eventType: event.type,
      alphaRaw: orientationEvent.alpha,
      betaRaw: orientationEvent.beta,
      gammaRaw: orientationEvent.gamma,
      absolute: orientationEvent.absolute,
      webkitCompassHeading: typeof iosHeading === "number" ? iosHeading : null,
      resolvedAlphaDeg: alphaDeg,
      sample,
    });

    if (sample) {
      this.listener?.(sample);
    }
  };

  start(listener: Listener, debugListener?: DebugListener): void {
    this.listener = listener;
    this.debugListener = debugListener ?? null;
    this.headingFilterState = createOutlierFilterState();
    this.altitudeFilterState = createOutlierFilterState();
    window.addEventListener("deviceorientationabsolute", this.handleEvent, true);
    window.addEventListener("deviceorientation", this.handleEvent, true);
  }

  stop(): void {
    this.listener = null;
    this.debugListener = null;
    window.removeEventListener("deviceorientationabsolute", this.handleEvent, true);
    window.removeEventListener("deviceorientation", this.handleEvent, true);
  }
}
