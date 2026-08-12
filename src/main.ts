import { Beach } from "./beach";
import { GLUnsupported } from "./gl/context";
import { ShaderError } from "./gl/program";
import { ScrollCamera } from "./scroll";
import { Router, type RouteMatch } from "./router/router";
import { ROUTES, STATIC_PATHS, notFound } from "./routes/views";

/**
 * PHASE 3 — two modes. Routing is in; the focus pull itself is not.
 *
 * What works today: real routes, real URLs, back and forward, deep links, and
 * one WebGL context across all of it. Entering a focus route stops the loop
 * (§9) and leaving it resumes with bounded catch-up, so the sand comes back
 * older rather than frozen (§10).
 *
 * What is still missing from §10: the transition. The scene currently cuts
 * rather than pulling focus — no camera push, no depth-of-field ramp, no
 * desaturation, and no render-once-to-a-texture. `stop()` and `start()` are
 * the seam that goes on.
 */

boot();

function boot(): void {
  const container = document.getElementById("app");
  if (!container) throw new Error("#app missing");

  let beach: Beach | null = null;
  let scroll: ScrollCamera | null = null;

  const canvas = document.getElementById("scene") as HTMLCanvasElement | null;
  if (canvas) {
    try {
      beach = new Beach({ canvas, onUnavailable: fallback });
      // PRD §12: reduced motion means no camera motion either, so the scroll
      // driver is not wired at all rather than wired and suppressed.
      scroll = beach.reducedMotion ? null : new ScrollCamera(beach);
      if (scroll) beach.onFrame = (dt) => scroll!.update(dt);
      console.info(
        `[beach] ${beach.tier.name} — field ${beach.field.width}×${beach.field.height}`,
      );
    } catch (err) {
      fallback(err as Error);
      beach = null;
    }
  }

  const router = new Router({
    routes: ROUTES,
    notFound,
    container,
    onNavigate: (to) => {
      markCurrent(to);
      if (!beach) return;
      // §9: focus pages turn the simulation, the scheduler and the RAF loop
      // off entirely, so they cost approximately nothing after the first
      // frame. §10: coming back resumes with catch-up, so marks left before
      // navigating away are still there, further eroded.
      if (to.route.mode === "focus") beach.stop();
      else beach.start();
    },
  });

  // The router renders whatever the address bar already says, which is what
  // makes a deep link land directly in focus mode without playing a
  // transition it never entered from (§10).
  router.start();

  // __staticPaths is read by tools/prerender.mjs so the route list has a
  // single source: adding a project cannot leave its page unprerendered.
  Object.assign(window, {
    __beach: beach, __scroll: scroll, __router: router, __staticPaths: STATIC_PATHS,
  });
}

/** Marks the nav item for the section being viewed. §4: a filled dot. */
function markCurrent(to: RouteMatch): void {
  const section = "/" + (to.path.split("/")[1] ?? "");
  for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>("#nav a"))) {
    if (a.classList.contains("brand")) continue;
    const href = a.getAttribute("href") ?? "";
    const match = href === "/" ? to.path === "/" : section === href;
    if (match) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

/**
 * PRD §12 requires the content to stand without the canvas. All of it is real
 * DOM already, so the honest failure is to remove the canvas and let the page
 * be a page — not to show an apology over an empty beach.
 */
function fallback(err: GLUnsupported | ShaderError | Error): void {
  document.documentElement.dataset.scene = "off";
  document.getElementById("scene")?.remove();
  const detail = err instanceof ShaderError ? `${err.stage}: ${err.log}` : err.message;
  console.warn("[beach] scene unavailable —", detail);
}
