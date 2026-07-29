import { describe, expect, it } from "vitest";
import { greenwichMeanSiderealTimeDeg, julianDate, localSiderealTimeDeg } from "./time";

describe("julianDate", () => {
  it("matches the well-known JD for the J2000.0 epoch (2000-01-01T12:00:00Z)", () => {
    expect(julianDate(new Date("2000-01-01T12:00:00.000Z"))).toBeCloseTo(2451545.0, 6);
  });

  it("matches the Unix epoch's known JD (1970-01-01T00:00:00Z)", () => {
    expect(julianDate(new Date("1970-01-01T00:00:00.000Z"))).toBeCloseTo(2440587.5, 6);
  });
});

describe("greenwichMeanSiderealTimeDeg", () => {
  it("stays within [0, 360)", () => {
    for (const iso of ["2026-07-27T00:00:00Z", "2026-07-27T12:00:00Z", "2000-01-01T00:00:00Z", "2050-06-15T18:30:00Z"]) {
      const gmst = greenwichMeanSiderealTimeDeg(new Date(iso));
      expect(gmst).toBeGreaterThanOrEqual(0);
      expect(gmst).toBeLessThan(360);
    }
  });

  it("advances by roughly 360.9856deg per solar day (sidereal vs solar day rate)", () => {
    const day1 = greenwichMeanSiderealTimeDeg(new Date("2026-07-27T00:00:00Z"));
    const day2 = greenwichMeanSiderealTimeDeg(new Date("2026-07-28T00:00:00Z"));
    const advanceDeg = ((day2 - day1) % 360 + 360) % 360;
    expect(advanceDeg).toBeCloseTo(0.9856, 2);
  });
});

describe("localSiderealTimeDeg", () => {
  it("equals GMST at longitude 0", () => {
    const date = new Date("2026-07-27T12:00:00Z");
    expect(localSiderealTimeDeg(date, 0)).toBeCloseTo(greenwichMeanSiderealTimeDeg(date), 9);
  });

  it("adds the longitude directly (east-positive) and wraps to [0, 360)", () => {
    const date = new Date("2026-07-27T12:00:00Z");
    const gmst = greenwichMeanSiderealTimeDeg(date);
    expect(localSiderealTimeDeg(date, 10)).toBeCloseTo((gmst + 10) % 360, 9);
    expect(localSiderealTimeDeg(date, -10)).toBeCloseTo(((gmst - 10) % 360 + 360) % 360, 9);
  });
});
