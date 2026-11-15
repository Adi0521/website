/**
 * Binds the About DOM to the scene — PRD §8.1.
 *
 * One-way, deliberately: the <h1> is the source of truth for what the name says
 * and how big it is, and the sculpture is rasterized from it. §12 requires the
 * page to stand as real text with the canvas removed, so nothing here generates
 * content — the heading IS the content, and the scene is measured off it.
 *
 * §8.2's footprint trail is pressed into the sand as one mask stamp — see
 * src/about/trail.ts for why that, and not the pointer's brush. The hover and
 * scrub behaviour is not built yet; the list stays plain content until it is.
 * The trail starts at a wooden signpost cut from the "Timeline" heading
 * (src/about/sign.ts), the same one-way binding the name uses.
 */

import type { Beach } from "../beach";
import { HeroName, DEFAULT_HERO } from "./hero";
import { FootprintTrail } from "./trail";
import { SignPosts } from "./sign";
import { MILESTONES } from "./milestones";
import { beachHeight } from "../sand/params";
import { DEFAULT_SCROLL } from "../scroll";
import { DEFAULT_CAMERA } from "../beach";

export class AboutStations {
  private readonly hero: HeroName;
  private readonly trail: FootprintTrail;
  private readonly signs: SignPosts;
  private lastFrame = performance.now();
  /** The scroll being read, or -1; and whether it is on its way back. */
  private reading = -1;
  private closing = false;
  /** The "Timeline" heading the sign's word is cut from. */
  private signEl: HTMLElement | null = null;
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

    // The trail does not depend on the DOM, so it is built once. It presses
    // only while About is mounted: off About the prints are left to the wind,
    // and coming back presses them in again. (Focus pages suppress the mask
    // anyway — see Beach — since §10 takes no new marks there.)
    this.trail = new FootprintTrail(beach.gl);
    this.trail.build(MILESTONES);
    beach.maskStamp = () => (this.live ? this.trail.stamp() : null);

    // Like the name, the sign stays put across navigation (it is part of the
    // scene, not a mark), and is rebuilt from the heading on each mount.
    this.signs = new SignPosts(beach.gl);
    beach.signProp = () => this.signs.set;
    // Clicking a milestone scroll unrolls it and the camera glides in to
    // read it; while reading, a click anywhere glides back out and rolls it
    // up again. Only while About is showing.
    beach.picker = (ro, rd, click) => {
      if (!this.live) return false;
      if (this.reading >= 0) {
        if (click) this.closing = true;
        return true;
      }
      const i = this.signs.pick(ro, rd);
      if (i < 0) return false;
      if (click) {
        const view = this.signs.zoomView(i, beach.camera.fovDeg);
        if (view) {
          this.reading = i;
          this.closing = false;
          this.signs.setTarget(i, 1);
          beach.zoomView = view;
        }
      }
      return true;
    };
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
    this.signEl = container.querySelector<HTMLElement>("#timeline-h");
    this.pending = true;
    this.rebuild();

    // Rebuilt on resize, because the heading is `clamp(2.5rem, 9vw, 6rem)` —
    // its size is a function of the viewport, so the sculpture has to be too,
    // or the name stops matching the element it was measured from.
    const onResize = () => {
      this.pending = true;
    };
    addEventListener("resize", onResize);
    // Scrolling the page, or Escape, while reading a scroll leaves it.
    const leave = () => {
      if (this.reading >= 0) this.closing = true;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") leave();
    };
    addEventListener("scroll", leave, { passive: true });
    addEventListener("keydown", onKey);
    this.detach = () => {
      removeEventListener("resize", onResize);
      removeEventListener("scroll", leave);
      removeEventListener("keydown", onKey);
    };

    // Fonts arriving late change the metrics under us. §5 fixes the display
    // face as Mattone, and a mask rasterized before it loads is the fallback
    // face standing in the scene — permanently, since nothing rebuilds it.
    if ("fonts" in document) {
      void document.fonts.ready.then(() => {
        this.pending = true;
      });
    }
  }

  /**
   * The read sequence, in order: unroll, THEN glide in once the page is
   * mostly open; on the way back, glide out, THEN roll up once the camera has
   * mostly pulled away — so neither motion hides the other.
   */
  private stepReading(): void {
    const i = this.reading;
    if (i < 0) return;
    if (!this.closing) {
      if (this.signs.openness(i) > 0.75) this.beach.zoomTarget = 1;
      return;
    }
    this.beach.zoomTarget = 0;
    if (this.beach.zoomAmount < 0.35) this.signs.setTarget(i, 0);
    if (this.beach.zoomAmount <= 0 && this.signs.openness(i) <= 0) {
      this.reading = -1;
      this.closing = false;
      this.beach.zoomView = null;
    }
  }

  /** Called by the router before About's DOM is replaced. */
  unmount(): void {
    // Leaving mid-read: drop the close-up at once and roll the page back up.
    if (this.reading >= 0) {
      this.signs.setTarget(this.reading, 0);
      this.reading = -1;
      this.closing = false;
      this.beach.resetZoom();
    }
    this.live = false;
    this.el = null;
    this.signEl = null;
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
    const water = this.beach.config.water;
    const sand = beachHeight(DEFAULT_HERO.z, water);
    // The signs have no layout dependency, only a font one, so they are
    // simply rebuilt whenever the name is (and again when their face loads).
    this.signs.build(this.signEl, MILESTONES, (z) => beachHeight(z, water));
    if (this.hero.build(this.el, sand, water.seaLevel, aimX(DEFAULT_HERO.z))) this.pending = false;
  }

  /**
   * Driven from `Beach.onFrame`, so it runs on the same clock as the camera.
   *
   * The only per-frame work is turning the quad to face the viewer. The mask
   * itself is rebuilt only when something it was measured from has changed.
   */
  update(): void {
    if (!this.live) return;
    const now = performance.now();
    this.signs.animate(Math.min(0.1, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.stepReading();
    if (this.signs.stale) {
      this.signs.stale = false;
      this.pending = true;
    }
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
    this.trail.dispose();
    this.signs.dispose();
    this.beach.textProp = null;
    this.beach.signProp = null;
    this.beach.picker = null;
    this.beach.maskStamp = null;
  }
}

/**
 * World x where the middle of the screen crosses depth `z`, with the camera as
 * it is at the top of the page — which is where the name is seen first.
 *
 * The camera looks slightly sideways (its azimuth is not π/2), so world x = 0
 * is not quite screen centre away from the camera target; a name stood off the
 * target drifts sideways in frame.
 * Derived from the camera and scroll settings rather than tuned by eye, so
 * changing either keeps the name centred.
 */
function aimX(z: number): number {
  const az = DEFAULT_CAMERA.azimuth - DEFAULT_SCROLL.arc / 2; // scroll position 0
  const target = DEFAULT_CAMERA.target;
  const startZ = DEFAULT_SCROLL.startZ;
  // The eye sits at target + (cos az, sin az)·r, looking back through target.
  return target[0] + ((z - startZ) * Math.cos(az)) / Math.sin(az);
}
