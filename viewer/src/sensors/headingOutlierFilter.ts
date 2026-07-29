/**
 * Rejects transient outliers in a circular heading (0-360deg) reading
 * caused by magnetometer glitches (e.g. brief magnetic interference from
 * nearby metal/electronics, common indoors), without lagging behind
 * genuine fast turns.
 *
 * Strategy: a single large jump is held back (the last accepted heading is
 * returned instead) unless the *next* reading confirms it - i.e. two
 * consecutive samples landing near the same new heading, which a
 * one-off sensor glitch won't do but a real turn will.
 */

export interface HeadingFilterState {
  lastAcceptedDeg: number | null;
  pendingDeg: number | null;
}

export function createHeadingFilterState(): HeadingFilterState {
  return { lastAcceptedDeg: null, pendingDeg: null };
}

// DeviceOrientation events fire far faster than a person can physically
// turn (tens of Hz), so even a generous per-sample threshold like this
// only ever rejects sensor glitches, not real motion.
const OUTLIER_THRESHOLD_DEG = 45;

/** Signed shortest angular distance from `b` to `a`, in (-180, 180]. */
function circularDeltaDeg(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

/** Mutates `state` in place and returns the heading to actually use this sample. */
export function filterHeadingOutlier(state: HeadingFilterState, rawDeg: number): number {
  if (state.lastAcceptedDeg === null) {
    state.lastAcceptedDeg = rawDeg;
    state.pendingDeg = null;
    return rawDeg;
  }

  if (Math.abs(circularDeltaDeg(rawDeg, state.lastAcceptedDeg)) <= OUTLIER_THRESHOLD_DEG) {
    state.lastAcceptedDeg = rawDeg;
    state.pendingDeg = null;
    return rawDeg;
  }

  if (state.pendingDeg !== null && Math.abs(circularDeltaDeg(rawDeg, state.pendingDeg)) <= OUTLIER_THRESHOLD_DEG) {
    // Two consecutive readings agree on the new heading - a real turn, not a glitch.
    state.lastAcceptedDeg = rawDeg;
    state.pendingDeg = null;
    return rawDeg;
  }

  state.pendingDeg = rawDeg;
  return state.lastAcceptedDeg;
}
