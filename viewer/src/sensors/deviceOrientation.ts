import * as THREE from "three";
import { circularDeltaDeg, createOutlierFilterState, filterOutlier, type OutlierFilterState } from "./outlierFilter";

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

function hasValidIosHeading(event: DeviceOrientationEvent): boolean {
  const iosHeading = (event as CompassCapableEvent).webkitCompassHeading;
  // iOS reports webkitCompassHeading === -1 when the compass is
  // uncalibrated/invalid (not a real 0-360 heading).
  return typeof iosHeading === "number" && !Number.isNaN(iosHeading) && iosHeading >= 0;
}

/**
 * Resolves the RAW alpha (Z/yaw Euler component) directly from
 * `event.alpha`, so it stays mutually self-consistent with this same
 * event's beta/gamma - all three are decomposed from one instant's fused
 * device attitude, so their relationship (needed by computeAltAz's YXZ
 * Euler->quaternion composition) can't go out of sync.
 *
 * This alpha is NOT north-referenced on iOS (Safari's `deviceorientation`
 * always reports `absolute: false` and has an arbitrary zero point) - true
 * north alignment is handled separately as a calibrated offset, see
 * DeviceOrientationTracker's northOffsetDeg. Previously this function
 * substituted `360 - event.webkitCompassHeading` in place of alpha
 * directly; that broke the (alpha,beta,gamma) self-consistency whenever
 * WebKit's own internal beta/gamma (used to compute webkitCompassHeading)
 * didn't match this event's literal alpha 1:1, which produced a real,
 * persistent azDeg error (confirmed: an exact 180deg flip crossing
 * altDeg=45, not noise) - see docs/sky-lock-debug-plan.md.
 *
 * Returns null when no north reference is available at all yet (desktop's
 * plain relative `deviceorientation`, or before the iOS compass settles) -
 * same rejection condition as before, just without folding the heading
 * value into alpha.
 */
function resolveAlphaDeg(event: DeviceOrientationEvent): number | null {
  if (typeof event.alpha !== "number" || Number.isNaN(event.alpha)) {
    return null;
  }
  if (event.absolute || hasValidIosHeading(event)) {
    return event.alpha;
  }
  return null;
}

function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
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
  screenAngleDeg: number;
  northOffsetDeg: number | null;
  rawSample: DeviceOrientationSample | null;
  sample: DeviceOrientationSample | null;
}

type DebugListener = (info: DeviceOrientationDebugInfo) => void;

// How many early webkitCompassHeading samples to average (circular mean)
// into the one-time north-offset calibration. Confirmed on-device:
// webkitCompassHeading itself (not our math) can jump ~150-180deg at
// certain device attitudes (e.g. altDeg crossing 45) while the exposed
// alpha/beta/gamma stay smooth - so it can't be trusted continuously
// per-event. Averaging a handful of samples taken right at start() (when
// the phone is presumably held in a normal, non-glitchy pose) gives a
// single stable offset without ever re-touching it mid-session, the same
// "capture once, freeze for the session" approach that fixed the
// screenAngleDeg issue.
const NORTH_OFFSET_CALIBRATION_SAMPLES = 5;

function circularMeanDeg(samplesDeg: number[]): number {
  let sumX = 0;
  let sumY = 0;
  for (const deg of samplesDeg) {
    const rad = THREE.MathUtils.degToRad(deg);
    sumX += Math.cos(rad);
    sumY += Math.sin(rad);
  }
  return normalizeDeg(THREE.MathUtils.radToDeg(Math.atan2(sumY, sumX)));
}

export class DeviceOrientationTracker {
  private listener: Listener | null = null;
  private debugListener: DebugListener | null = null;
  // iOS-only true-north calibration for the raw (arbitrary-zero) alpha - see
  // resolveAlphaDeg's doc comment. Rotating alpha by any delta rotates the
  // whole composed quaternion (and therefore azDeg) by that exact same
  // delta regardless of beta/gamma, because alpha is the outermost/world-Y
  // term in the "YXZ" Euler composition - so a single offset sampled at any
  // well-conditioned instant stays valid at any later beta/gamma. Collected
  // from the first few events in start() and then frozen - see
  // NORTH_OFFSET_CALIBRATION_SAMPLES above for why this isn't updated
  // continuously. Reset on every start() so a stale offset from a previous
  // session doesn't carry over.
  private northOffsetDeg: number | null = null;
  private northOffsetCalibrationSamples: number[] = [];
  // Rate-limits the resolved azimuth (see outlierFilter.ts) - altitude is
  // driven fairly directly by beta and stays smooth even through the
  // gimbal-lock zone near beta=90deg (altDeg near 0), but azimuth depends
  // on the alpha/gamma split, which is what actually goes unstable there.
  // Reset on every start() so a stale heading from a previous session
  // doesn't get compared against.
  private headingFilterState: OutlierFilterState = createOutlierFilterState();
  // Captured once per start(), NOT re-read every event: window.screen.
  // orientation.angle is a discrete 0/90/180/270 "which way is the UI
  // rotated" value, and the OS's accelerometer-based auto-rotate decision
  // that drives it can flip unexpectedly (e.g. 0 -> 180) purely from
  // tilting the phone back to look at high altitude - no actual landscape/
  // portrait rotation happened, but the sudden step in this correction
  // term still shows up as a real, instantaneous ~180deg azimuth flip
  // downstream (confirmed: alpha/beta/gamma stay smooth through the same
  // moment). This app is used in a fixed grip pointed at the sky, so
  // treating screen orientation as fixed for the session's duration is a
  // safe assumption and sidesteps the issue entirely.
  private screenAngleDeg = 0;
  private readonly handleEvent = (event: Event): void => {
    const orientationEvent = event as DeviceOrientationEvent;
    const iosHeading = (orientationEvent as CompassCapableEvent).webkitCompassHeading;
    const alphaDeg = resolveAlphaDeg(orientationEvent);
    const rawSample =
      alphaDeg !== null && orientationEvent.beta !== null && orientationEvent.gamma !== null
        ? computeAltAz(alphaDeg, orientationEvent.beta, orientationEvent.gamma, this.screenAngleDeg)
        : null;

    if (this.northOffsetDeg === null) {
      if (orientationEvent.absolute) {
        // deviceorientationabsolute's alpha is already north-referenced by
        // spec - no calibration needed.
        this.northOffsetDeg = 0;
      } else if (rawSample !== null && orientationEvent.beta !== null && orientationEvent.gamma !== null && hasValidIosHeading(orientationEvent)) {
        const targetAzDeg = computeAltAz(360 - (iosHeading as number), orientationEvent.beta, orientationEvent.gamma, this.screenAngleDeg).azDeg;
        this.northOffsetCalibrationSamples.push(circularDeltaDeg(targetAzDeg, rawSample.azDeg));
        if (this.northOffsetCalibrationSamples.length >= NORTH_OFFSET_CALIBRATION_SAMPLES) {
          this.northOffsetDeg = circularMeanDeg(this.northOffsetCalibrationSamples);
        }
      }
    }

    const calibratedAzDeg = rawSample !== null && this.northOffsetDeg !== null ? normalizeDeg(rawSample.azDeg + this.northOffsetDeg) : null;
    const sample =
      rawSample !== null && calibratedAzDeg !== null
        ? {
            altDeg: rawSample.altDeg,
            azDeg: normalizeDeg(filterOutlier(this.headingFilterState, calibratedAzDeg, circularDeltaDeg)),
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
      screenAngleDeg: this.screenAngleDeg,
      northOffsetDeg: this.northOffsetDeg,
      rawSample,
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
    this.screenAngleDeg = screenOrientationAngleDeg();
    this.northOffsetDeg = null;
    this.northOffsetCalibrationSamples = [];
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
