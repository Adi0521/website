/**
 * The render pass: one fullscreen triangle, zero geometry, depth entirely from
 * the march (PRD §6.3).
 *
 * Nothing here is a "draw the terrain" call — the terrain does not exist as
 * anything but a heightfield the fragment shader walks. That is why the whole
 * renderer is a uniform upload.
 */

import type { SandField } from "../sand/field";
import type { WaveScheduler } from "../waves/scheduler";
import type { Tier } from "./quality";
import { applyWaveUniforms } from "../waves/uniforms";
import { Program, createProgram, drawFullscreen } from "../gl/program";
import { cameraBasis, type CameraState } from "./camera";
import { DOMAIN, heightToWorld, type DebugView, type SandConfig } from "../sand/params";

import { createTarget, disposeTarget, type Target } from "./target";

import vertSrc from "./shaders/fullscreen.vert";
import renderSrc from "./shaders/render.frag";
import compositeSrc from "./shaders/composite.frag";

export type { TextProp } from "../about/hero";
import type { TextProp } from "../about/hero";
import type { SignSet } from "../about/sign";
import { MAX_SIGNS } from "../about/sign";

export interface CursorState {
  /** World XZ of the ring. */
  world: [number, number];
  visible: boolean;
  radius: number;
}

export class BeachRenderer {
  private readonly prog: Program;
  private readonly composite: Program;
  /** Only allocated once the pull is engaged — the beach never pays for it. */
  private scene: Target | null = null;
  private sceneW = 0;
  private sceneH = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private tier: Tier,
  ) {
    this.prog = createProgram(gl, vertSrc, renderSrc, "render");
    this.composite = createProgram(gl, vertSrc, compositeSrc, "composite");
  }

  /**
   * The offscreen target the pull blurs. Sized to the drawing buffer and
   * reallocated when that changes, which is the resize case §10 calls out as
   * the one thing that must re-render a frozen focus page.
   */
  private ensureScene(w: number, h: number): Target {
    if (this.scene && this.sceneW === w && this.sceneH === h) return this.scene;
    if (this.scene) disposeTarget(this.gl, this.scene);
    this.scene = createTarget(this.gl, w, h, { mipmaps: true, format: "rgba8" });
    this.sceneW = w;
    this.sceneH = h;
    return this.scene;
  }

  dispose(): void {
    if (this.scene) disposeTarget(this.gl, this.scene);
    this.scene = null;
  }

  /** Auto-downgrade swaps the tier under a live context. */
  setTier(tier: Tier): void {
    this.tier = tier;
  }

  render(
    field: SandField,
    camera: CameraState,
    config: SandConfig,
    waves: WaveScheduler,
    time: number,
    cursor: CursorState,
    view: DebugView,
    focus = 0,
    text: TextProp | null = null,
    signs: SignSet | null = null,
  ): void {
    if (!field.ready) return;
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    const { water, look } = config;
    const c = cameraBasis(camera);

    // Straight to the screen while the beach is the beach. The composite is a
    // whole extra fullscreen pass, and About would be paying for it every
    // frame to apply an effect set to zero.
    const pulled = focus > 0.001;
    const target = pulled ? this.ensureScene(canvas.width, canvas.height) : null;

    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    this.prog.use();
    this.prog.tex("uField", 0, field.texture);
    this.prog.tex("uStatic", 1, field.staticTexture);

    this.prog.f2("uTexel", 1 / field.width, 1 / field.height);
    this.prog.f2("uRes", canvas.width, canvas.height);
    this.prog.f2("uOrigin", field.center[0], field.center[1]);

    this.prog.f3("uRo", c.ro[0], c.ro[1], c.ro[2]);
    this.prog.f3("uUu", c.uu[0], c.uu[1], c.uu[2]);
    this.prog.f3("uVv", c.vv[0], c.vv[1], c.vv[2]);
    this.prog.f3("uWw", c.ww[0], c.ww[1], c.ww[2]);
    this.prog.f("uFov", c.fov);

    // World units per field texel — the normal-sampling footprint, widened
    // with distance inside the shader so texels smaller than a pixel near the
    // horizon do not turn into aliasing noise.
    this.prog.f("uWpt", (2 * DOMAIN) / field.height);
    this.prog.f("uDX", field.domainX);
    this.prog.f("uDZ", DOMAIN);
    this.prog.f("uHtw", heightToWorld(look.relief));

    this.prog.f("uRelief", look.relief);
    this.prog.f("uSparkle", look.sparkle);
    this.prog.f("uSky", look.sky);
    this.prog.f("uSunEl", look.sunEl);
    this.prog.f("uSunAz", look.sunAz);
    this.prog.f("uFog", look.fog);
    this.prog.f("uExposure", look.exposure);
    this.prog.f("uSat", look.sat);
    this.prog.f("uFoam", water.foam);

    applyWaveUniforms(this.prog, water, waves, time);
    this.prog.f("uSteps", this.tier.steps);

    this.prog.f2("uCursorW", cursor.world[0], cursor.world[1]);
    this.prog.f("uCursorOn", cursor.visible ? 1 : 0);
    this.prog.f("uCursorR", cursor.radius);
    this.prog.i("uView", view);

    // The name (§8.1). The sampler is bound every frame even with nothing to
    // draw: left unset it defaults to unit 0, which holds the sand field, and a
    // stray fetch there would be read as letter coverage.
    this.prog.tex("uText", 2, text?.texture ?? field.staticTexture);
    this.prog.f("uTextOn", text ? 1 : 0);
    this.prog.f("uTextSolid", text && text.solid !== false ? 1 : 0);
    if (text) {
      this.prog.f3("uTextC", text.centre[0], text.centre[1], text.centre[2]);
      this.prog.f3("uTextR", text.right[0], text.right[1], text.right[2]);
      this.prog.f3("uTextU", text.up[0], text.up[1], text.up[2]);
      this.prog.f3("uTextN", text.normal[0], text.normal[1], text.normal[2]);
      // Never zero: slabUV divides by these, and a degenerate quad puts every
      // point in the world inside the letters.
      this.prog.f("uTextHW", Math.max(text.halfW, 1e-4));
      this.prog.f("uTextHH", Math.max(text.halfH, 1e-4));
      this.prog.f("uTextTh", Math.max(text.thickness, 1e-4));
      this.prog.f("uTextPx", Math.max(text.px, 1));
      this.prog.f("uTextCut", text.cut);
      this.prog.f("uTextErode", text.erode);
      this.prog.f("uTextSoft", text.soft);
      this.prog.f("uTextStr", text.strength);
      this.prog.f("uTextCrumble", text.crumble);
      this.prog.f("uTextTexture", text.relief);
    }

    // The timeline signpost (§8.2). Same rule as the name's sampler: bound
    // every frame so an unset unit never aliases the sand field.
    this.prog.tex("uSignTex", 3, signs?.texture ?? field.staticTexture);
    const list = signs ? signs.signs.slice(0, MAX_SIGNS) : [];
    this.prog.i("uSignCount", list.length);
    if (list.length) {
      const flat = (pick: (s: SignSet["signs"][number]) => readonly number[], n: number) => {
        const a = new Float32Array(MAX_SIGNS * n);
        list.forEach((s, i) => a.set(pick(s), i * n));
        return a;
      };
      this.prog.f3v("uSignC", flat((s) => s.foot, 3));
      this.prog.f3v("uSignR", flat((s) => s.right, 3));
      this.prog.f3v("uSignU", flat((s) => s.up, 3));
      this.prog.f3v("uSignN", flat((s) => s.normal, 3));
      this.prog.f4v("uSignBoard", flat((s) => s.board, 4));
      this.prog.f3v("uSignPost", flat((s) => s.post, 3));
      this.prog.f4v("uSignUV", flat((s) => s.uv, 4));
      this.prog.fv("uSignPx", flat((s) => [Math.max(s.px, 1)], 1));
      this.prog.f4v("uScroll", flat((s) => s.scroll ?? [0, 0, 0, 0], 4));
      // Eased in shape as well as in time: slow off the roll, slow to stop.
      this.prog.fv("uScrollOpen", flat((s) => [s.open * s.open * (3 - 2 * s.open)], 1));
      this.prog.f4v("uScrollUV", flat((s) => s.scrollUV, 4));
    }

    drawFullscreen(gl);

    if (!target) return;

    // The mip chain IS the blur, so it has to be rebuilt from the frame just
    // drawn rather than left over from the last one.
    gl.bindTexture(gl.TEXTURE_2D, target.tex);
    gl.generateMipmap(gl.TEXTURE_2D);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    this.composite.use();
    this.composite.tex("uScene", 0, target.tex);
    this.composite.f2("uTexel", 1 / canvas.width, 1 / canvas.height);
    this.composite.f("uFocus", focus);
    this.composite.f("uMaxLod", Math.floor(Math.log2(Math.max(canvas.width, canvas.height))));
    this.composite.f("uBlur", config.focus.blur);
    this.composite.f("uDim", config.focus.dim);
    this.composite.f("uDesat", config.focus.desaturate);
    drawFullscreen(gl);
  }
}
