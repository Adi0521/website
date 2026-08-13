/**
 * Text to sand mask — the Phase 4 primitive (PRD §8.1).
 *
 * The stamp in sim.frag is a swept segment SDF, which is the right shape for a
 * finger, a footprint or a tyre and the wrong shape for a word. Carving "Adi"
 * as a chain of `press` stamps at the one-brush-per-step the field allows
 * (see SandField.step) would still be writing the last glyph while the first
 * had already begun to fill in.
 *
 * So display type is rasterized ONCE into a texture and stamped as a field,
 * not as a path. This is not a sixth brush kind — §6.4 keeps that set closed —
 * it is `press` with a different footprint function.
 *
 * ── Orientation ────────────────────────────────────────────────────────────
 *
 * The mask is uploaded UNFLIPPED, and that is load-bearing rather than
 * incidental. The camera sits at larger z looking toward -z (`cameraBasis`
 * puts the eye ~2.82 behind its target), so screen-up is *decreasing* z and
 * screen-right is +x. Canvas2D row 0 is the top of the glyphs. Without
 * UNPACK_FLIP_Y_WEBGL that row lands at v=0, sim.frag maps v=0 to the smaller
 * z edge of the rect, and the type reads upright from the camera. Flip it and
 * the title comes out mirrored top to bottom, which on a grazing camera looks
 * subtly wrong long before it looks obviously wrong.
 */

/**
 * A rasterized mark placed in WORLD space, not field uv.
 *
 * World space for the same reason `Beach`'s pointer is: the patch travels with
 * the camera, so a rect held in uv would drift across the beach as you scroll
 * and the title would swim. §8.1 wants the hero to stay where it was carved.
 */
export interface MaskStamp {
  texture: WebGLTexture;
  /** World XZ centre. */
  center: [number, number];
  /** World half-extent, X and Z. Must match the mask's own aspect or type skews. */
  half: [number, number];
  /** 0 lifts the stamp entirely; the field skips it without a texture bind. */
  pressure: number;
  depth: number;
  /** Rim height as a fraction of depth. Pressed sand pushes *up* at the edge. */
  rim: number;
  /** Per-brush fill delay (§6.2). Omitted falls back to the global default. */
  fillDelay?: number;
}

export interface TextMaskOptions {
  /** CSS font shorthand minus the size — e.g. `700` and `Mattone`. */
  weight: number | string;
  family: string;
  letterSpacing: string;
  /**
   * Texels per em. The mask is resampled into the sand field, which at the
   * Standard tier is 768 across the whole patch, so there is no point
   * rasterizing far past what the field can hold — but going under makes the
   * stroke edges mushy before the field does.
   */
  pixelsPerEm: number;
  /**
   * Blur applied to the mask, in texels. A hard-edged mask carves a cliff, and
   * slumping immediately tears it down into a ridge of noise. A soft edge is
   * what a real impression has: the sand shoulders up rather than shearing.
   */
  softness: number;
  /**
   * Padding around the type, in texels, so the rim has somewhere to go. The
   * rim is pushed OUTSIDE the glyph outline, and with a tight crop it would be
   * clipped by the rect edge and the letters would look cut out rather than
   * pressed.
   */
  pad: number;
}

export const DEFAULT_TEXT_MASK: TextMaskOptions = {
  weight: 700,
  family: "Mattone",
  letterSpacing: "-0.01em", // matches the h1 in type.css, so carve and DOM agree
  pixelsPerEm: 256,
  softness: 3,
  pad: 24,
};

/**
 * Waits for the display face to be usable before anything rasterizes.
 *
 * `document.fonts.ready` alone is not enough: with `font-display: swap` a face
 * nobody has requested yet is not in the loading set, so `ready` resolves
 * immediately and the mask gets carved in the system fallback. §5 is explicit
 * that the display face is Mattone and that the fallback carries neither the
 * arrows nor the geometric marks — a title carved in ui-sans-serif is a
 * different design, permanently, because the field keeps it.
 */
export async function displayFontReady(opts: TextMaskOptions = DEFAULT_TEXT_MASK): Promise<boolean> {
  if (!("fonts" in document)) return false;
  try {
    await document.fonts.load(`${opts.weight} 64px "${opts.family}"`);
    await document.fonts.ready;
    return document.fonts.check(`${opts.weight} 64px "${opts.family}"`);
  } catch {
    // A font that will not load is not a reason to lose the beach. The caller
    // carves in whatever the fallback is, or skips the carve entirely.
    return false;
  }
}

/**
 * One rasterized string, owned as a GL texture.
 *
 * Deliberately re-rasterizable: the hero re-renders on a large viewport change
 * so the carve keeps its resolution, and re-rasterizing beats allocating a
 * second texture per breakpoint.
 */
export class TextMask {
  private tex: WebGLTexture | null = null;
  private canvas: HTMLCanvasElement | null = null;

  /** Mask pixel dimensions. `aspect` is what places the world rect. */
  width = 0;
  height = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  get texture(): WebGLTexture | null {
    return this.tex;
  }

  /** Width over height. The caller sizes its world rect to this or type skews. */
  get aspect(): number {
    return this.height > 0 ? this.width / this.height : 1;
  }

  get ready(): boolean {
    return this.tex !== null;
  }

  /**
   * Rasterizes `text` and uploads it. Returns false when there is nothing to
   * carve — an empty string, or a 2D context the browser would not give us.
   */
  render(text: string, opts: TextMaskOptions = DEFAULT_TEXT_MASK): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;

    const canvas = this.canvas ?? document.createElement("canvas");
    this.canvas = canvas;
    const em = opts.pixelsPerEm;
    const font = `${opts.weight} ${em}px "${opts.family}", sans-serif`;

    // Measure on a throwaway pass first: the canvas has to be sized before the
    // real draw, and resizing a canvas clears it.
    const probe = canvas.getContext("2d");
    if (!probe) return false;
    probe.font = font;
    probe.letterSpacing = opts.letterSpacing;
    const m = probe.measureText(trimmed);

    // Actual ink bounds, not the em box. A title measured by its em box sits
    // visibly high in its rect, because the box reserves descender room that
    // "Adi" barely uses — and the carve would then be off-centre from the DOM
    // <h1> stacked over it, which is exactly the alignment the user's choice
    // of "DOM type over the carve" makes visible.
    const ascent = m.actualBoundingBoxAscent || em * 0.72;
    const descent = m.actualBoundingBoxDescent || em * 0.2;
    const left = m.actualBoundingBoxLeft || 0;
    const right = m.actualBoundingBoxRight || m.width;

    const pad = opts.pad;
    const w = Math.max(2, Math.ceil(left + right + pad * 2));
    const h = Math.max(2, Math.ceil(ascent + descent + pad * 2));
    canvas.width = w;
    canvas.height = h;
    this.width = w;
    this.height = h;

    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    // Re-set after the resize: sizing a canvas resets its whole 2D state, so a
    // font assigned before this point is silently back to 10px sans-serif.
    ctx.font = font;
    ctx.letterSpacing = opts.letterSpacing;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    // White on black: the mask is read as a scalar from the R channel, so the
    // glyph is the signal and everything else must be exactly zero. A cleared
    // canvas is transparent black, which is what we want, but only because
    // nothing below composites against it.
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#fff";
    // Blur in canvas rather than in the shader. Doing it here costs one filter
    // on one frame; doing it in sim.frag would cost taps on every texel of
    // every step for a mask that never changes.
    ctx.filter = opts.softness > 0 ? `blur(${opts.softness}px)` : "none";
    ctx.fillText(trimmed, pad + left, pad + ascent);
    ctx.filter = "none";

    return this.upload(canvas);
  }

  private upload(source: HTMLCanvasElement): boolean {
    const gl = this.gl;
    const tex = this.tex ?? gl.createTexture();
    if (!tex) return false;
    this.tex = tex;

    gl.bindTexture(gl.TEXTURE_2D, tex);
    // Unflipped — see the orientation note at the top of this file.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // CLAMP, not REPEAT: sim.frag already rejects samples outside the rect, but
    // a wrapped mask would tile the title across the entire beach if that test
    // were ever loosened.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return true;
  }

  dispose(): void {
    if (this.tex) this.gl.deleteTexture(this.tex);
    this.tex = null;
    this.canvas = null;
  }
}
