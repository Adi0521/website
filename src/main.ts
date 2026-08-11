import { Beach } from "./beach";
import { GLUnsupported } from "./gl/context";
import { ShaderError } from "./gl/program";
import { ScrollCamera } from "./scroll";

/**
 * PHASE 2 — engine ported from prototype/sand-phase1.html into src/gl and
 * src/sand. Two gaps remain before the phase closes, both camera work:
 *
 *   1. Scroll-driven camera — never built. The exit condition is that
 *      scrolling an empty beach is pleasant on its own, and it is untested.
 *   2. Camera-following clipmap — the field is a bounded patch and
 *      interaction stops at its edge. Dollying makes that worse.
 *
 * Then Phase 3 (routing + focus pull) BEFORE any project content.
 */

// Phase 3 scaffolding: /check/* runs the context-persistence harness instead
// of the scene. Delete this branch and src/check/ once a router is chosen.
// Dev-only: the guard is statically false in a production build, so the
// harness is tree-shaken out rather than shipped as a live /check/ route.
if (import.meta.env.DEV && location.pathname.startsWith("/check/")) {
  import("./check/context-check").then((m) => m.run());
} else {
  boot();
}

function boot(): void {
  const canvas = document.getElementById("scene") as HTMLCanvasElement | null;
  if (!canvas) throw new Error("#scene canvas missing");

  try {
    const beach = new Beach({ canvas, onUnavailable: fallback });
    // PRD §12: reduced motion means no camera motion either, so the scroll
    // driver is not wired at all rather than wired and suppressed.
    const scroll = beach.reducedMotion ? null : new ScrollCamera(beach);
    if (scroll) beach.onFrame = (dt) => scroll.update(dt);
    beach.start();
    console.info(
      `[beach] ${beach.tier.name} — field ${beach.field.width}×${beach.field.height}`,
    );
    Object.assign(window, { __beach: beach, __scroll: scroll });
  } catch (err) {
    fallback(err as Error);
  }
}

/**
 * PRD §12 requires the content to stand without the canvas. All of it is real
 * DOM already, so the honest failure is to remove the canvas and let the page
 * be a page — not to show an apology over an empty beach.
 */
function fallback(err: GLUnsupported | ShaderError | Error): void {
  document.documentElement.dataset.scene = "off";
  const canvas = document.getElementById("scene");
  if (canvas) canvas.remove();
  const detail = err instanceof ShaderError ? `${err.stage}: ${err.log}` : err.message;
  console.warn("[beach] scene unavailable —", detail);
}
