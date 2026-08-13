import { AboutStations } from "./about/mount";
import { Beach } from "./beach";
import { GLUnsupported } from "./gl/context";
import { ShaderError } from "./gl/program";
import { ScrollCamera } from "./scroll";
import { Router, type RouteMatch } from "./router/router";
import { ROUTES, STATIC_PATHS, notFound } from "./routes/views";

/**
 * PHASE 4 — text in sand.
 *
 * Phase 3 is behind us: real routes, real URLs, back and forward, deep links,
 * one WebGL context across all of it, and the focus pull as defocus plus a
 * camera push (§10).
 *
 * What Phase 4 adds here is `AboutStations`, which is the first thing to write
 * into the sand that is not a pointer — the hero carve (§8.1) and the
 * footprint timeline (§8.2). It mounts and unmounts with About's DOM, because
 * a focus page does not have a hero to carve.
 */

boot();

function boot(): void {
  const container = document.getElementById("app");
  if (!container) throw new Error("#app missing");

  let beach: Beach | null = null;
  let scroll: ScrollCamera | null = null;
  let about: AboutStations | null = null;

  const canvas = document.getElementById("scene") as HTMLCanvasElement | null;
  if (canvas) {
    try {
      beach = new Beach({ canvas, onUnavailable: fallback });
      // PRD §12: reduced motion means no camera motion either, so the scroll
      // driver is not wired at all rather than wired and suppressed.
      scroll = beach.reducedMotion ? null : new ScrollCamera(beach);
      // §12 again: reduced motion gets a static beach, and a title pressing
      // itself into the sand on load is motion. The DOM <h1> is the title in
      // that mode, which is what it already is in the no-WebGL fallback.
      about = beach.reducedMotion ? null : new AboutStations(beach);
      const stations = about;
      beach.onFrame = (dt) => {
        scroll?.update(dt);
        stations?.update(dt);
      };
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
    onNavigate: (to, from) => {
      markCurrent(to);
      // Anchors the beach where it is when entering a focus page, and swaps
      // the scroll mapping from About's normalised journey to a fixed rate.
      scroll?.setMode(to.route.mode);
      // The router has already swapped #app's contents, so the milestone
      // buttons this binds to are the ones now in the document.
      if (to.route.mode === "full") about?.mount(container);
      else about?.unmount();
      if (!beach) return;
      // §12: reduced motion gets About in focus-mode styling too — static,
      // desaturated, no camera motion — rather than a slower version of the
      // live scene.
      const pull = beach.reducedMotion || to.route.mode === "focus" ? 1 : 0;
      // §10: deep links skip the animation. `from === null` is exactly that
      // case — the first render of the session, with no route to come from,
      // so there is no transition to play.
      beach.setFocus(pull, from === null || beach.reducedMotion);
    },
  });

  // The router renders whatever the address bar already says, which is what
  // makes a deep link land directly in focus mode without playing a
  // transition it never entered from (§10).
  router.start();

  // __staticPaths is read by tools/prerender.mjs so the route list has a
  // single source: adding a project cannot leave its page unprerendered.
  Object.assign(window, {
    __beach: beach, __scroll: scroll, __about: about,
    __router: router, __staticPaths: STATIC_PATHS,
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
