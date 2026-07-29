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
  it("every point on every ring (horizon + 2 meridians) sits at exactly the ring radius", () => {
    const group = createCompassRing({ latDeg: LAT_DEG, lstDeg: LST_DEG });
    const lines = group.children.filter((c): c is THREE.LineLoop => c.type === "LineLoop");
    expect(lines.length).toBeGreaterThan(0);

    let maxError = 0;
    for (const line of lines) {
      const positions = line.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const r = Math.hypot(positions.getX(i), positions.getY(i), positions.getZ(i));
        maxError = Math.max(maxError, Math.abs(r - RING_RADIUS));
      }
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

  it("nadir is antipodal to zenith", () => {
    const zenith = directionFor(90, 0);
    const nadir = directionFor(-90, 0);
    expect(zenith.clone().add(nadir).length()).toBeLessThan(1e-6);
  });

  it("the N/S meridian ring passes through zenith, N horizon, nadir, and S horizon", () => {
    // Mirrors meridianRingPoints(0, opts) in createCompassRing.ts: phi=0/90/180/270
    // should land on zenith / N horizon / nadir / S horizon respectively.
    const zenith = directionFor(90, 0).multiplyScalar(RING_RADIUS);
    const north = directionFor(0, 0).multiplyScalar(RING_RADIUS);
    const nadir = directionFor(-90, 0).multiplyScalar(RING_RADIUS);
    const south = directionFor(0, 180).multiplyScalar(RING_RADIUS);

    const group = createCompassRing({ latDeg: LAT_DEG, lstDeg: LST_DEG });
    const lines = group.children.filter((c): c is THREE.LineLoop => c.type === "LineLoop");
    // horizon ring first, then N/S meridian, then E/W meridian (creation order).
    const meridian = lines[1]!;
    const positions = meridian.geometry.attributes.position;
    const stepCount = positions.count - 1; // last point duplicates the first (LineLoop over a closed sampled curve)
    const at = (fraction: number) => {
      const i = Math.round(fraction * stepCount);
      return new THREE.Vector3(positions.getX(i), positions.getY(i), positions.getZ(i));
    };

    expect(at(0).distanceTo(zenith)).toBeLessThan(0.1);
    expect(at(0.25).distanceTo(north)).toBeLessThan(0.1);
    expect(at(0.5).distanceTo(nadir)).toBeLessThan(0.1);
    expect(at(0.75).distanceTo(south)).toBeLessThan(0.1);

    disposeCompassRing(group);
  });

  it("the horizon ring and the two meridian rings are mutually perpendicular planes", () => {
    // Each ring's plane normal is (a point on the ring) x (another point on
    // the ring); perpendicular rings should have perpendicular normals.
    const horizonNormal = directionFor(0, 0).clone().cross(directionFor(0, 90)).normalize();
    const nsMeridianNormal = directionFor(90, 0).clone().cross(directionFor(0, 0)).normalize();
    const ewMeridianNormal = directionFor(90, 0).clone().cross(directionFor(0, 90)).normalize();

    for (const [a, b] of [
      [horizonNormal, nsMeridianNormal],
      [horizonNormal, ewMeridianNormal],
      [nsMeridianNormal, ewMeridianNormal],
    ] as const) {
      const angleDeg = THREE.MathUtils.radToDeg(a.angleTo(b));
      const deviationFrom90 = Math.min(Math.abs(angleDeg - 90), Math.abs(angleDeg - 270));
      expect(deviationFrom90).toBeLessThan(0.5);
    }
  });

  it("builds exactly 3 ring lines (horizon + 2 meridians) + 6 labels (N/E/S/W/Z/nadir)", () => {
    const group = createCompassRing({ latDeg: LAT_DEG, lstDeg: LST_DEG });
    const lines = group.children.filter((c) => c.type === "LineLoop");
    const sprites = group.children.filter((c) => c.type === "Sprite");
    expect(lines).toHaveLength(3);
    expect(sprites).toHaveLength(6);
    disposeCompassRing(group);
  });
});
