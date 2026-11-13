/**
 * The name as a sand structure — PRD §8.1, ported from prototype/hero-name.html.
 *
 * §8.1 says "title carved in sand… presses in on load, holds, erodes", and the
 * first build did exactly that: a mask stamped into the heightfield, an
 * impression lying flat on the ground. This is the other reading of the same
 * sentence — the name SCULPTED from sand rather than pressed into it, standing
 * on the beach as a slab with real thickness and real side walls, lit by the
 * same sun as the ground it stands on.
 *
 * ── The mask comes from the DOM, not from a font call ──────────────────────
 *
 * The <h1> is laid out by real CSS, and the mask is rasterized from THAT — its
 * computed font, weight, size and letter-spacing, at its own measured box. Two
 * things follow, and both matter more than the convenience:
 *
 * - The heading stays the single source of truth. §12 wants real text in the
 *   document, focusable, announced and crawlable; here that same element is
 *   also what the scene is built from, so the two cannot drift apart.
 * - Whatever CSS does — a breakpoint, a different clamp, a font that loads
 *   late — the sculpture follows, because it is measured rather than declared.
 *
 * The element then goes transparent rather than away: it keeps its layout (the
 * mask is measured from it) and its place in the accessibility tree.
 */

import type { CameraBasis } from "../gl/camera";

export interface HeroNameOptions {
  /** World width of the name. Height follows from the element's aspect. */
  width: number;
  /** World Z it stands at. */
  z: number;
  /**
   * Lean back from upright, radians.
   *
   * Upright keeps the name readable but throws a long raking shadow; flat makes
   * the shadow legible and the letters foreshortened. §5's grazing sun makes
   * this a real trade rather than a detail.
   */
  tilt: number;
  /** Half thickness of the slab, world units. */
  thickness: number;
  /** How far the bottom edge sinks below the sand line, world units. */
  sink: number;
  /** The least the baseline may sit above still water, world units. */
  rise: number;

  /** Coverage above this counts as solid. */
  cut: number;
  /**
   * Extra mip levels on the solid.
   *
   * The weathering dial, and it works by FILTERING rather than by displacing:
   * a coarser mip rounds the letterforms off the way wind and salt would. An
   * earlier attempt got this texture by displacing a distance field, which is
   * what made rays tunnel through the geometry — this cannot, because the
   * silhouette is still a clean threshold of a prefiltered image.
   */
  erode: number;
  /** Shadow penumbra rate, and how dark the shadow gets. */
  soft: number;
  strength: number;
  /** Mask supersample. 2 is enough once the mip chain does the filtering. */
  supersample: number;
  /** World units the letter edges wander by. Crumbles the outline. */
  crumble: number;
  /** Strength of the rocky surface texture (pits, layers, lumps, grit). */
  relief: number;
}

export const DEFAULT_HERO: HeroNameOptions = {
  // The width of the name's ink, world units — ~70% of the frame at this depth.
  width: 2.3,
  // In the shallow surf, just past the shoreline (z = 0). The seabed here is
  // ~6cm under still water, so waves wash round the base of the letters.
  z: -0.7,
  tilt: 0.16,
  thickness: 0.045,
  // How far the baseline sits into the seabed.
  sink: 0.012,
  // ...but at least this far above still water. The swash runs ~10-15cm up
  // here while a wave is in, and the letters are only ~25cm tall, so stood on
  // the seabed half of each one went under. Below the baseline each letter
  // carries on straight down into the seabed (see build), so a trough never
  // shows it hovering.
  rise: 0.03,
  cut: 0.5,
  erode: 0.35,
  soft: 0.05,
  strength: 0.92,
  supersample: 2,
  crumble: 0.008,
  relief: 1.0,
};

/** Everything render.frag needs to march and shade the name. */
export interface TextProp {
  texture: WebGLTexture;
  centre: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
  normal: [number, number, number];
  halfW: number;
  halfH: number;
  thickness: number;
  /** Mask width in texels, for deriving mip levels. */
  px: number;
  /**
   * False draws only the name's shadow, not the letters. Diagnostic: lets the
   * smoke test measure the cast shadow without the letters' own (deliberately
   * pitted) surface counting as shadow.
   */
  solid?: boolean;
  cut: number;
  erode: number;
  soft: number;
  strength: number;
  crumble: number;
  relief: number;
}

export class HeroName {
  private tex: WebGLTexture | null = null;
  private maskPx = 1;
  private text = "";

  private centre: [number, number, number] = [0, 0, 0];
  private right: [number, number, number] = [1, 0, 0];
  private up: [number, number, number] = [0, 1, 0];
  private normal: [number, number, number] = [0, 0, 1];
  private halfW = 1;
  private halfH = 0.2;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly opts: HeroNameOptions = DEFAULT_HERO,
  ) {}

  get ready(): boolean {
    return this.tex !== null;
  }

  get label(): string {
    return this.text;
  }

  /**
   * Rasterizes the mask from `el`'s text and stands it on the beach.
   *
   * Sized from the font's own metrics, not from the element's box: the <h1> is
   * a block that stretches to the whole column (which stretched the letters
   * sideways when the box was used), and a two-word name can wrap inside it.
   * The scene always sets the name on one line.
   *
   * `sandY` is the beach (or seabed) height at the name's z, `seaY` still
   * water, and `x` the world x it is centred on.
   *
   * Returns false when the element has no layout yet — which is a real state
   * during a route change, not an error. The caller retries.
   */
  build(el: HTMLElement, sandY: number, seaY: number, x: number): boolean {
    const label = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (el.offsetHeight < 4 || !label) return false;
    this.text = label;

    const cs = getComputedStyle(el);
    const R = Math.max(1, this.opts.supersample);
    const fpx = parseFloat(cs.fontSize) * R;
    const setup = (g: CanvasRenderingContext2D) => {
      g.font = `${cs.fontWeight} ${fpx}px ${cs.fontFamily}`;
      try {
        g.letterSpacing = cs.letterSpacing;
      } catch {
        // Not every engine exposes it; the spacing then falls back to the face's.
      }
      g.textAlign = "center";
      g.textBaseline = "alphabetic";
    };
    const probe = document.createElement("canvas").getContext("2d");
    if (!probe) return false;
    setup(probe);
    const m = probe.measureText(label);
    const inkW = m.width;
    if (inkW < 4) return false;
    const asc = m.actualBoundingBoxAscent || fpx * 0.75;
    const desc = m.actualBoundingBoxDescent || 0;

    // World units per canvas pixel. `width` is the width of the ink itself.
    const pxToWorld = this.opts.width / inkW;
    // Stood on the bed: the baseline sits `sink` into it, but at least `rise`
    // above still water.
    const bed = sandY - this.opts.sink;
    const base = Math.max(bed, seaY + this.opts.rise);
    // How far the letters have to carry on below the baseline to reach the bed.
    const footPx = Math.round((base - bed) / pxToWorld);

    // Margins leave room for the crumble and the mip chain's blur.
    const side = Math.round(fpx * 0.12);
    const pad = Math.round(fpx * 0.12);
    const cw = Math.round(inkW) + side * 2;
    const baseY = pad + Math.round(asc);
    const ch = baseY + Math.max(Math.round(desc) + pad, footPx);

    const cv = document.createElement("canvas");
    cv.width = cw;
    cv.height = ch;
    const g = cv.getContext("2d");
    if (!g) return false;
    // Opaque black field, white letters. Sampling .r then needs no alpha
    // handling, and CLAMP_TO_EDGE past the padding reads as zero shadow.
    g.fillStyle = "#000";
    g.fillRect(0, 0, cw, ch);
    g.fillStyle = "#fff";
    setup(g);
    g.fillText(label, cw / 2, baseY);
    // Each letter carries on straight down below the baseline: the row just
    // above it, stretched to the bottom of the canvas. Under water this is
    // hidden; in a wave's trough it reads as the letter continuing into the
    // sea rather than hovering over it.
    if (footPx > 0) {
      g.drawImage(cv, 0, baseY - 3, cw, 1, 0, baseY - 2, cw, ch - baseY + 2);
    }

    const gl = this.gl;
    if (!this.tex) this.tex = gl.createTexture();
    if (!this.tex) return false;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    // MIPMAPPED, and that is the load-bearing decision in this whole file. The
    // solid takes its detail from the mip chain and the shadow takes its
    // penumbra from it, so both prefilter instead of aliasing — distance
    // softens them rather than breaking them into noise.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.maskPx = cw;

    this.halfW = cw * pxToWorld * 0.5;
    this.halfH = ch * pxToWorld * 0.5;
    // The quad centre is however far above the baseline the canvas puts it,
    // foreshortened by the lean.
    const lean = Math.cos(this.opts.tilt);
    this.centre = [x, base + (baseY - ch / 2) * pxToWorld * lean, this.opts.z];
    return true;
  }

  /**
   * Turns the quad to face the camera horizontally, leaning back by `tilt`.
   *
   * This does face the viewer, which is worth naming against §3's ban on
   * autonomous camera motion. The distinction is that §3 rules out the CAMERA
   * moving on its own — an orbit that fights the scroll and destabilises text
   * placement. Nothing here moves the camera, and About's azimuth only sweeps
   * ~10° across the whole scroll (§13), so the turn is a couple of degrees end
   * to end rather than anything that reads as motion.
   */
  orient(basis: CameraBasis): void {
    const f: [number, number] = [basis.ro[0] - this.centre[0], basis.ro[2] - this.centre[2]];
    const fl = Math.hypot(f[0], f[1]) || 1;
    f[0] /= fl;
    f[1] /= fl;
    const R: [number, number, number] = [f[1], 0, -f[0]];
    const ct = Math.cos(this.opts.tilt);
    const st = Math.sin(this.opts.tilt);
    const U: [number, number, number] = [-f[0] * st, ct, -f[1] * st];
    this.right = R;
    this.up = U;
    this.normal = [
      R[1] * U[2] - R[2] * U[1],
      R[2] * U[0] - R[0] * U[2],
      R[0] * U[1] - R[1] * U[0],
    ];
  }

  prop(): TextProp | null {
    if (!this.tex) return null;
    return {
      texture: this.tex,
      centre: this.centre,
      right: this.right,
      up: this.up,
      normal: this.normal,
      halfW: this.halfW,
      halfH: this.halfH,
      thickness: this.opts.thickness,
      px: this.maskPx,
      cut: this.opts.cut,
      erode: this.opts.erode,
      soft: this.opts.soft,
      strength: this.opts.strength,
      crumble: this.opts.crumble,
      relief: this.opts.relief,
    };
  }

  dispose(): void {
    if (this.tex) this.gl.deleteTexture(this.tex);
    this.tex = null;
  }
}
