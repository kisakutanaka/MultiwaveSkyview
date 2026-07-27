import * as THREE from "three";
import { altAzToEquatorial, equatorialToGalactic, type AltAz } from "../astro/coords";
import { galacticToWorldDirection } from "../astro/galacticToDirection";

const RING_RADIUS = 495;
const LABEL_RADIUS = 480;
const RING_STEPS = 180;

export interface CompassRingOptions {
  latDeg: number;
  lstDeg: number;
}

function directionForAltAz(altDeg: number, azDeg: number, opts: CompassRingOptions): THREE.Vector3 {
  const altAz: AltAz = { altDeg, azDeg };
  const equatorial = altAzToEquatorial(altAz, opts.latDeg, opts.lstDeg);
  const galactic = equatorialToGalactic(equatorial);
  return galacticToWorldDirection(galactic.lDeg, galactic.bDeg);
}

function createLabelSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = color;
    ctx.font = "bold 96px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 64, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  // depthTest off so the marker stays visible in front of the sky sphere
  // regardless of camera direction, like a 3D-editor rotation gizmo overlay.
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(40, 40, 1);
  sprite.renderOrder = 999;
  return sprite;
}

/**
 * Debug overlay: renders the true horizon ring (alt=0), N/E/S/W + zenith
 * markers at the observer's current lat/LST, using the exact same
 * AltAz -> Equatorial -> Galactic -> world-direction pipeline the live
 * sky-lock camera uses (astro/coords.ts, astro/galacticToDirection.ts).
 *
 * Diagnostic use: if the camera doesn't point at "N" while the phone is
 * physically pointed north, the bug is upstream in sensor -> AltAz
 * (sensors/deviceOrientation.ts). If this ring itself drifts/jitters
 * relative to the sky texture, the bug is in the astro/galactic-direction
 * math instead - since the ring recomputation and the camera direction
 * recomputation are independent uses of the same downstream functions.
 */
export function createCompassRing(opts: CompassRingOptions): THREE.Group {
  const group = new THREE.Group();
  group.name = "compass-ring-debug";

  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= RING_STEPS; i++) {
    const az = (360 * i) / RING_STEPS;
    points.push(directionForAltAz(0, az, opts).multiplyScalar(RING_RADIUS));
  }
  const ringGeometry = new THREE.BufferGeometry().setFromPoints(points);
  const ringMaterial = new THREE.LineBasicMaterial({ color: 0x00ff88, depthTest: false, transparent: true });
  const ring = new THREE.LineLoop(ringGeometry, ringMaterial);
  ring.renderOrder = 998;
  group.add(ring);

  const cardinals: Array<[string, number, string]> = [
    ["N", 0, "#ff4444"],
    ["E", 90, "#55ff55"],
    ["S", 180, "#5599ff"],
    ["W", 270, "#ffdd44"],
  ];
  for (const [label, az, color] of cardinals) {
    const sprite = createLabelSprite(label, color);
    sprite.position.copy(directionForAltAz(0, az, opts).multiplyScalar(LABEL_RADIUS));
    group.add(sprite);
  }

  const zenithSprite = createLabelSprite("Z", "#ffffff");
  zenithSprite.position.copy(directionForAltAz(90, 0, opts).multiplyScalar(LABEL_RADIUS));
  group.add(zenithSprite);

  return group;
}

/** Frees GPU resources (line geometry, sprite canvas textures/materials) held by a createCompassRing() group. */
export function disposeCompassRing(group: THREE.Group): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Line) {
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    } else if (obj instanceof THREE.Sprite) {
      obj.material.map?.dispose();
      obj.material.dispose();
    }
  });
}
