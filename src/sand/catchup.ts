/**
 * Catch-up stepping for returning from focus mode.
 *
 * PRD §9 stops the simulation and the RAF loop on focus pages; PRD §10 still
 * promises that marks left behind are "there, further eroded" when you come
 * back. Both can be true only if the field is stepped forward on return, and
 * that step is where two constraints collide:
 *
 *   - Every rate in sim.frag is clamped per step — slump at 0.22, smoothing
 *     at 0.9, infill at 0.5. Those clamps make a huge dt *stable*, which is
 *     worth being precise about: handing the sim one 240-second step after a
 *     four-minute read does not blow the field up, it quietly applies a single
 *     step's worth of each process and calls four minutes done. Measured over
 *     8s by tools/sim-unit.mjs: substeps erode 98% of a mark, one leap 58%,
 *     and neither rings. So substepping buys the right AMOUNT of erosion.
 *
 *   - §10 wants the return transition eased and interruptible at ~600ms.
 *     Substepping 240 seconds honestly is 4,800 sim passes in the frame the
 *     transition starts, which is the stutter that budget exists to prevent.
 *
 * The fill-in curve resolves it. Measured at shipped defaults, a mark is
 * effectively gone by +8s — 1.9% of its depth left:
 *
 *     pressed  -0.339     +3s  -0.118     +8s  -0.007
 *
 * so simulated time past that point is work nobody can see. Capping catch-up
 * at CATCH_UP_CAP bounds the return to a fixed 160 passes while staying
 * visually indistinguishable from a full catch-up for any visit longer than a
 * few seconds. Short navigations fall under the cap and erode exactly.
 */

/**
 * Per-step ceiling. Not a stability bound — sim.frag's own clamps handle that —
 * but the step size at which those clamps stop truncating the physics.
 */
export const MAX_DT = 0.05;

/** Simulated seconds past which the fill-in curve has nothing left to show. */
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
