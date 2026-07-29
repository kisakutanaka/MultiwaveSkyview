import { describe, expect, it } from "vitest";
import { galacticToWorldDirection } from "./galacticToDirection";

describe("galacticToWorldDirection", () => {
  it("always returns a unit vector", () => {
    for (const [l, b] of [
      [0, 0],
      [90, 45],
      [180, -30],
      [270, 80],
      [359, -89],
    ]) {
      expect(galacticToWorldDirection(l, b).length()).toBeCloseTo(1, 9);
    }
  });

  it("north (b=+90) maps to the sphere apex (y=+1) - regression guard for the N/S flip found after the FITS->PNG pivot", () => {
    const north = galacticToWorldDirection(0, 90);
    expect(north.y).toBeCloseTo(1, 6);
  });

  it("south (b=-90) maps to the sphere bottom (y=-1)", () => {
    const south = galacticToWorldDirection(0, -90);
    expect(south.y).toBeCloseTo(-1, 6);
  });

  it("the galactic equator (b=0) always has y=0", () => {
    for (const l of [0, 45, 90, 180, 270]) {
      expect(galacticToWorldDirection(l, 0).y).toBeCloseTo(0, 9);
    }
  });

  it("wraps l continuously across the 0/360 boundary (no seam discontinuity)", () => {
    const justBelow = galacticToWorldDirection(359.9, 10);
    const justAbove = galacticToWorldDirection(0.1, 10);
    expect(justBelow.distanceTo(justAbove)).toBeLessThan(0.01);
  });

  it("l and l+360 give the same direction", () => {
    const a = galacticToWorldDirection(200, -20);
    const b = galacticToWorldDirection(560, -20);
    expect(a.distanceTo(b)).toBeCloseTo(0, 9);
  });
});
