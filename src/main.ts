import { WaveScheduler, DEFAULT_WAVES } from "./waves/scheduler";
import { pickTier } from "./gl/quality";

/**
 * PHASE 2 — port the prototype engine into src/gl and src/sand.
 * `prototype/sand-phase1.html` is the working reference; diff against it.
 *
 * Order that matters:
 *   1. context + programs + ping-pong field   (straight port)
 *   2. scroll-driven camera                   (never built — Phase 2 gap)
 *   3. camera-following clipmap               (never built — Phase 2 gap)
 * Then Phase 3 (routing + focus pull) BEFORE any project content.
 */

// Phase 3 scaffolding: /check/* runs the context-persistence harness instead
// of the scene. Delete this branch and src/check/ once a router is chosen.
// Dev-only: the guard is statically false in a production build, so the
// harness is tree-shaken out rather than shipped as a live /check/ route.
if (import.meta.env.DEV && location.pathname.startsWith("/check/")) {
  import("./check/context-check").then((m) => m.run());
}

const tier = pickTier();
const waves = new WaveScheduler(DEFAULT_WAVES);

console.info("[beach] tier", tier.name, "— engine port pending, see prototype/");

let last = performance.now(), t = 0;
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now; t += dt;
  waves.step(dt, t);
  // TODO: sim pass, render pass
}
frame();
