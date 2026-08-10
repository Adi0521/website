/**
 * Catch-up stepping for returning from focus mode.
 *
 * PRD §9 stops the simulation and the RAF loop on focus pages; PRD §10 still
 * promises that marks left behind are "there, further eroded" when you come
 * back. Both can be true only if the field is stepped forward on return, and
 * that step is where two constraints collide:
 *
 *   - §6.2 clamps the slump coefficient below the diffusion stability limit,
 *     and that limit is PER STEP. Handing the sim one 240-second dt after a
 *     four-minute read of a project page does not erode the field, it rings
 *     it. Every substep must stay at or under MAX_DT.
 *
 *   - §10 wants the return transition eased and interruptible at ~600ms.
 *     Substepping 240 seconds honestly is 4,800 sim passes in the frame the
 *     transition starts, which is the stutter that budget exists to prevent.
 *
 * The §6.2 fill-in table resolves it. Marks are effectively gone by +8s:
 *
 *     pressed  -0.600     +3s  -0.192     +8s  -0.012
 *
 * so simulated time past that point is work nobody can see. Capping catch-up
 * at CATCH_UP_CAP bounds the return to a fixed 160 passes while staying
 * visually indistinguishable from a full catch-up for any visit longer than a
 * few seconds. Short navigations fall under the cap and erode exactly.
 */

/** Per-step ceiling. The §6.2 slump clamp is a per-step stability bound. */
export const MAX_DT = 0.05;

/** Simulated seconds past which the §6.2 fill-in curve has nothing left to show. */
export const CATCH_UP_CAP = 8;

export interface CatchUpPlan {
  /** Number of substeps to run. Bounded by ceil(CATCH_UP_CAP / MAX_DT). */
  steps: number;
  /** Size of each substep, always <= MAX_DT. Zero when steps is zero. */
  dt: number;
  /** Simulated seconds this plan actually advances. */
  simulated: number;
  /** Simulated seconds discarded by the cap. Non-zero only past CATCH_UP_CAP. */
  skipped: number;
}

const EMPTY: CatchUpPlan = { steps: 0, dt: 0, simulated: 0, skipped: 0 };

/**
 * Plans the substeps needed to advance the field by `elapsed` seconds.
 *
 * Degenerate input is expected rather than exceptional here: this is called
 * off the back of wall-clock deltas that a suspended tab, a sleeping machine
 * or a clock adjustment can make negative, NaN or Infinite. All of those
 * produce an empty plan instead of a step count that hangs the frame.
 */
export function planCatchUp(elapsed: number, cap: number = CATCH_UP_CAP): CatchUpPlan {
  if (!Number.isFinite(elapsed) || elapsed <= 0) return EMPTY;
  if (!Number.isFinite(cap) || cap <= 0) return EMPTY;

  const simulated = Math.min(elapsed, cap);
  const steps = Math.ceil(simulated / MAX_DT);

  // Divide the simulated span evenly rather than running whole MAX_DT steps
  // plus a remainder: it lands on `simulated` exactly, with no drift to
  // accumulate across repeated focus-mode round trips.
  return {
    steps,
    dt: simulated / steps,
    simulated,
    skipped: elapsed - simulated,
  };
}
