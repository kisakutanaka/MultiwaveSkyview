import { describe, expect, it } from "vitest";
import { altAzToEquatorial, equatorialToGalactic } from "./coords";
import { localSiderealTimeDeg } from "./time";

const LAT_DEG = 35.681236;
const LON_DEG = 139.767125;
const DATE = new Date("2026-07-27T12:00:00.000Z");
const LST_DEG = localSiderealTimeDeg(DATE, LON_DEG);

/**
 * Cross-checked against astropy (AltAz -> ICRS -> Galactic) for the same
 * lat/lon/time/alt/az, run once in a scratch script during debugging (see
 * docs/sky-lock-debug-plan.md). Tolerance is generous (1deg), not tighter,
 * because this module deliberately skips precession/nutation (see coords.ts's
 * doc comment) - astropy applies full precession from J2000 to 2026, which
 * alone accounts for most of the ~0.1-0.7deg residual.
 */
const ASTROPY_GALACTIC_FIXTURES: Array<{ altDeg: number; azDeg: number; lDeg: number; bDeg: number }> = [
  { altDeg: 0, azDeg: 0, lDeg: 157.377, bDeg: 11.8875 },
  { altDeg: 0, azDeg: 90, lDeg: 86.9072, bDeg: -57.8212 },
  { altDeg: 0, azDeg: 180, lDeg: 337.3759, bDeg: -11.8779 },
  { altDeg: 0, azDeg: 270, lDeg: 266.9203, bDeg: 57.8225 },
  { altDeg: 90, azDeg: 0, lDeg: 60.5584, bDeg: 29.4189 },
  { altDeg: 45, azDeg: 45, lDeg: 97.7342, bDeg: 1.5537 },
];

describe("altAzToEquatorial + equatorialToGalactic (cross-checked against astropy)", () => {
  it.each(ASTROPY_GALACTIC_FIXTURES)(
    "alt=$altDeg az=$azDeg matches astropy's galactic (l,b) within 1deg",
    ({ altDeg, azDeg, lDeg, bDeg }) => {
      const equatorial = altAzToEquatorial({ altDeg, azDeg }, LAT_DEG, LST_DEG);
      const galactic = equatorialToGalactic(equatorial);
      // Observed residuals (all from unmodeled precession) run up to ~0.7deg
      // for these fixtures; 1.0deg leaves margin while still catching any
      // real regression (a real bug in this session produced ~10-180deg
      // errors, not sub-degree ones).
      expect(Math.abs(galactic.lDeg - lDeg)).toBeLessThan(1.0);
      expect(Math.abs(galactic.bDeg - bDeg)).toBeLessThan(1.0);
    },
  );
});

describe("altAzToEquatorial", () => {
  it("returns dec === lat at the zenith, independent of azimuth", () => {
    for (const azDeg of [0, 37, 90, 180, 270, 359]) {
      const { decDeg } = altAzToEquatorial({ altDeg: 90, azDeg }, LAT_DEG, LST_DEG);
      expect(decDeg).toBeCloseTo(LAT_DEG, 9);
    }
  });

  it("returns ra === lst at the zenith, independent of azimuth", () => {
    for (const azDeg of [0, 37, 90, 180, 270, 359]) {
      const { raDeg } = altAzToEquatorial({ altDeg: 90, azDeg }, LAT_DEG, LST_DEG);
      expect(raDeg).toBeCloseTo(LST_DEG, 9);
    }
  });
});
