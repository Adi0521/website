/**
 * Binds the About DOM to the scene — PRD §8.1.
 *
 * One-way, deliberately: the <h1> is the source of truth for what the name says
 * and how big it is, and the sculpture is rasterized from it. §12 requires the
 * page to stand as real text with the canvas removed, so nothing here generates
 * content — the heading IS the content, and the scene is measured off it.
 *
 * §8.2's footprint trail stays content-only until the hover work; see
 * src/about/milestones.ts for why building it now would reintroduce a bug
 * rather than a feature.
 */

import type { Beach } from "../beach";
import { HeroName, DEFAULT_HERO } from "./hero";
import { beachHeight } from "../sand/params";

export class AboutStations {
  private readonly hero: HeroName;
  private detach: (() => void) | null = null;
  /** True while About's DOM is in the document. */
  private live = false;
  /** The heading the mask is built from, while it is in the document. */
  private el: HTMLElement | null = null;
  /** Set when the element had no layout yet, so the build has to be retried. */
  private pending = false;

  constructor(private readonly beach: Beach) {
    this.hero = new HeroName(beach.gl);
    // Installed for the life of the session and goes quiet when About is not
    // mounted. Installing and removing it per navigation would let the renderer
    // read a prop from a station already torn down, one frame later.
    beach.textProp = () => (this.hero.ready ? this.hero.prop() : null);
  }

  /**
   * Called by the router once About's DOM is in the document.
   *
   * Re-binding rather than binding once: the router replaces `#app` wholesale
   * on every navigation, so the element measured here is a new one each time.
   */
  mount(container: HTMLElement): void {
    this.unbind();
    this.live = true;
    this.el = container.querySelector<HTMLElement>("[data-carve]");
    this.pending = true;
    this.rebuild();

    // Rebuilt on resize, because the heading is `clamp(2.5rem, 9vw, 6rem)` —
    // its size is a function of the viewport, so the sculpture has to be too,
    // or the name stops matching the element it was measured from.
    const onResize = () => {
      this.pending = true;
    };
    addEventListener("resize", onResize);
    this.detach = () => removeEventListener("resize", onResize);

    // Fonts arriving late change the metrics under us. §5 fixes the display
    // face as Mattone, and a mask rasterized before it loads is the fallback
    // face standing in the scene — permanently, since nothing rebuilds it.
    if ("fonts" in document) {
      void document.fonts.ready.then(() => {
        this.pending = true;
      });
    }
  }

  /** Called by the router before About's DOM is replaced. */
  unmount(): void {
    this.live = false;
    this.el = null;
    this.unbind();
  }

  private unbind(): void {
    this.detach?.();
    this.detach = null;
  }

  /**
   * Rasterizes the mask, if the element has a box to measure yet.
   *
   * A heading with no layout is a real state during a route change rather than
   * an error — `offsetWidth` is 0 until the browser has laid the new DOM out —
   * so this leaves `pending` set and the frame loop tries again.
   */
  private rebuild(): void {
    if (!this.live || !this.el) return;
    const sand = beachHeight(DEFAULT_HERO.z, this.beach.config.water);
    if (this.hero.build(this.el, sand)) this.pending = false;
  }

  /**
   * Driven from `Beach.onFrame`, so it runs on the same clock as the camera.
   *
   * The only per-frame work is turning the quad to face the viewer. The mask
   * itself is rebuilt only when something it was measured from has changed.
   */
  update(): void {
    if (!this.live) return;
    if (this.pending) this.rebuild();
    if (this.hero.ready) this.hero.orient(this.beach.basis);
  }

  /** Diagnostics for the smoke test. */
  get state(): { ready: boolean; label: string } {
    return { ready: this.hero.ready, label: this.hero.label };
  }

  dispose(): void {
    this.unbind();
    this.hero.dispose();
    this.beach.textProp = null;
  }
}
