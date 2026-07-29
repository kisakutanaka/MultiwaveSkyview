import { describe, expect, it } from "vitest";
import { createHeadingFilterState, filterHeadingOutlier } from "./headingOutlierFilter";

describe("filterHeadingOutlier", () => {
  it("accepts the first reading unconditionally", () => {
    const state = createHeadingFilterState();
    expect(filterHeadingOutlier(state, 123)).toBe(123);
  });

  it("passes through small frame-to-frame changes (normal turning)", () => {
    const state = createHeadingFilterState();
    filterHeadingOutlier(state, 100);
    expect(filterHeadingOutlier(state, 110)).toBe(110);
    expect(filterHeadingOutlier(state, 125)).toBe(125);
  });

  it("passes through small changes across the 0/360 wraparound", () => {
    const state = createHeadingFilterState();
    filterHeadingOutlier(state, 350);
    expect(filterHeadingOutlier(state, 5)).toBe(5);
  });

  it("holds back a single one-off large jump (a magnetometer glitch)", () => {
    const state = createHeadingFilterState();
    filterHeadingOutlier(state, 100);
    expect(filterHeadingOutlier(state, 250)).toBe(100);
    // The glitch didn't repeat, so the next normal reading near 100 goes through.
    expect(filterHeadingOutlier(state, 102)).toBe(102);
  });

  it("accepts a large jump once confirmed by a second consecutive reading (a real fast turn)", () => {
    const state = createHeadingFilterState();
    filterHeadingOutlier(state, 100);
    expect(filterHeadingOutlier(state, 250)).toBe(100);
    expect(filterHeadingOutlier(state, 252)).toBe(252);
    expect(filterHeadingOutlier(state, 255)).toBe(255);
  });

  it("confirms a jump across the 0/360 wraparound", () => {
    const state = createHeadingFilterState();
    filterHeadingOutlier(state, 10);
    expect(filterHeadingOutlier(state, 200)).toBe(10);
    expect(filterHeadingOutlier(state, 198)).toBe(198);
  });
});
