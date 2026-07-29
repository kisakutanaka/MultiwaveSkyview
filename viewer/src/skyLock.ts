import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { equatorialToGalactic, altAzToEquatorial } from "./astro/coords";
import { galacticToWorldDirection } from "./astro/galacticToDirection";
import { localSiderealTimeDeg } from "./astro/time";
import { createCompassRing, disposeCompassRing } from "./scene/createCompassRing";
import {
  DeviceOrientationTracker,
  isDeviceOrientationSupported,
  requestDeviceOrientationPermission,
  type DeviceOrientationDebugInfo,
  type DeviceOrientationSample,
} from "./sensors/deviceOrientation";
import { isGeolocationSupported, requestGeoPosition, type GeoPosition } from "./sensors/geolocation";

const NO_SAMPLE_TIMEOUT_MS = 5000;
// Fraction of the remaining angular gap closed per frame: smooths out raw
// sensor jitter (most visible when the phone is held near-vertical, i.e.
// beta ~ 90deg, which is the natural "hold it up like a window" pose for
// this app - exactly where this style of Euler-angle orientation math is
// most prone to noisy readings) instead of snapping the camera every frame.
const SMOOTHING_FACTOR = 0.2;

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
  private readonly targetObject = new THREE.Object3D();
  private compassRing: THREE.Group | null = null;
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

  /** Call once per animation frame; no-op until enabled and the first sensor sample arrives. */
  update(): void {
    if (!this.enabled || !this.latestSample || !this.position) {
      return;
    }

    const lstDeg = localSiderealTimeDeg(new Date(), this.position.longitudeDeg);
    const equatorial = altAzToEquatorial(this.latestSample, this.position.latitudeDeg, lstDeg);
    const galactic = equatorialToGalactic(equatorial);
    const direction = galacticToWorldDirection(galactic.lDeg, galactic.bDeg);

    this.targetObject.position.copy(this.camera.position);
    this.targetObject.up.copy(this.camera.up);
    this.targetObject.lookAt(direction);
    this.camera.quaternion.slerp(this.targetObject.quaternion, SMOOTHING_FACTOR);
  }
}
