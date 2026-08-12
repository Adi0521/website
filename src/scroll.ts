/**
 * Scroll-driven camera — the Phase 2 gap.
 *
 * Scroll owns the camera (PRD §3). Scrolling down retreats **up the dry
 * beach**, away from the water, with a slow azimuth arc across the travel.
 *
 * Two things fall out of going up rather than down. §7.6 says the swash zone
 * is where nothing persists, so travelling away from the waterline means every
 * station past the start sits on sand that keeps its marks. And the waterline
 * recedes as you go, so §8.2's milestones can genuinely run toward the horizon.
 *
 * The arc is not the autonomous rotation §3 rules out. That objection is about
 * an orbit *fighting* the scroll; an arc the scroll owns is a pure function of
 * scroll position, so a section lands with the camera pointing the same way
 * every time.
 *
 * ── Two mappings, not one ──────────────────────────────────────────────────
 *
 * About normalises: its scroll track is designed, and its whole length maps to
 * the whole journey up the beach.
 *
 * Focus pages must NOT do that. Normalising divides by the page's own scroll
 * range, so a short page has a tiny denominator and a flick of the wheel drags
 * the camera the entire length of the beach — the shorter the page, the more
 * violent the background. They get a fixed rate instead: a fixed number of
 * world units per screenful scrolled, so the movement is proportional to how
 * much there is to read, which is what it should have been measuring all along.
 *
 * And they start from wherever the beach already was. Entering a focus page
 * used to snap the camera back to `startZ` — normalised scroll of a short page
 * is ~0, so the camera slid all the way back down the beach behind the text.
 */

import type { Beach } from "./beach";
import { beachHeight } from "./sand/params";

export type ScrollMode = "full" | "focus";

export interface ScrollCameraOptions {
  /**
   * World Z at the top of the page. Clear of the swash zone: with
   * `swashLateral` at 0.7 the reach varies up to 1.7×, so water gets to
   * z≈1.76 rather than z≈1.0, and a station inside that is wiped every wave.
   */
  startZ: number;
  /**
   * World Z at the bottom of the page.
   *
   * Bounded by the ramp, not by taste. `beachY` clamps at 0.9, so the beach
   * stops rising at z≈10.59, and the eye trails ~2.82 behind its target —
   * above ~7.7 the eye is over flat ground and the near foreground turns into
   * a shelf. Raise it past that only if you want the plateau.
   */
  endZ: number;
  /** Radians of azimuth swept across About. Keep it small. */
  arc: number;
  /**
   * World units the camera travels per screenful scrolled on a FOCUS page.
   * About covers ~1.3 units a screen, so this is a little under half its pace.
   */
  focusTravelPerScreen: number;
  /**
   * Smoothing rate per second. Scroll input is coarse and bursty — trackpad
   * momentum, wheel notches, a dragged scrollbar — and driving the camera from
   * it raw reads as juddering rather than travelling.
   */
  ease: number;
}

export const DEFAULT_SCROLL: ScrollCameraOptions = {
  startZ: 2.0,
  endZ: 7.6,
  arc: 0.18, // ~10° end to end
  focusTravelPerScreen: 0.5,
  ease: 6,
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export class ScrollCamera {
  /** Where the page is asking the camera to be, in world Z. */
  private wantedZ: number;
  private wantedAz: number;
  /** Where it actually is, easing toward the above. */
  private atZ: number;
  private atAz: number;

  private mode: ScrollMode = "full";
  /** Camera Z at scrollY 0 for the current route. Only moves on a mode change. */
  private anchorZ: number;
  private anchorAz: number;

  private readonly baseAzimuth: number;
  private detach: (() => void) | null = null;

  constructor(
    private readonly beach: Beach,
    private readonly opts: ScrollCameraOptions = DEFAULT_SCROLL,
  ) {
    this.baseAzimuth = beach.camera.azimuth;
    this.anchorZ = opts.startZ;
    this.anchorAz = this.baseAzimuth;
    this.wantedZ = this.atZ = opts.startZ;
    this.wantedAz = this.atAz = this.baseAzimuth;

    const onScroll = () => this.read();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    this.detach = () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
    };
    this.read();
    // Land on the deep-linked position rather than gliding to it from the top.
    this.atZ = this.wantedZ;
    this.atAz = this.wantedAz;
    this.apply();
  }

  /**
   * Called by the router. Switching INTO focus anchors the camera where it
   * currently is, so the beach stays put behind the text instead of sliding
   * back down to the start of the journey.
   */
  setMode(mode: ScrollMode): void {
    if (mode === this.mode) return;
    if (mode === "focus") {
      this.anchorZ = this.atZ;
      this.anchorAz = this.atAz;
    }
    this.mode = mode;
    this.read();
  }

  private read(): void {
    const { startZ, endZ, arc, focusTravelPerScreen } = this.opts;
    if (this.mode === "full") {
      const range = document.documentElement.scrollHeight - innerHeight;
      const p = range > 0 ? clamp(scrollY / range, 0, 1) : 0;
      this.wantedZ = startZ + (endZ - startZ) * p;
      this.wantedAz = this.baseAzimuth + (p - 0.5) * arc;
    } else {
      // Per screenful, not per page — so the camera moves in proportion to how
      // much there is to read rather than in proportion to how little.
      const perPixel = focusTravelPerScreen / Math.max(innerHeight, 1);
      this.wantedZ = clamp(this.anchorZ + scrollY * perPixel, startZ, endZ);
      this.wantedAz = this.anchorAz;
    }
  }

  /** Call once per frame with real elapsed seconds. */
  update(dt: number): void {
    // Frame-rate independent: a fixed per-frame lerp would ease faster on a
    // 120Hz display than a 60Hz one, so the same page would feel different on
    // two machines.
    const k = 1 - Math.exp(-this.opts.ease * dt);
    this.atZ += (this.wantedZ - this.atZ) * k;
    this.atAz += (this.wantedAz - this.atAz) * k;
    this.apply();
  }

  private apply(): void {
    const cam = this.beach.camera;
    // The look-at point rides the ramp. Left at y=0 the camera would be
    // underground by the top of the beach — the sand is at y=0.85 by z=10 and
    // the eye sits only 0.66 above its target.
    cam.target = [0, beachHeight(this.atZ, this.beach.config.water), this.atZ];
    cam.azimuth = this.atAz;
  }

  dispose(): void {
    this.detach?.();
    this.detach = null;
  }
}
