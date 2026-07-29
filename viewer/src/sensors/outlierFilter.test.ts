import { describe, expect, it } from "vitest";
import { circularDeltaDeg, createOutlierFilterState, filterOutlier, linearDeltaDeg } from "./outlierFilter";

describe("filterOutlier with circularDeltaDeg (heading)", () => {
  it("accepts the first reading unconditionally", () => {
    const state = createOutlierFilterState();
    expect(filterOutlier(state, 123, circularDeltaDeg)).toBe(123);
  });

  it("passes through small frame-to-frame changes (normal turning)", () => {
    const state = createOutlierFilterState();
    filterOutlier(state, 100, circularDeltaDeg);
    expect(filterOutlier(state, 110, circularDeltaDeg)).toBe(110);
    expect(filterOutlier(state, 125, circularDeltaDeg)).toBe(125);
  });

  it("passes through small changes across the 0/360 wraparound", () => {
    const state = createOutlierFilterState();
    filterOutlier(state, 350, circularDeltaDeg);
    expect(filterOutlier(state, 5, circularDeltaDeg)).toBe(5);
  });

  it("holds back a single one-off large jump (a magnetometer glitch)", () => {
    const state = createOutlierFilterState();
    filterOutlier(state, 100, circularDeltaDeg);
    expect(filterOutlier(state, 250, circularDeltaDeg)).toBe(100);
    // The glitch didn't repeat, so the next normal reading near 100 goes through.
    expect(filterOutlier(state, 102, circularDeltaDeg)).toBe(102);
  });

  it("accepts a large jump once confirmed by a second consecutive reading (a real fast turn)", () => {
    const state = createOutlierFilterState();
    filterOutlier(state, 100, circularDeltaDeg);
    expect(filterOutlier(state, 250, circularDeltaDeg)).toBe(100);
    expect(filterOutlier(state, 252, circularDeltaDeg)).toBe(252);
    expect(filterOutlier(state, 255, circularDeltaDeg)).toBe(255);
  });

  it("confirms a jump across the 0/360 wraparound", () => {
    const state = createOutlierFilterState();
    filterOutlier(state, 10, circularDeltaDeg);
    expect(filterOutlier(state, 200, circularDeltaDeg)).toBe(10);
    expect(filterOutlier(state, 198, circularDeltaDeg)).toBe(198);
  });
});

describe("filterOutlier with linearDeltaDeg (altitude)", () => {
  it("passes through small changes", () => {
    const state = createOutlierFilterState();
    filterOutlier(state, 10, linearDeltaDeg);
    expect(filterOutlier(state, 15, linearDeltaDeg)).toBe(15);
  });

  it("holds back a single one-off large jump", () => {
    const state = createOutlierFilterState();
    filterOutlier(state, 5, linearDeltaDeg);
    expect(filterOutlier(state, 80, linearDeltaDeg)).toBe(5);
  });
});

describe("filterOutlier max-hold safety valve", () => {
  it("force-accepts after too many consecutive held frames, even without two matching readings in a row", () => {
    const state = createOutlierFilterState();
    filterOutlier(state, 0, circularDeltaDeg);
    // Alternates between two far-apart values every frame, each one also
    // far from the *other* - never satisfies "confirmed by the immediately
    // preceding pending value", so the two-consecutive-agree check alone
    // would get stuck here forever.
    let last = 0;
    for (let i = 0; i < 5; i++) {
      last = filterOutlier(state, i % 2 === 0 ? 100 : 200, circularDeltaDeg);
    }
    expect(last).toBe(0); // still held (5 held frames is at, not past, the safety-valve threshold)

    last = filterOutlier(state, 100, circularDeltaDeg);
    // The safety valve must have forced this 6th held frame through.
    expect(last).toBe(100);
  });

  it("resets the hold counter once a value is accepted", () => {
    const state = createOutlierFilterState();
    filterOutlier(state, 0, linearDeltaDeg);
    filterOutlier(state, 80, linearDeltaDeg); // held (outlier)
    expect(filterOutlier(state, 82, linearDeltaDeg)).toBe(82); // confirmed, accepted
    expect(state.holdFrames).toBe(0);
  });
});
