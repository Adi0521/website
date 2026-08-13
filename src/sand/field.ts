/**
 * The sand field: a persistent RGBA half-float texture ping-ponged between two
 * framebuffers, plus the baked static layer underneath it (PRD §6.1).
 *
 *   R  height, signed — negative carved, positive berm
 *   G  disturbance — freshly moved sand is rougher and darker
 *   B  wetness — written by wave reach, dries over time
 *   A  settle age — resets under the brush, gates the fill-in delay
 *
 * The G channel is what sells a footprint: the sand *inside* it is rougher
 * than the wind-smoothed surface around it. Height alone is a dent in plastic.
 */

import type { Brush } from "../agents/types";
import type { MaskStamp } from "./mask";
import type { Tier } from "../gl/quality";
import type { WaveScheduler } from "../waves/scheduler";
import { applyWaveUniforms } from "../waves/uniforms";
import { Program, createProgram, drawFullscreen } from "../gl/program";
import { createTarget, clearTarget, disposeTarget, type Target } from "../gl/target";
import { DOMAIN, heightToWorld, type SandConfig } from "./params";

import vertSrc from "../gl/shaders/fullscreen.vert";
import bakeSrc from "../gl/shaders/bake.frag";
import simSrc from "../gl/shaders/sim.frag";

export class SandField {
  private readonly bakeProg: Program;
  private readonly simProg: Program;

  private front: Target | null = null;
  private back: Target | null = null;
  private staticLayer: Target | null = null;

  private needsBake = true;
  private resetPending = false;

  /** World XZ centre of the interactive patch, snapped to the texel grid. */
  private origin: [number, number] = [0, 0];
  private originAtLastStep: [number, number] = [0, 0];

  width = 2;
  height = 2;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private tier: Tier,
    private config: SandConfig,
  ) {
    this.bakeProg = createProgram(gl, vertSrc, bakeSrc, "bake");
    this.simProg = createProgram(gl, vertSrc, simSrc, "sim");
  }

  /** Half-extent in X. Tracks the field's aspect so texels stay square. */
  get domainX(): number {
    return DOMAIN * (this.width / this.height);
  }

  get texture(): WebGLTexture {
    return this.front!.tex;
  }

  get staticTexture(): WebGLTexture {
    return this.staticLayer!.tex;
  }

  get ready(): boolean {
    return this.front !== null;
  }

  /**
   * Sizes the field from the canvas, capped by the tier. Tiers scale field
   * resolution, march steps and DPR together (PRD §11) — scaling one alone is
   * how you get a tier that is still GPU-bound but now also looks worse.
   */
  resize(canvasWidth: number, canvasHeight: number): void {
    const cap = this.tier.field;
    const scale = Math.min(1, cap / Math.max(canvasWidth, canvasHeight, 1));
    const w = Math.max(2, Math.round(canvasWidth * scale));
    const h = Math.max(2, Math.round(canvasHeight * scale));
    if (w === this.width && h === this.height && this.front) return;

    this.dispose();
    this.width = w;
    this.height = h;

    const gl = this.gl;
    this.front = createTarget(gl, w, h);
    this.back = createTarget(gl, w, h);
    // MIRRORED_REPEAT on the static layer only: the baked ripples tile so the
    // beach keeps going past the interactive patch. The field itself clamps,
    // and render.frag fades its contribution out at the edge — a repeated
    // field would extrude a boundary mark outward as an infinite stripe.
    this.staticLayer = createTarget(gl, w, h, gl.MIRRORED_REPEAT);

    clearTarget(gl, this.front);
    clearTarget(gl, this.back);
    this.needsBake = true;
  }

  /** Queues a clear of the interactive layer. Applied on the next step. */
  reset(): void {
    this.resetPending = true;
  }

  /**
   * Auto-downgrade swaps the tier under a live context. The caller must resize
   * afterwards: this only changes the cap the next resize will honour.
   */
  setTier(tier: Tier): void {
    this.tier = tier;
  }

  /** Queues a re-bake. Call after changing ripple or dune parameters. */
  invalidateStatic(): void {
    this.needsBake = true;
  }

  setConfig(config: SandConfig): void {
    this.config = config;
  }

  get center(): [number, number] {
    return [this.origin[0], this.origin[1]];
  }

  /**
   * Moves the patch to follow the camera.
   *
   * Snapped to whole texels, and that is the whole trick: an unsnapped origin
   * means every step resamples the field at a fractional offset, and bilinear
   * filtering quietly blurs every mark a little more each frame until a
   * footprint dissolves purely from the camera moving past it.
   */
  setOrigin(x: number, z: number): void {
    const tx = (2 * this.domainX) / this.width;
    const tz = (2 * DOMAIN) / this.height;
    this.origin = [Math.round(x / tx) * tx, Math.round(z / tz) * tz];
  }

  /** World XZ to field UV. Returns null outside the interactive patch. */
  worldToField(x: number, z: number): [number, number] | null {
    const u = (x - this.origin[0]) / (2 * this.domainX) + 0.5;
    const v = (z - this.origin[1]) / (2 * DOMAIN) + 0.5;
    // Just inside the border: a stamp centred on the very edge would be half
    // clamped, and the asymmetry reads as the mark sliding off the patch.
    if (u < 0.005 || u > 0.995 || v < 0.005 || v > 0.995) return null;
    return [u, v];
  }

  fieldToWorld(u: number, v: number): [number, number] {
    return [
      this.origin[0] + (u - 0.5) * 2 * this.domainX,
      this.origin[1] + (v - 0.5) * 2 * DOMAIN,
    ];
  }

  private bake(): void {
    const gl = this.gl;
    const t = this.staticLayer!;
    const { bake } = this.config;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.viewport(0, 0, t.width, t.height);
    this.bakeProg.use();
    this.bakeProg.f("uAspect", this.width / this.height);
    this.bakeProg.f("uRipAmp", bake.ripAmp);
    this.bakeProg.f("uRipScale", bake.ripScale);
    this.bakeProg.f("uRipAngle", bake.ripAngle);
    this.bakeProg.f("uDuneAmp", bake.duneAmp);
    drawFullscreen(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.needsBake = false;
  }

  /**
   * Advances the field by one substep and swaps the ping-pong pair.
   *
   * ONE brush per step, because the stamp lives inside the transport pass
   * rather than in a pass of its own — running it twice would run erosion
   * twice with it. Multiple concurrent brushes need a separate stamp pass;
   * that is Phase 5 work, and PRD §8.3 keeps only one agent active at a time
   * precisely so it is not needed before then.
   *
   * The mask is the exception, and it is an exception on purpose rather than
   * the thin end of that wedge: it is a second footprint SOURCE inside the one
   * stamp, not a second stamp. Erosion still runs exactly once. It has to be
   * separate from the brush because the hero carve and the pointer are live at
   * the same time — §8.1 has the title sitting in the sand while you press
   * around it — and one-brush-per-step would otherwise make them alternate.
   */
  step(
    dt: number,
    brush: Brush | null,
    waves: WaveScheduler,
    time: number,
    mask: MaskStamp | null = null,
  ): void {
    if (!this.front || !this.back) return;
    const gl = this.gl;
    const { transport, brush: defaults, water, look } = this.config;

    if (this.needsBake) this.bake();

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.back.fb);
    gl.viewport(0, 0, this.width, this.height);
    this.simProg.use();
    this.simProg.tex("uPrev", 0, this.front.tex);
    this.simProg.tex("uStatic", 1, this.staticLayer!.tex);

    this.simProg.f2("uTexel", 1 / this.width, 1 / this.height);
    this.simProg.f("uAspect", this.width / this.height);
    this.simProg.f("uDt", dt);

    // How far the patch travelled since the last step, in uv. Whole texels by
    // construction, so the resample is exact.
    this.simProg.f2("uOrigin", this.origin[0], this.origin[1]);
    this.simProg.f2(
      "uShift",
      (this.origin[0] - this.originAtLastStep[0]) / (2 * this.domainX),
      (this.origin[1] - this.originAtLastStep[1]) / (2 * DOMAIN),
    );

    this.simProg.f("uDecay", transport.decay);
    this.simProg.f("uSmooth", transport.smooth);
    this.simProg.f("uSlump", transport.slump);
    this.simProg.f("uRepose", transport.repose);
    this.simProg.f("uInfill", transport.infill);

    // `none` is shadow-only by contract — it must not write height.
    const active = brush && brush.kind !== "none" ? brush : null;
    this.simProg.f2("uA", active ? active.a[0] : 0.5, active ? active.a[1] : 0.5);
    this.simProg.f2("uB", active ? active.b[0] : 0.5, active ? active.b[1] : 0.5);
    this.simProg.f("uPressure", active ? active.pressure : 0);
    this.simProg.f("uRadius", active ? active.radius : defaults.radius);
    this.simProg.f("uDepth", active ? active.depth : defaults.depth);
    this.simProg.f("uRim", active ? active.rim : defaults.rim);
    // Two delays, not one. `uDelay` is the field's ordinary rate and applies
    // wherever no source is pressing; `uBrushDelay` applies under this brush,
    // blended in by coverage. They were a single uniform, which made a
    // per-brush delay silently global — see the note in sim.frag.
    //
    // Worth knowing before relying on this: a fill delay only holds while its
    // source is actually pressing. It is not stored per texel — there is no
    // channel left, §6.1 spends all four — so it cannot outlive the stamp that
    // set it. A mark that must persist for minutes is held by being restamped,
    // not by being delayed; the delay buys the seconds after the press lifts.
    this.simProg.f("uDelay", transport.delay);
    this.simProg.f("uBrushDelay", active?.fillDelay ?? transport.delay);

    // The mask sampler is bound on EVERY step, even with nothing to carve.
    // Left unset it defaults to unit 0, which holds the previous field — and
    // while that reads harmlessly today, it is a sampler quietly aimed at a
    // half-float target that some drivers refuse to filter. Binding the static
    // layer as the inert stand-in costs one bind and keeps the unit honest.
    this.simProg.tex("uMask", 2, mask?.texture ?? this.staticLayer!.tex);
    this.simProg.f("uMaskPress", mask ? mask.pressure : 0);
    this.simProg.f("uMaskDepth", mask ? mask.depth : 0);
    this.simProg.f("uMaskRim", mask ? mask.rim : 0);
    this.simProg.f("uMaskDelay", mask?.fillDelay ?? transport.delay);
    this.simProg.f4(
      "uMaskRect",
      mask ? mask.center[0] : 0,
      mask ? mask.center[1] : 0,
      // Never zero: the shader divides by the half-extent, and a degenerate
      // rect would put every texel inside the mask at once.
      mask ? Math.max(mask.half[0], 1e-4) : 1,
      mask ? Math.max(mask.half[1], 1e-4) : 1,
    );

    this.simProg.f("uDX", this.domainX);
    this.simProg.f("uDZ", DOMAIN);
    this.simProg.f("uHtw", heightToWorld(look.relief));
    this.simProg.f("uWaveErase", water.waveErase);
    this.simProg.f("uDryRate", water.dryRate);
    applyWaveUniforms(this.simProg, water, waves, time);

    this.simProg.f("uReset", this.resetPending ? 1 : 0);
    drawFullscreen(gl);
    this.resetPending = false;
    this.originAtLastStep = [this.origin[0], this.origin[1]];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const tmp = this.front;
    this.front = this.back;
    this.back = tmp;
  }

  dispose(): void {
    const gl = this.gl;
    for (const t of [this.front, this.back, this.staticLayer]) {
      if (t) disposeTarget(gl, t);
    }
    this.front = this.back = this.staticLayer = null;
  }
}
