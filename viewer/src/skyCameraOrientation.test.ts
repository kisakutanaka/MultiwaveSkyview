import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { altAzToEquatorial, equatorialToGalactic } from "./astro/coords";
import { galacticToWorldDirection } from "./astro/galacticToDirection";
import { localSiderealTimeDeg } from "./astro/time";
import { computeSkyDirectionQuaternion } from "./skyCameraOrientation";

const POSITION = { latitudeDeg: 35.681236, longitudeDeg: 139.767125 };
const DATE = new Date("2026-07-27T12:00:00.000Z");

function expectedDirection(altDeg: number, azDeg: number): THREE.Vector3 {
  const lst = localSiderealTimeDeg(DATE, POSITION.longitudeDeg);
  const equatorial = altAzToEquatorial({ altDeg, azDeg }, POSITION.latitudeDeg, lst);
  const galactic = equatorialToGalactic(equatorial);
  return galacticToWorldDirection(galactic.lDeg, galactic.bDeg);
}

describe("computeSkyDirectionQuaternion", () => {
  it.each([
    [0, 0],
    [0, 90],
    [0, 180],
    [0, 270],
    [45, 45],
    [80, 200],
    [10, 350],
  ])(
    "camera forward (-Z) matches the intended sky direction for alt=%d az=%d (regression guard: Object3D.lookAt() vs Camera.lookAt() gives the exact opposite here)",
    (altDeg, azDeg) => {
      const q = computeSkyDirectionQuaternion({ altDeg, azDeg }, POSITION, DATE);
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      const expected = expectedDirection(altDeg, azDeg);
      expect(forward.dot(expected)).toBeGreaterThan(0.999);
    },
  );

  it("keeps the up-reference far from the look direction across the normal operating range (numerical stability guard)", () => {
    // A near-direction up hint (tried and reverted - see
    // docs/sky-lock-debug-plan.md) pushes this angle toward 0/180 at every
    // altitude, which is exactly the condition that destabilizes lookAt()'s
    // internal `up x forward` cross product. The fixed true-zenith up
    // reference should stay well clear of that except very near the zenith
    // itself (an unavoidable, expected singularity - not tested away here).
    for (const altDeg of [0, 20, 45, 70, 85]) {
      for (const azDeg of [0, 90, 180, 270]) {
        const q = computeSkyDirectionQuaternion({ altDeg, azDeg }, POSITION, DATE);
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
        const angleDeg = THREE.MathUtils.radToDeg(forward.angleTo(up));
        expect(angleDeg).toBeGreaterThan(5);
        expect(angleDeg).toBeLessThan(175);
      }
    }
  });

  it("keeps the horizon level while panning at a fixed altitude (holding the phone upright and turning)", () => {
    // "Level" = the screen-space "up" direction stays aligned with the true
    // zenith's component perpendicular to the view direction, for every
    // azimuth at a fixed altitude - panning shouldn't visibly rotate the
    // horizon. This is the exact property the user asked about directly
    // ("スマホを垂直に立ててPanをしたときにコンパスリングは水平に見えるはずですか?")
    // that caught the previous (reverted) regression.
    const altDeg = 10;
    const lst = localSiderealTimeDeg(DATE, POSITION.longitudeDeg);
    const zenithEq = altAzToEquatorial({ altDeg: 90, azDeg: 0 }, POSITION.latitudeDeg, lst);
    const zenithGal = equatorialToGalactic(zenithEq);
    const worldZenith = galacticToWorldDirection(zenithGal.lDeg, zenithGal.bDeg);

    for (const azDeg of [0, 30, 90, 150, 210, 270, 330]) {
      const q = computeSkyDirectionQuaternion({ altDeg, azDeg }, POSITION, DATE);
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);

      const zenithPerp = worldZenith
        .clone()
        .sub(forward.clone().multiplyScalar(worldZenith.dot(forward)))
        .normalize();
      const angleDeg = THREE.MathUtils.radToDeg(up.angleTo(zenithPerp));
      expect(angleDeg).toBeLessThan(0.5);
    }
  });
});
