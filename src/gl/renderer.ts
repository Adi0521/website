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

import vertSrc from "./shaders/fullscreen.vert";
import renderSrc from "./shaders/render.frag";

export interface CursorState {
  /** World XZ of the ring. */
  world: [number, number];
  visible: boolean;
  radius: number;
}

export class BeachRenderer {
  private readonly prog: Program;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private tier: Tier,
  ) {
    this.prog = createProgram(gl, vertSrc, renderSrc, "render");
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
  ): void {
    if (!field.ready) return;
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    const { water, look } = config;
    const c = cameraBasis(camera);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
  }
}
