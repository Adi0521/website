/**
 * Scroll-driven camera — the Phase 2 gap.
 *
 * Scroll owns the camera (PRD §3). Scrolling down retreats **up the dry
 * beach**, away from the water, with a slow azimuth arc across the travel.
 *
 * Two things fall out of going up rather than down. §7.6 says the swash zone
 * is where nothing persists, so travelling away from the waterline means every
 * station past the start sits on sand that keeps its marks — the sections that
 * would have been scrubbed by every wave are the ones we never visit. And the
 * waterline recedes as you go, so §8.2's milestones can genuinely run toward
 * the horizon rather than being laid out sideways.
 *
 * The arc is not the autonomous rotation §3 rules out. That objection is about
 * an orbit *fighting* the scroll and making text placement unstable; an arc the
 * scroll owns is a pure function of scroll position, so a section lands with
 * the camera pointing the same way every time. It stays small regardless.
 */

import type { Beach } from "./beach";
import { beachHeight } from "./sand/params";

export interface ScrollCameraOptions {
  /**
   * World Z at the top of the page. Clear of the swash zone, and that bound
   * moved: with `swashLateral` at 0.7 the reach varies up to 1.7× along the
   * beach, so the water now gets to z≈1.76 rather than z≈1.0. A station inside
   * that has its sand wiped by every wave (§7.6).
   */
  startZ: number;
  /**
   * World Z at the bottom of the page.
   *
   * Bounded by the ramp, not by taste. `beachY` clamps at 0.9, so the beach
   * stops rising at z≈10.6, and the camera sits ~2.9 further back than its
   * target — meaning an endZ above ~7.7 puts the *eye* over flat ground and
   * the near foreground turns into a shelf. Raise it past that only if you
   * want the plateau.
   */
  endZ: number;
  /** Radians of azimuth swept across the whole page. Keep it small. */
  arc: number;
  /**
   * Smoothing rate per second. Scroll input is coarse and bursty — trackpad
   * momentum, wheel notches, a dragged scrollbar — and driving the camera from
   * it raw reads as juddering rather than travelling.
   */
  ease: number;
}

export const DEFAULT_SCROLL: ScrollCameraOptions = {
  startZ: 2.0,
  // As far as the ramp allows. The eye trails ~2.82 behind the target and the
  // beach stops rising at z≈10.59, so 7.6 is within 0.1 of the point where the
  // foreground turns into a shelf. Getting materially more travel than this
  // means raising `beachY`'s 0.9 clamp, not raising this number.
  endZ: 7.6,
  arc: 0.18, // ~10° end to end
  ease: 6,
};

export class ScrollCamera {
  /** Scroll progress the page is asking for, 0..1. */
  private wanted = 0;
  /** Where the camera actually is, easing toward `wanted`. */
  private at = 0;
  private readonly baseAzimuth: number;
  private detach: (() => void) | null = null;

  constructor(
    private readonly beach: Beach,
    private readonly opts: ScrollCameraOptions = DEFAULT_SCROLL,
  ) {
    this.baseAzimuth = beach.camera.azimuth;
    const onScroll = () => this.read();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    this.detach = () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
    };
    this.read();
    // Land on the deep-linked position rather than gliding to it from the top.
    this.at = this.wanted;
    this.apply();
  }

  private read(): void {
    const range = document.documentElement.scrollHeight - innerHeight;
    this.wanted = range > 0 ? Math.min(1, Math.max(0, scrollY / range)) : 0;
  }

  /** Call once per frame with real elapsed seconds. */
  update(dt: number): void {
    // Frame-rate independent: a fixed per-frame lerp would ease faster on a
    // 120Hz display than a 60Hz one, so the same page would feel different on
    // two machines.
    const k = 1 - Math.exp(-this.opts.ease * dt);
    this.at += (this.wanted - this.at) * k;
    this.apply();
  }

  private apply(): void {
    const { startZ, endZ, arc } = this.opts;
    const z = startZ + (endZ - startZ) * this.at;
    const cam = this.beach.camera;
    // The look-at point rides the ramp. Left at y=0 the camera would be
    // underground by the top of the beach — the sand is at y=0.85 by z=10 and
    // the eye sits only 0.66 above its target.
    cam.target = [0, beachHeight(z, this.beach.config.water), z];
    cam.azimuth = this.baseAzimuth + (this.at - 0.5) * arc;
  }

  dispose(): void {
    this.detach?.();
    this.detach = null;
  }
}
