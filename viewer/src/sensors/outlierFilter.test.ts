import { describe, expect, it } from "vitest";
import { circularDeltaDeg, createOutlierFilterState, filterOutlier, linearDeltaDeg } from "./outlierFilter";

describe("filterOutlier with circularDeltaDeg (heading)", () => {
  it("accepts the first reading unconditionally", () => {
    const state = createOutlierFilterState();
    expect(filterOutlier(state, 123, circularDeltaDeg)).toBe(123);
  });

  it("passes through small frame-to-frame changes unchanged (normal turning)", () => {
    const state = createOutlierFilterState();
    filterOutlier(state, 100, circularDeltaDeg);
    expect(filterOutlier(state, 110, circularDeltaDeg)).toBe(110);
    expect(filterOutlier(state, 120, circularDeltaDeg)).toBe(120);
  });

  it("passes through small changes across the 0/360 wraparound unchanged (mod 360 - the internal accumulator is left unnormalized by design, see deviceOrientation.ts's normalizeDeg at the call site)", () => {
    const state = createOutlierFilterState();
    filterOutlier(state, 350, circularDeltaDeg);
    const result = filterOutlier(state, 5, circularDeltaDeg);
    expect(((result % 360) + 360) % 360).toBe(5);
  });

  it("clamps a single large jump to at most the max step, instead of snapping straight to it", () => {
    const state = createOutlierFilterState();
    filterOutlier(state, 100, circularDeltaDeg);
    const result = filterOutlier(state, 250, circularDeltaDeg);
    expect(result).toBeGreaterThan(100);
    expect(result).toBeLessThan(250);
  });

  it("clamps a jump across the 0/360 wraparound in the correct (shorter) direction", () => {
    const state = createOutlierFilterState();
    filterOutlier(state, 10, circularDeltaDeg);
    const result = filterOutlier(state, 200, circularDeltaDeg);
    // Shortest path from 10 to 200 is decreasing through 0/360 (10 -> 0/360 -> 200), not increasing.
    expect(circularDeltaDeg(result, 10)).toBeCloseTo(-15, 5);
  });

  it("catches up smoothly (monotonically, without overshoot) across several frames of sustained noise", () => {
    const state = createOutlierFilterState();
    filterOutlier(state, 0, circularDeltaDeg);
    let prev = 0;
    for (let i = 0; i < 10; i++) {
      const next = filterOutlier(state, 150, circularDeltaDeg);
      expect(next).toBeGreaterThanOrEqual(prev);
      expect(next).toBeLessThanOrEqual(150);
      prev = next;
    }
    expect(prev).toBe(150);
  });

  it("never lets a single call move the output by more than the max step, even for a near-180deg reversal", () => {
    const state = createOutlierFilterState();
    filterOutlier(state, 0, circularDeltaDeg);
    const result = filterOutlier(state, 179, circularDeltaDeg);
    expect(Math.abs(circularDeltaDeg(result, 0))).toBeLessThanOrEqual(15);
  });
});

describe("filterOutlier with linearDeltaDeg (altitude, if ever needed again)", () => {
  it("passes through small changes unchanged", () => {
    const state = createOutlierFilterState();
    filterOutlier(state, 10, linearDeltaDeg);
    expect(filterOutlier(state, 15, linearDeltaDeg)).toBe(15);
  });

  it("clamps a single large jump", () => {
    const state = createOutlierFilterState();
    filterOutlier(state, 5, linearDeltaDeg);
    const result = filterOutlier(state, 80, linearDeltaDeg);
    expect(result).toBeGreaterThan(5);
    expect(result).toBeLessThan(80);
  });
});
