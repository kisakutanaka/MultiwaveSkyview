// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DeviceOrientationTracker, type DeviceOrientationSample } from "./deviceOrientation";
import { circularDeltaDeg } from "./outlierFilter";

function dispatchDeviceOrientation(alpha: number, beta: number, gamma: number): void {
  const event = new Event("deviceorientation") as DeviceOrientationEvent;
  Object.defineProperties(event, {
    alpha: { value: alpha, configurable: true },
    beta: { value: beta, configurable: true },
    gamma: { value: gamma, configurable: true },
    absolute: { value: true, configurable: true },
  });
  window.dispatchEvent(event);
}

/** Simulates iOS Safari's non-absolute deviceorientation + webkitCompassHeading. */
function dispatchIosDeviceOrientation(alpha: number, beta: number, gamma: number, webkitCompassHeading: number): void {
  const event = new Event("deviceorientation") as DeviceOrientationEvent;
  Object.defineProperties(event, {
    alpha: { value: alpha, configurable: true },
    beta: { value: beta, configurable: true },
    gamma: { value: gamma, configurable: true },
    absolute: { value: false, configurable: true },
    webkitCompassHeading: { value: webkitCompassHeading, configurable: true },
  });
  window.dispatchEvent(event);
}

function setScreenOrientationAngle(angle: number): { angle: number } {
  const screenOrientation = { angle };
  Object.defineProperty(window.screen, "orientation", { configurable: true, value: screenOrientation });
  return screenOrientation;
}

describe("DeviceOrientationTracker", () => {
  it(
    "holds screen.orientation.angle fixed for the session (captured once at start()) - regression guard for a real-device bug where azDeg flipped exactly 180deg crossing altDeg=45 while alpha/beta/gamma stayed smooth. Root cause: window.screen.orientation.angle (a discrete UI-rotation value) was re-read every event, and the OS's accelerometer-based auto-rotate decision can flip it (e.g. 0->180) purely from tilting the phone back to a steep altitude - no actual landscape/portrait rotation occurred, but the sudden correction-term step still flipped the computed azDeg.",
    () => {
      // Reference tracker: screen angle never changes, for comparison.
      setScreenOrientationAngle(0);
      const reference = new DeviceOrientationTracker();
      const referenceSamples: DeviceOrientationSample[] = [];
      reference.start((sample) => referenceSamples.push(sample));
      for (let i = 0; i < 20; i++) {
        dispatchDeviceOrientation(200, 45, 5);
      }
      reference.stop();
      const referenceAz = referenceSamples.at(-1)!.azDeg;

      // Test tracker: screen angle flips 0 -> 180 mid-session (simulating
      // the OS auto-rotate quirk), same alpha/beta/gamma throughout.
      const screenOrientation = setScreenOrientationAngle(0);
      const tracker = new DeviceOrientationTracker();
      const samples: DeviceOrientationSample[] = [];
      tracker.start((sample) => samples.push(sample));

      dispatchDeviceOrientation(200, 45, 5);
      screenOrientation.angle = 180;
      // Enough events for the azimuth rate limiter to fully converge to
      // whatever computeAltAz() is actually producing, so this test
      // reflects the underlying computation rather than being masked by
      // the limiter's per-event cap.
      for (let i = 0; i < 20; i++) {
        dispatchDeviceOrientation(200, 45, 5);
      }
      tracker.stop();
      const flippedSessionAz = samples.at(-1)!.azDeg;

      expect(Math.abs(flippedSessionAz - referenceAz)).toBeLessThan(5);
    },
  );

  it(
    "ignores a mid-session webkitCompassHeading glitch once north-offset calibration has settled - regression guard for a confirmed real-device bug where webkitCompassHeading itself (not alpha/beta/gamma, and not our math) jumped ~150-180deg crossing altDeg=45. Root cause: resolveAlphaDeg() used to substitute `360 - webkitCompassHeading` directly as alpha every event, so a WebKit-internal heading glitch fed straight into the Euler composition as a fake attitude change. Fix: alpha is now always the raw, self-consistent event.alpha; webkitCompassHeading is only used to calibrate a one-time northOffsetDeg from the first few events, then frozen for the session (see deviceOrientation.ts).",
    () => {
      setScreenOrientationAngle(0);
      const tracker = new DeviceOrientationTracker();
      const samples: DeviceOrientationSample[] = [];
      tracker.start((sample) => samples.push(sample));

      // Calibration phase: consistent heading, lets northOffsetDeg settle.
      for (let i = 0; i < 6; i++) {
        dispatchIosDeviceOrientation(200, 80, 5, 160);
      }
      const preGlitchAz = samples.at(-1)!.azDeg;

      // Glitch phase: alpha/beta/gamma stay exactly the same (the raw
      // attitude did not change), but webkitCompassHeading jumps ~170deg,
      // as confirmed happening on-device.
      for (let i = 0; i < 10; i++) {
        dispatchIosDeviceOrientation(200, 80, 5, 330);
      }
      tracker.stop();
      const postGlitchAz = samples.at(-1)!.azDeg;

      expect(Math.abs(circularDeltaDeg(postGlitchAz, preGlitchAz))).toBeLessThan(5);
    },
  );
});
