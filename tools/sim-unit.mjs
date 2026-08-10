#!/usr/bin/env node
/**
 * Drives sim.frag headless with fixed timesteps and reads heights back through
 * an RGBA8 probe, so erosion and wave behaviour can be asserted numerically.
 *
 * This is separate from screenshotting the page for a specific reason: software
 * rendering cannot test temporal behaviour. A fill-in test against the live page
 * looked like a flat line purely because ~1 second of simulated time elapsed in
 * 25 real seconds. Anything time-dependent goes through this harness.
 *
 * Expected shape of the fill-in curve at defaults (see PRD §6.2):
 *     pressed  -0.60   +1s  -0.57   +3s  -0.19   +8s  -0.01
 * The rim dropping on the same schedule as the hole is the diagnostic that
 * slumping is working rather than decay.
 *
 * Modules are loaded through Vite rather than imported directly: CI runs Node
 * 20, which cannot strip types, and the GPU suite below will need Vite anyway
 * to resolve `#include` in the shaders through vite-plugin-glsl.
 */

import { createServer } from "vite";

let failures = 0;
let ran = 0;

function check(label, fn) {
  ran += 1;
  try {
    const detail = fn();
    console.log(`  ok    ${label}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL  ${label}\n          ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });

try {
  const { planCatchUp, MAX_DT, CATCH_UP_CAP } = await vite.ssrLoadModule("/src/sand/catchup.ts");

  // ── Focus-mode catch-up (PRD §9 vs §10) ──────────────────────────────────
  // §9 stops the sim on focus pages, §10 wants marks "further eroded" on
  // return. The plan that reconciles them has to stay inside the §6.2
  // per-step stability bound without stalling the §10 transition budget.
  console.log("\ncatch-up stepping — returning from focus mode\n");

  check("the constants are anchored, not self-referential", () => {
    // Every check below reads MAX_DT from the module under test, so on its own
    // the suite would happily certify a constant that rings the field.
    // 0.05 is the clamp the working prototype ships (sand-phase1.html:903).
    assert(MAX_DT <= 0.05, `MAX_DT ${MAX_DT} exceeds the prototype clamp of 0.05`);
    assert(CATCH_UP_CAP >= 8, `cap of ${CATCH_UP_CAP}s truncates the §6.2 fill-in curve`);
    return `MAX_DT ${MAX_DT} <= 0.05, cap ${CATCH_UP_CAP}s >= 8s`;
  });

  check("an ordinary frame is left alone", () => {
    const p = planCatchUp(1 / 60);
    assert(p.steps === 1, `expected 1 step, got ${p.steps}`);
    assert(near(p.simulated, 1 / 60), `simulated ${p.simulated}`);
    assert(p.skipped === 0, `skipped ${p.skipped}`);
    return `1 step of ${p.dt.toFixed(4)}s`;
  });

  check("no substep can exceed the stability bound", () => {
    // The load-bearing invariant. A single un-substepped dt is what rings the
    // field, so this holds across the whole range including absurd gaps.
    for (const gap of [0.05, 0.06, 0.9, 3, 7.99, 8, 8.01, 240, 3600, 86_400]) {
      const p = planCatchUp(gap);
      assert(p.dt <= MAX_DT + 1e-12, `gap ${gap}s produced dt ${p.dt} > ${MAX_DT}`);
    }
    return `dt <= ${MAX_DT} for gaps up to 24h`;
  });

  check("a long focus-page visit is capped", () => {
    const p = planCatchUp(240); // four minutes reading /work/:slug
    assert(near(p.simulated, CATCH_UP_CAP), `simulated ${p.simulated}s`);
    assert(near(p.skipped, 240 - CATCH_UP_CAP), `skipped ${p.skipped}s`);
    return `240s → ${p.simulated}s simulated, ${p.steps} passes`;
  });

  check("the return transition cannot be stalled", () => {
    // §10 budgets ~600ms, eased and interruptible. An uncapped catch-up over a
    // four-minute visit would be 4,800 passes in the frame the pull starts.
    const ceiling = Math.ceil(CATCH_UP_CAP / MAX_DT);
    for (const gap of [8, 60, 240, 3600, 86_400]) {
      const p = planCatchUp(gap);
      assert(p.steps <= ceiling, `gap ${gap}s wanted ${p.steps} passes, ceiling is ${ceiling}`);
    }
    return `worst case ${ceiling} passes, not 4800`;
  });

  check("short navigations erode exactly, nothing discarded", () => {
    // Below the cap the promise in §10 is kept literally, not approximated.
    for (const gap of [0.2, 1, 3, 7.9, CATCH_UP_CAP]) {
      const p = planCatchUp(gap);
      assert(p.skipped === 0, `gap ${gap}s discarded ${p.skipped}s`);
      assert(near(p.simulated, gap), `gap ${gap}s simulated ${p.simulated}s`);
    }
    return `exact up to the ${CATCH_UP_CAP}s cap`;
  });

  check("steps land on the simulated span with no drift", () => {
    // Repeated focus-mode round trips must not accumulate error.
    for (const gap of [0.016, 0.07, 1.3, 5.5, 8, 500]) {
      const p = planCatchUp(gap);
      assert(near(p.steps * p.dt, p.simulated, 1e-9), `gap ${gap}s: ${p.steps} × ${p.dt}`);
    }
    return "steps × dt === simulated";
  });

  check("a suspended tab cannot produce a hang", () => {
    // These arrive from wall-clock deltas across sleep, tab discard and clock
    // adjustment. A negative or NaN gap must not become a step count.
    for (const bad of [0, -1, -0.0001, NaN, Infinity, -Infinity]) {
      const p = planCatchUp(bad);
      assert(p.steps === 0, `gap ${bad} produced ${p.steps} steps`);
      assert(p.dt === 0, `gap ${bad} produced dt ${p.dt}`);
    }
    return "0 / negative / NaN / Infinity → empty plan";
  });

  // ── GPU suite ────────────────────────────────────────────────────────────
  console.log("\nfield behaviour — pending the engine port\n");
  console.log("  TODO: port from the prototype harness once src/sand/field.ts lands.");
  console.log("  Reference implementation: prototype/sand-phase1.html");
  console.log("  First assertion: the §6.2 fill-in curve above.");
  console.log(
    "  Second: an 8s catch-up run as one plan leaves the field converged,\n" +
      "          not ringing — the numeric claim this cap rests on.",
  );

  console.log(`\n${failures ? "FAIL" : "PASS"} — ${ran - failures}/${ran} checks\n`);
  process.exit(failures ? 1 : 0);
} finally {
  await vite.close();
}
