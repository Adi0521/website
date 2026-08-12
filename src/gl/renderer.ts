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
