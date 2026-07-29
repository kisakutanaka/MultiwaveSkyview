/**
 * Rejects transient outliers in a noisy angular reading (heading or
 * altitude), without lagging behind genuine fast motion.
 *
 * Originally written for the compass heading alone (magnetometer glitches
 * from nearby metal/electronics), then generalized to altitude too: holding
 * the phone near-vertical to look at the horizon (altDeg near 0) puts the
 * alpha/beta/gamma Euler decomposition DeviceOrientationEvent uses near a
 * gimbal lock (beta near 90deg), where alpha and gamma become numerically
 * degenerate. The OS's own sensor fusion is known to report jumpy
 * alpha/gamma there even when the phone is physically still - confirmed by
 * testing that altDeg=0 requires beta~90deg at *every* compass heading, sky
 * lock's "camera jumps near the horizon" symptom was direction-independent.
 *
 * Strategy: a single large jump is held back (the last accepted value is
 * returned instead) unless the *next* reading confirms it - two consecutive
 * samples landing near the same new value, which a one-off glitch won't do
 * but a real fast turn/tilt will. A max-hold safety valve force-accepts
 * after a few frames regardless, so a run of noise that happens to
 * alternate between two values (plausible right at a gimbal lock, where the
 * OS may bounce between two nearly-equivalent decompositions) can't get the
 * filter permanently stuck on a stale value.
 */

export interface OutlierFilterState {
  lastAcceptedDeg: number | null;
  pendingDeg: number | null;
  holdFrames: number;
}

export function createOutlierFilterState(): OutlierFilterState {
  return { lastAcceptedDeg: null, pendingDeg: null, holdFrames: 0 };
}

// DeviceOrientation events fire far faster than a person can physically
// turn/tilt (tens of Hz), so even a generous per-sample threshold like this
// only ever rejects sensor glitches, not real motion.
const OUTLIER_THRESHOLD_DEG = 45;
// ~80-250ms at typical event rates - long enough to absorb a burst of
// gimbal-lock noise, short enough that the safety valve doesn't itself
// become a perceptible source of lag.
const MAX_HOLD_FRAMES = 5;

/** Signed difference `a - b`, for plain (non-circular) angles like altitude. */
export function linearDeltaDeg(a: number, b: number): number {
  return a - b;
}

/** Signed shortest angular distance from `b` to `a`, in (-180, 180], for circular angles like heading. */
export function circularDeltaDeg(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

/** Mutates `state` in place and returns the value to actually use this sample. `deltaFn` should return `a - b` (or its circular equivalent). */
export function filterOutlier(
  state: OutlierFilterState,
  rawDeg: number,
  deltaFn: (a: number, b: number) => number,
): number {
  if (state.lastAcceptedDeg === null) {
    state.lastAcceptedDeg = rawDeg;
    state.pendingDeg = null;
    state.holdFrames = 0;
    return rawDeg;
  }

  if (Math.abs(deltaFn(rawDeg, state.lastAcceptedDeg)) <= OUTLIER_THRESHOLD_DEG) {
    state.lastAcceptedDeg = rawDeg;
    state.pendingDeg = null;
    state.holdFrames = 0;
    return rawDeg;
  }

  // Two consecutive readings agreeing on the new value is a real move, not
  // a glitch; holding for too many frames regardless is the safety valve
  // against alternating (bistable) noise never satisfying that check.
  const confirmed = state.pendingDeg !== null && Math.abs(deltaFn(rawDeg, state.pendingDeg)) <= OUTLIER_THRESHOLD_DEG;
  state.holdFrames += 1;
  if (confirmed || state.holdFrames > MAX_HOLD_FRAMES) {
    state.lastAcceptedDeg = rawDeg;
    state.pendingDeg = null;
    state.holdFrames = 0;
    return rawDeg;
  }

  state.pendingDeg = rawDeg;
  return state.lastAcceptedDeg;
}
