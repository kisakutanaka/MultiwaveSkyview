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

function horizonRingPoints(opts: CompassRingOptions): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= RING_STEPS; i++) {
    const az = (360 * i) / RING_STEPS;
    points.push(directionForAltAz(0, az, opts).multiplyScalar(RING_RADIUS));
  }
  return points;
}

/**
 * A great circle through the zenith and nadir, at reference azimuth
 * `azRefDeg` on one side and `azRefDeg+180` on the other - i.e. the
 * "meridian" ring you'd sweep through by tilting (changing altitude) at a
 * fixed azimuth. Parameterized by a single angle phiDeg in [0,360) so it
 * traces zenith -> azRefDeg horizon -> nadir -> (azRefDeg+180) horizon ->
 * back to zenith, one continuous loop.
 */
function meridianRingPoints(azRefDeg: number, opts: CompassRingOptions): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= RING_STEPS; i++) {
    const phi = (360 * i) / RING_STEPS;
    const direction =
      phi <= 180 ? directionForAltAz(90 - phi, azRefDeg, opts) : directionForAltAz(phi - 270, azRefDeg + 180, opts);
    points.push(direction.multiplyScalar(RING_RADIUS));
  }
  return points;
}

function createRingLine(points: THREE.Vector3[], color: number): THREE.LineLoop {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true });
  const line = new THREE.LineLoop(geometry, material);
  line.renderOrder = 998;
  return line;
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
 * Debug overlay: renders three mutually-perpendicular great circles (like a
 * 3D-editor rotation gizmo) plus N/E/S/W/zenith/nadir markers, at the
 * observer's current lat/LST, using the exact same
 * AltAz -> Equatorial -> Galactic -> world-direction pipeline the live
 * sky-lock camera uses (astro/coords.ts, astro/galacticToDirection.ts):
 *
 * - Horizon ring (alt=0, green): sweeping this = panning (azimuth).
 * - N/S meridian (through zenith/nadir at az=0/180, orange): sweeping this
 *   at az=0 = tilting (altitude) while facing north.
 * - E/W meridian (through zenith/nadir at az=90/270, purple): sweeping this
 *   at az=90 = tilting while facing east; also the ring roll rotates
 *   around when the camera's "up" reference is disambiguated near it.
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

  group.add(createRingLine(horizonRingPoints(opts), 0x00ff88));
  group.add(createRingLine(meridianRingPoints(0, opts), 0xffaa00));
  group.add(createRingLine(meridianRingPoints(90, opts), 0xaa66ff));

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

  // Lowercase "z" (vs. zenith's uppercase "Z") to keep every label a single
  // glyph at this sprite's fixed font size.
  const nadirSprite = createLabelSprite("z", "#888888");
  nadirSprite.position.copy(directionForAltAz(-90, 0, opts).multiplyScalar(LABEL_RADIUS));
  group.add(nadirSprite);

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
