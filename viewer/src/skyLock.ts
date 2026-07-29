import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createCompassRing, disposeCompassRing } from "./scene/createCompassRing";
import {
  DeviceOrientationTracker,
  isDeviceOrientationSupported,
  requestDeviceOrientationPermission,
  type DeviceOrientationDebugInfo,
  type DeviceOrientationSample,
} from "./sensors/deviceOrientation";
import { isGeolocationSupported, requestGeoPosition, type GeoPosition } from "./sensors/geolocation";
import { computeSkyDirectionQuaternion, computeSmoothingFactor } from "./skyCameraOrientation";
import { localSiderealTimeDeg } from "./astro/time";

const NO_SAMPLE_TIMEOUT_MS = 5000;
// Exponential smoothing time constant (seconds), not a fixed per-frame
// fraction: smooths out raw sensor jitter (compass/gyro noise is visible
// even holding the phone still) in a way that stays consistent regardless
// of frame rate. ~150ms settles within a few hundred ms - responsive enough
// to feel "live" while filtering out most sensor-noise-frequency jitter.
const SMOOTHING_TIME_CONSTANT_SECONDS = 0.15;

export function isSkyLockSupported(): boolean {
  return isDeviceOrientationSupported() && isGeolocationSupported();
}

export class SkyLockController {
  private readonly camera: THREE.Camera;
  private readonly controls: OrbitControls;
  private readonly scene: THREE.Scene;
  private readonly tracker = new DeviceOrientationTracker();
  private position: GeoPosition | null = null;
  private latestSample: DeviceOrientationSample | null = null;
  private noSampleTimer: number | null = null;
  private enabled = false;
  private compassRing: THREE.Group | null = null;
  // Smoothing state kept independent of camera.quaternion: OrbitControls.update()
  // (called before skyLock.update() every frame in main.ts's animate loop)
  // unconditionally re-asserts its own tracked orientation onto the camera
  // even while controls.enabled=false. Slerping camera.quaternion in place
  // would therefore always start from that stale OrbitControls pose instead
  // of last frame's actual sky-lock result, making the camera perpetually
  // snap back toward it. Slerping our own persisted quaternion and then
  // force-overwriting camera.quaternion with it (after controls.update() has
  // already run) sidesteps this.
  private readonly currentQuaternion = new THREE.Quaternion();
  /** Fired whenever `enabled` actually changes, including the internal no-sample auto-revert - lets UI stay in sync without polling. */
  onStateChange: ((enabled: boolean) => void) | null = null;
  /** Fired on every raw sensor event, including rejected ones - for an on-screen debug readout on devices without a remote debugger attached. */
  onDebugUpdate: ((info: DeviceOrientationDebugInfo) => void) | null = null;

  constructor(camera: THREE.Camera, controls: OrbitControls, scene: THREE.Scene) {
    this.camera = camera;
    this.controls = controls;
    this.scene = scene;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Requests geolocation + device-orientation permission; returns false if either is denied/unavailable. */
  async enable(): Promise<boolean> {
    const [orientationGranted, position] = await Promise.all([
      requestDeviceOrientationPermission(),
      requestGeoPosition().catch(() => null),
    ]);

    if (!orientationGranted || !position) {
      return false;
    }

    this.position = position;
    this.latestSample = null;
    this.controls.enabled = false;
    this.enabled = true;
    this.currentQuaternion.copy(this.camera.quaternion);
    this.onStateChange?.(true);

    // Debug overlay: ground-truth N/E/S/W/zenith markers computed via the
    // same astro pipeline used for the live camera direction, to help tell
    // apart a sensor-side bug from a coordinate-math bug (see
    // scene/createCompassRing.ts doc comment).
    const lstDeg = localSiderealTimeDeg(new Date(), position.longitudeDeg);
    this.compassRing = createCompassRing({ latDeg: position.latitudeDeg, lstDeg });
    this.scene.add(this.compassRing);

    this.tracker.start(
      (sample) => {
        this.latestSample = sample;
        if (this.noSampleTimer !== null) {
          window.clearTimeout(this.noSampleTimer);
          this.noSampleTimer = null;
        }
      },
      (info) => this.onDebugUpdate?.(info),
    );

    // Some desktop browsers expose the DeviceOrientationEvent API but never
    // fire it (no real sensor) - bail back to free-look if nothing arrives.
    this.noSampleTimer = window.setTimeout(() => {
      if (!this.latestSample) {
        console.warn("[sky-lock] no orientation data received; reverting to free look");
        this.disable();
      }
    }, NO_SAMPLE_TIMEOUT_MS);

    return true;
  }

  disable(): void {
    const wasEnabled = this.enabled;
    this.tracker.stop();
    if (this.noSampleTimer !== null) {
      window.clearTimeout(this.noSampleTimer);
      this.noSampleTimer = null;
    }
    this.latestSample = null;
    this.position = null;
    this.controls.enabled = true;
    this.enabled = false;
    if (this.compassRing) {
      this.scene.remove(this.compassRing);
      disposeCompassRing(this.compassRing);
      this.compassRing = null;
    }
    if (wasEnabled) {
      this.onStateChange?.(false);
    }
  }

  /** Call once per animation frame with the elapsed seconds since the last call; no-op until enabled and the first sensor sample arrives. */
  update(deltaSeconds: number): void {
    if (!this.enabled || !this.latestSample || !this.position) {
      return;
    }

    const target = computeSkyDirectionQuaternion(this.latestSample, this.position, new Date());
    const smoothing = computeSmoothingFactor(deltaSeconds, SMOOTHING_TIME_CONSTANT_SECONDS);
    this.currentQuaternion.slerp(target, smoothing);
    // Force-overwrite: must run after controls.update() (see field comment
    // on currentQuaternion above) to win the fight over camera.quaternion.
    this.camera.quaternion.copy(this.currentQuaternion);
  }
}
