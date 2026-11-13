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
}

export const DEFAULT_HERO: HeroNameOptions = {
  width: 2.1,
  z: 2.3,
  tilt: 0.16,
  thickness: 0.035,
  sink: 0.05,
  cut: 0.5,
  erode: 0.35,
  soft: 0.05,
  strength: 0.92,
  supersample: 2,
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
  cut: number;
  erode: number;
  soft: number;
  strength: number;
}

export class HeroName {
  private tex: WebGLTexture | null = null;
  /** Layout size of the source element, CSS pixels. */
  private wpx = 1;
  private hpx = 1;
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
   * Rasterizes the mask from `el` and sizes the slab from its box.
   *
   * Returns false when the element has no layout yet — which is a real state
   * during a route change, not an error. The caller retries.
   */
  build(el: HTMLElement, sandY: number): boolean {
    const wpx = el.offsetWidth;
    const hpx = el.offsetHeight;
    if (wpx < 4 || hpx < 4) return false;
    this.wpx = wpx;
    this.hpx = hpx;
    this.text = el.textContent?.trim() ?? "";

    const R = Math.max(1, this.opts.supersample);
    const cw = Math.round(wpx * R);
    const ch = Math.round(hpx * R);
    const cv = document.createElement("canvas");
    cv.width = cw;
    cv.height = ch;
    const g = cv.getContext("2d");
    if (!g) return false;

    // Opaque black field, white letters. Sampling .r then needs no alpha
    // handling, and CLAMP_TO_EDGE past the padding reads as zero shadow.
    g.fillStyle = "#000";
    g.fillRect(0, 0, cw, ch);

    const cs = getComputedStyle(el);
    g.font = `${cs.fontWeight} ${parseFloat(cs.fontSize) * R}px ${cs.fontFamily}`;
    try {
      g.letterSpacing = cs.letterSpacing;
    } catch {
      // Not every engine exposes it; the width correction below absorbs the
      // difference either way.
    }
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#fff";

    // Canvas metrics and DOM layout disagree slightly, especially on letter
    // spacing. Measure and correct, so the sculpture matches the element it was
    // measured from — otherwise the shadow lands beside the letters rather than
    // under them, which is the kind of error that looks like a bug in the light.
    const padX = (parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)) * R;
    const target = Math.max(1, cw - padX);
    const m = g.measureText(el.textContent ?? "");
    const sx = m.width > 1 ? target / m.width : 1;
    g.save();
    g.translate(cw / 2, ch / 2);
    g.scale(sx, 1);
    g.fillText(el.textContent ?? "", 0, 0);
    g.restore();

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

    this.place(sandY);
    return true;
  }

  /**
   * Sizes the slab and stands it on the beach.
   *
   * The scale converts element pixels to world units, and the mask covers the
   * same rect, so the half-extents follow directly from the element box.
   */
  private place(sandY: number): void {
    const s = this.opts.width / Math.max(this.wpx, 1);
    this.halfW = this.wpx * s * 0.5;
    this.halfH = this.hpx * s * 0.5;
    // Stood on the sand rather than floated over it: the bottom edge is one
    // half-height below centre, so the centre rises by that much, less however
    // far it is meant to sit into the beach.
    const lean = Math.cos(this.opts.tilt);
    this.centre = [0, sandY + this.halfH * lean - this.opts.sink, this.opts.z];
  }

  /** Re-stands the slab after the ramp height changes under it. */
  replace(sandY: number): void {
    this.place(sandY);
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
    };
  }

  dispose(): void {
    if (this.tex) this.gl.deleteTexture(this.tex);
    this.tex = null;
  }
}
