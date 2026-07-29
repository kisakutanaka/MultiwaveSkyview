// @vitest-environment jsdom
// createCompassRing builds sprite labels via a <canvas> (see
// createLabelSprite), so this file needs a DOM - the rest of the project's
// tests intentionally run in plain node since they're pure math.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { altAzToEquatorial, equatorialToGalactic } from "../astro/coords";
import { galacticToWorldDirection } from "../astro/galacticToDirection";
import { localSiderealTimeDeg } from "../astro/time";
import { createCompassRing, disposeCompassRing } from "./createCompassRing";

const LAT_DEG = 35.681236;
const LON_DEG = 139.767125;
const LST_DEG = localSiderealTimeDeg(new Date("2026-07-27T12:00:00.000Z"), LON_DEG);
const RING_RADIUS = 495;

function directionFor(altDeg: number, azDeg: number): THREE.Vector3 {
  const equatorial = altAzToEquatorial({ altDeg, azDeg }, LAT_DEG, LST_DEG);
  const galactic = equatorialToGalactic(equatorial);
  return galacticToWorldDirection(galactic.lDeg, galactic.bDeg);
}

describe("createCompassRing", () => {
  it("every horizon-ring point sits at exactly the ring radius", () => {
    const group = createCompassRing({ latDeg: LAT_DEG, lstDeg: LST_DEG });
    const line = group.children.find((c): c is THREE.LineLoop => c.type === "LineLoop");
    expect(line).toBeDefined();

    const positions = line!.geometry.attributes.position;
    let maxError = 0;
    for (let i = 0; i < positions.count; i++) {
      const r = Math.hypot(positions.getX(i), positions.getY(i), positions.getZ(i));
      maxError = Math.max(maxError, Math.abs(r - RING_RADIUS));
    }
    expect(maxError).toBeLessThan(1e-4);

    disposeCompassRing(group);
  });

  it("N and S horizon points are antipodal (both alt=0, 180deg apart in azimuth)", () => {
    const north = directionFor(0, 0).multiplyScalar(RING_RADIUS);
    const south = directionFor(0, 180).multiplyScalar(RING_RADIUS);
    expect(north.clone().add(south).length()).toBeLessThan(1e-6);
  });

  it("E and W horizon points are antipodal", () => {
    const east = directionFor(0, 90).multiplyScalar(RING_RADIUS);
    const west = directionFor(0, 270).multiplyScalar(RING_RADIUS);
    expect(east.clone().add(west).length()).toBeLessThan(1e-6);
  });

  it("zenith is 90deg from every horizon cardinal point", () => {
    const zenith = directionFor(90, 0);
    for (const azDeg of [0, 90, 180, 270]) {
      const horizonPoint = directionFor(0, azDeg);
      const angleDeg = THREE.MathUtils.radToDeg(zenith.angleTo(horizonPoint));
      expect(angleDeg).toBeCloseTo(90, 3);
    }
  });

  it("builds exactly one ring line + 5 labels (N/E/S/W/Z)", () => {
    const group = createCompassRing({ latDeg: LAT_DEG, lstDeg: LST_DEG });
    const lines = group.children.filter((c) => c.type === "LineLoop");
    const sprites = group.children.filter((c) => c.type === "Sprite");
    expect(lines).toHaveLength(1);
    expect(sprites).toHaveLength(5);
    disposeCompassRing(group);
  });
});
