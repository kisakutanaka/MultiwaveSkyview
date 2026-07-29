import * as THREE from "three";
import { localSiderealTimeDeg } from "../astro/time";
import { createCompassRing, disposeCompassRing } from "../scene/createCompassRing";
import { isGeolocationSupported, requestGeoPosition } from "../sensors/geolocation";

/**
 * Shows the N/E/S/W/zenith compass ring WITHOUT engaging sky-lock's camera
 * automation (OrbitControls stays enabled) - isolates "is the ring itself
 * (AltAz->Equatorial->Galactic->world-direction) placed correctly" from
 * "does the camera correctly follow the sensor" (skyLock.ts's separate,
 * still-unverified quaternion application step). Use together with
 * headingCheckPanel.ts: drag-look at the ring's "N" label and check whether
 * the phone's real compass heading (shown there) actually reads ~0deg.
 */
export function createRingCheckButton(scene: THREE.Scene): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = "ring-check-button";
  button.type = "button";
  button.textContent = "コンパスリング表示(自由視点)";

  if (!isGeolocationSupported()) {
    button.classList.add("hidden");
    return button;
  }

  let ring: THREE.Group | null = null;

  button.addEventListener("click", () => {
    void (async () => {
      if (ring) {
        scene.remove(ring);
        disposeCompassRing(ring);
        ring = null;
        button.textContent = "コンパスリング表示(自由視点)";
        return;
      }

      button.disabled = true;
      try {
        const position = await requestGeoPosition();
        const lstDeg = localSiderealTimeDeg(new Date(), position.longitudeDeg);
        ring = createCompassRing({ latDeg: position.latitudeDeg, lstDeg });
        scene.add(ring);
        button.textContent = "コンパスリング非表示";
      } catch (err) {
        console.warn("[ring-check] geolocation failed", err);
      } finally {
        button.disabled = false;
      }
    })();
  });

  return button;
}
