/**
 * Rate-limits a noisy angular reading (currently: compass heading only -
 * see deviceOrientation.ts) so a single bad sample can't move the accepted
 * value by more than a fixed amount per event, without ever lagging behind
 * genuine motion by more than a couple of frames.
 *
 * History: this used to be a hold-then-confirm design (reject a big jump,
 * accept it once a second consecutive reading agreed). That worked for
 * one-off glitches, but real-world noise near a gimbal lock (see below)
 * tends to be *sustained* across several frames, not a single blip - two
 * consecutive noisy-but-mutually-close readings would "confirm" each other
 * and the filter would snap straight to a still-bad value. A rate limiter
 * can't produce that snap by construction: the output can only ever move by
 * at most `maxStepDeg` per call, so even a multi-frame noisy patch shows up
 * as a bounded creep, not a jump.
 *
 * Real-world trigger this was built for: altitude passing through certain
 * values (confirmed 0deg and 45deg) makes the azimuth jump, while altitude
 * itself stays smooth. That asymmetry makes sense given how
 * sensors/deviceOrientation.ts derives both from the same alpha/beta/gamma
 * Euler triple (YXZ order): beta (tilt) alone drives altDeg fairly
 * directly, but azDeg depends on the alpha/gamma split, which is known to
 * become numerically degenerate near beta=90deg (a classic Euler gimbal
 * lock) - the OS's own sensor fusion can misattribute rotation between
 * alpha and gamma there even while the true physical orientation (and
 * hence true altDeg) barely changes, corrupting azDeg specifically.
 */

export interface OutlierFilterState {
  lastAcceptedDeg: number | null;
}

export function createOutlierFilterState(): OutlierFilterState {
  return { lastAcceptedDeg: null };
}

// Generous relative to realistic per-event human turning speed (well over
// 1000deg/sec sustained even at a slow ~15Hz event rate), but tight enough
// to meaningfully damp single- and multi-frame sensor noise into a smooth
// creep instead of a snap.
export const DEFAULT_MAX_STEP_DEG = 15;

/** Signed difference `a - b`, for plain (non-circular) angles like altitude. */
export function linearDeltaDeg(a: number, b: number): number {
  return a - b;
}

/** Signed shortest angular distance from `b` to `a`, in (-180, 180], for circular angles like heading. */
export function circularDeltaDeg(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

/**
 * Mutates `state` in place and returns the value to actually use this
 * sample. `deltaFn` should return `a - b` (or its circular equivalent).
 * `maxStepDeg` overrides the default per-call max step - see
 * deviceOrientation.ts's azimuthMaxStepDeg() for why azimuth needs a
 * smaller, beta-dependent cap instead of the fixed default: a plain fixed
 * rate limit still "catches up" to sustained multi-frame gimbal-lock noise
 * within a few frames (fast enough to still read as a jump to a human eye,
 * even though each individual step is small and continuous).
 */
export function filterOutlier(
  state: OutlierFilterState,
  rawDeg: number,
  deltaFn: (a: number, b: number) => number,
  maxStepDeg: number = DEFAULT_MAX_STEP_DEG,
): number {
  if (state.lastAcceptedDeg === null) {
    state.lastAcceptedDeg = rawDeg;
    return rawDeg;
  }

  const delta = deltaFn(rawDeg, state.lastAcceptedDeg);
  const clampedDelta = Math.max(-maxStepDeg, Math.min(maxStepDeg, delta));
  state.lastAcceptedDeg += clampedDelta;
  return state.lastAcceptedDeg;
}
