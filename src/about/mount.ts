/**
 * Binds the About DOM to the sand — PRD §8.1.
 *
 * This is the only place the scene reaches into the document, and it is
 * deliberately one-way: the DOM is the source of truth for what the title
 * says, and the sand reacts to it. §12 requires the page to stand as real text
 * with the canvas removed, so nothing here generates content.
 *
 * Today that is the hero carve alone. §8.2's footprint trail is content-only
 * until the hover work — see src/about/milestones.ts for why building it now
 * would reintroduce a bug rather than a feature.
 *
 * Mounted and unmounted by the router, because About's DOM does not exist on a
 * focus page. The carve keeps its state across that, so navigating away and
 * back does not re-run the load envelope — §10's continuity argument applied
 * to the title.
 */

import type { Beach } from "../beach";
import { HeroCarve } from "./hero";

export class AboutStations {
  private readonly hero: HeroCarve;
  private detach: (() => void) | null = null;
  /** True while About's DOM is in the document. */
  private live = false;
  /** How far the hero has scrolled out of view, 0..1. */
  private away = 0;
  /** The same, as of the previous frame, so re-entry is detected as an edge. */
  private prevAway = 0;

  constructor(private readonly beach: Beach) {
    this.hero = new HeroCarve(beach.gl);
    // Installed for the life of the session and goes quiet when About is not
    // mounted. Installing and removing it on every navigation would mean the
    // field could take a stamp from a station already torn down, one frame on.
    beach.maskStamp = () => (this.live ? this.hero.stamp() : null);
  }

  /**
   * Called by the router once About's DOM is in the document.
   *
   * Re-binding rather than binding once: the router replaces `#app` wholesale
   * on every navigation, so the elements this measures are new each time.
   */
  mount(container: HTMLElement): void {
    this.unbind();
    this.live = true;

    const title = container.querySelector<HTMLElement>("[data-carve]");
    if (title && title.textContent) {
      const text = title.textContent.trim();
      // Only re-rasterize when the string actually changed. Re-arming on every
      // return to About would restart the press envelope and re-carve a title
      // already sitting in the sand.
      if (!this.hero.armed || this.hero.label !== text) {
        void this.hero.arm(text);
      }
    }

    const hero = container.querySelector<HTMLElement>(".hero");
    const onScroll = () => this.readScroll(hero);
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    this.readScroll(hero);
    this.detach = () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
    };
  }

  /** Called by the router before About's DOM is replaced. */
  unmount(): void {
    this.live = false;
    this.unbind();
  }

  private unbind(): void {
    this.detach?.();
    this.detach = null;
  }

  /**
   * How far the hero has scrolled out of view, as a fraction of its own
   * height.
   *
   * Measured off the hero element rather than off the document, so it does not
   * silently change meaning when a section is added below. It is also NOT the
   * number the scroll camera uses: that one is normalised over the whole page
   * because it maps the whole journey up the beach (see scroll.ts), while this
   * is local to one section.
   */
  private readScroll(hero: HTMLElement | null): void {
    if (!hero) {
      this.away = 0;
      return;
    }
    const rect = hero.getBoundingClientRect();
    // 0 while the hero's top is at or below the viewport top; 1 once a full
    // hero-height has passed above it.
    this.away = Math.min(1, Math.max(0, -rect.top / Math.max(rect.height, 1)));
  }

  /**
   * Advances the carve. Driven from `Beach.onFrame`, so it runs on the same
   * clock as the camera and gets real elapsed seconds rather than the clamped
   * simulation dt.
   */
  update(dt: number): void {
    if (!this.live) return;
    // Scrolling back re-presses (§8.1). Restarted on the EDGE back into view,
    // not while the hero is merely visible — re-arming every frame would pin
    // the envelope at its attack and the title would never reach the hold, let
    // alone erode out of it.
    if (this.prevAway >= 1 && this.away < 1) this.hero.rearm();
    this.prevAway = this.away;
    this.hero.setAway(this.away);
    this.hero.update(dt);
  }

  /** Diagnostics for the smoke test. */
  get state(): { carve: number; away: number } {
    return { carve: this.hero.pressure, away: this.away };
  }

  dispose(): void {
    this.unbind();
    this.hero.dispose();
    this.beach.maskStamp = null;
  }
}
