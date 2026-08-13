/**
 * The hero carve — PRD §8.1.
 *
 * "Title carved in sand. Presses in on load, holds, erodes. Scrolling away
 * accelerates decay; scrolling back re-presses."
 *
 * Two things about how that is built here.
 *
 * **The carve sits UNDER the real <h1>, not instead of it.** The DOM title
 * stays visible and the sand carries an impression of it, which is why the
 * mask is rasterized from the same face, weight and letter-spacing as the h1
 * in type.css — the two are stacked, so any disagreement between them reads
 * immediately as a misprint rather than as a shadow.
 *
 * **The carve is placed in world space, not screen space.** It is written into
 * the sand field, and the field is a clipmap that travels with the camera. A
 * title pinned to the viewport would drag its own trench up the beach as you
 * scrolled. Pinned to the world, it stays where it was pressed, recedes as the
 * camera retreats, and eventually leaves the patch entirely — at which point
 * the sand it occupied is gone, and scrolling back genuinely re-presses it
 * rather than revealing it. That is the §8.1 behaviour falling out of the
 * clipmap rather than being animated on top of it.
 */

import type { MaskStamp, TextMaskOptions } from "../sand/mask";
import { DEFAULT_TEXT_MASK, TextMask, displayFontReady } from "../sand/mask";

export interface HeroCarveOptions {
  /**
   * World Z of the carve's centre.
   *
   * Above the swash, deliberately. §7.3 measures the reach at up to 1.7× the
   * nominal figure with `swashLateral` at 0.7, so water gets to z≈1.76 — and
   * §7.6 is blunt that nothing persists below that. A title centred any lower
   * would be scrubbed by the first wave, which is a fine effect and the wrong
   * one for the thing carrying the visitor's first impression.
   */
  centerZ: number;
  /** World half-width. Half-depth is derived from the mask's own aspect. */
  halfWidth: number;
  depth: number;
  rim: number;
  /**
   * Seconds the carve holds before the wind starts on it. Long, because §8.1
   * wants it to *hold* — an ordinary mark's 1.2s would have the title
   * softening while the page was still settling.
   */
  fillDelay: number;
  /** Seconds the press ramps in over on load. */
  attack: number;
  /**
   * Seconds at full pressure before the release. The stamp is target-based, so
   * holding does not dig — it converges, and this is how long it stays
   * converged before the sand is handed back to the wind.
   */
  hold: number;
  /** Seconds the press falls away over, once the hold is up. */
  release: number;
  /**
   * Scroll fraction at which the carve is fully lifted. Past this the hero has
   * left the viewport, and §8.1 wants the decay to accelerate rather than the
   * title to sit there pristine behind the next section.
   */
  scrollOut: number;
}

export const DEFAULT_HERO: HeroCarveOptions = {
  centerZ: 2.7,
  halfWidth: 1.15,
  depth: 0.42,
  rim: 0.45,
  fillDelay: 6,
  attack: 0.7,
  hold: 2.6,
  release: 1.8,
  scrollOut: 0.16,
};

export class HeroCarve {
  private readonly mask: TextMask;
  private text = "";
  private rasterized = false;
  /** Seconds since the carve was armed. Drives attack, hold and release. */
  private age = 0;
  /** 0..1, eased. What actually reaches the shader as pressure. */
  private press = 0;
  /** Set by the page each frame: how far the hero has scrolled away, 0..1. */
  private away = 0;

  constructor(
    gl: WebGL2RenderingContext,
    private readonly opts: HeroCarveOptions = DEFAULT_HERO,
  ) {
    this.mask = new TextMask(gl);
  }

  /**
   * Rasterizes the title. Awaits the display face first — §5 fixes the display
   * type as Mattone, and a carve is not a render that can be redone next
   * frame: it is written into a persistent field, so a mask rasterized in the
   * fallback face would sit in the sand until the wind took it.
   */
  async arm(text: string, opts: TextMaskOptions = DEFAULT_TEXT_MASK): Promise<boolean> {
    this.text = text;
    const loaded = await displayFontReady(opts);
    if (!loaded) {
      // The face never arrived. Carving the fallback would be a different
      // design pressed permanently into the beach, so this carves nothing and
      // leaves the DOM title to stand on its own — which it already does.
      console.warn(`[hero] ${opts.family} unavailable — skipping the carve`);
      return false;
    }
    this.rasterized = this.mask.render(text, opts);
    this.age = 0;
    this.press = 0;
    return this.rasterized;
  }

  /** Re-presses from the top of the envelope. Scrolling back calls this. */
  rearm(): void {
    this.age = 0;
  }

  get armed(): boolean {
    return this.rasterized;
  }

  /**
   * How far the hero has scrolled out of view, 0..1. The page owns this
   * because the page owns the scroll — the carve should not be reaching into
   * the document to measure a section it does not own.
   */
  setAway(away: number): void {
    this.away = Math.min(1, Math.max(0, away));
  }

  update(dt: number): void {
    this.age += dt;
    const { attack, hold, release, scrollOut } = this.opts;

    // The load envelope: in, hold, out. Written as a target the press eases
    // toward rather than as a scripted keyframe timeline, for the same reason
    // the focus pull is (see FOCUS_RATE in beach.ts) — it has to be
    // interruptible. Scrolling back mid-release must re-press from wherever
    // the release actually got to, not restart an animation.
    let envelope: number;
    if (this.age < attack) envelope = this.age / Math.max(attack, 1e-4);
    else if (this.age < attack + hold) envelope = 1;
    else envelope = Math.max(0, 1 - (this.age - attack - hold) / Math.max(release, 1e-4));

    // Scrolling away lifts the press outright. Not a second decay curve on top
    // of the envelope: the sand already has one, and §6.2's transport is what
    // §8.1 means by "decay". Lifting the stamp hands the mark back to the wind,
    // and the wind is the thing that erodes it.
    const target = envelope * (1 - Math.min(1, this.away / Math.max(scrollOut, 1e-4)));
    this.press += (target - this.press) * (1 - Math.exp(-9 * dt));
    if (this.press < 0.004) this.press = 0;
  }

  /** The stamp for this frame, or null when there is nothing pressing. */
  stamp(): MaskStamp | null {
    if (!this.rasterized || this.press <= 0) return null;
    const tex = this.mask.texture;
    if (!tex) return null;
    const { halfWidth, centerZ, depth, rim, fillDelay } = this.opts;
    return {
      texture: tex,
      center: [0, centerZ],
      // Half-depth from the mask's own aspect, so the type is never stretched.
      // Getting this wrong is invisible on a grazing camera until it is not:
      // the foreshortening hides a few percent of skew and then suddenly does
      // not, at the top of the scroll where the carve is closest to square on.
      half: [halfWidth, halfWidth / Math.max(this.mask.aspect, 1e-3)],
      pressure: this.press,
      depth,
      rim,
      fillDelay,
    };
  }

  /** Diagnostic — read by the smoke test to assert the carve is live. */
  get pressure(): number {
    return this.press;
  }

  get label(): string {
    return this.text;
  }

  dispose(): void {
    this.mask.dispose();
  }
}
