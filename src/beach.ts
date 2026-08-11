/**
 * Engine orchestration: one context, one field, one loop.
 *
 * The loop is deliberately restartable. PRD §9 turns off the simulation, the
 * scheduler, the camera and the RAF loop itself on focus pages, and §10 has
 * the field still holding its marks when you come back — so `stop()` and
 * `start()` are the seam Phase 3 mounts the focus pull onto, and the catch-up
 * plan is what makes the return honest instead of frozen.
 */

import type { Brush } from "./agents/types";
import { createContext, GLUnsupported } from "./gl/context";
import { bindFullscreenTriangle, ShaderError } from "./gl/program";
import { cameraBasis, groundHit, type CameraState } from "./gl/camera";
import { pickTier, type Tier } from "./gl/quality";
import { BeachRenderer, type CursorState } from "./gl/renderer";
import { SandField } from "./sand/field";
import { planCatchUp, MAX_DT } from "./sand/catchup";
import { DOMAIN, DEFAULT_SAND, DebugView, type SandConfig } from "./sand/params";
import { WaveScheduler, DEFAULT_WAVES } from "./waves/scheduler";

export interface BeachOptions {
  canvas: HTMLCanvasElement;
  config?: SandConfig;
  camera?: Partial<CameraState>;
  /** Called on context loss or an unsupported GPU. Reveal the fallback here. */
  onUnavailable?: (err: GLUnsupported | ShaderError | Error) => void;
}

const DEFAULT_CAMERA: CameraState = {
  azimuth: 1.55,
  elevation: 0.23,
  distance: 2.9,
  fovDeg: 46,
};

interface Pointer {
  u: number;
  v: number;
  /** Previous position, so fast motion sweeps a segment and leaves no gaps. */
  prevU: number;
  prevV: number;
  inside: boolean;
  valid: boolean;
  down: boolean;
}

export class Beach {
  readonly gl: WebGL2RenderingContext;
  readonly tier: Tier;
  readonly field: SandField;
  readonly waves: WaveScheduler;
  camera: CameraState;
  config: SandConfig;
  view: DebugView = DebugView.Beauty;

  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: BeachRenderer;
  private readonly onUnavailable: BeachOptions["onUnavailable"];

  private raf = 0;
  private running = false;
  private last = 0;
  private stoppedAt: number | null = null;
  private time = 0;

  private fpsEma = 0;
  private visible = true;
  private onscreen = true;
  private observer: IntersectionObserver | null = null;

  private ptr: Pointer = {
    u: 0.5, v: 0.5, prevU: 0.5, prevV: 0.5, inside: false, valid: false, down: false,
  };

  /** Smoothed frames per second. 0 until the loop has run. */
  get fps(): number {
    return Math.round(this.fpsEma);
  }

  /** Seconds of simulated time elapsed. Tracks the wall clock, unlike the
   *  prototype, which clamps dt and lets simulated time fall behind. */
  get elapsedSimulated(): number {
    return this.time;
  }

  /** PRD §12: reduced motion gets a static beach, not a slower one. */
  readonly reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(opts: BeachOptions) {
    this.canvas = opts.canvas;
    this.onUnavailable = opts.onUnavailable;
    this.config = opts.config ?? DEFAULT_SAND;
    this.camera = { ...DEFAULT_CAMERA, ...opts.camera };

    this.gl = createContext(this.canvas);
    this.tier = pickTier();
    bindFullscreenTriangle(this.gl);

    this.field = new SandField(this.gl, this.tier, this.config);
    this.renderer = new BeachRenderer(this.gl, this.tier);
    this.waves = new WaveScheduler(DEFAULT_WAVES);

    this.bindEvents();
    this.resize();
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    if (this.reducedMotion) {
      this.renderStill();
      return;
    }
    this.running = true;
    const now = performance.now();
    // Catch-up belongs HERE and nowhere else: it answers "the loop was stopped
    // for a while, age the field to match" (PRD §10). Running it every frame
    // instead turns an ordinary slow frame into a lurch, because the wave
    // advances by the whole elapsed time between two renders.
    const gap = this.stoppedAt === null ? 0 : (now - this.stoppedAt) / 1000;
    this.stoppedAt = null;
    this.last = now;
    if (gap > 0) this.catchUp(gap);
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stoppedAt = performance.now();
  }

  /**
   * Ages the field over a gap the loop slept through, bounded by the plan so
   * the return transition cannot be stalled. No brush: nobody was drawing
   * while the beach was not running.
   */
  private catchUp(gap: number): void {
    const plan = planCatchUp(gap);
    for (let i = 0; i < plan.steps; i++) {
      this.time += plan.dt;
      this.waves.step(plan.dt, this.time);
      this.field.step(plan.dt, null, this.waves, this.time);
    }
  }

  /** One simulation-free frame. Used for reduced motion and after a resize. */
  renderStill(): void {
    this.resize();
    this.field.step(0, null, this.waves, this.time);
    this.renderer.render(
      this.field, this.camera, this.config, this.waves, this.time,
      this.cursor(), this.view,
    );
  }

  dispose(): void {
    this.stop();
    this.observer?.disconnect();
    this.field.dispose();
  }

  // ── loop ──────────────────────────────────────────────────────────────────

  private frame = (): void => {
    this.raf = requestAnimationFrame(this.frame);
    const now = performance.now();
    const elapsed = (now - this.last) / 1000;
    this.last = now;
    // Off-screen and hidden are checked after the clock update, so a tab left
    // in the background does not bank an hour of simulation to run on return.
    if (!this.visible || !this.onscreen) return;

    // Frame rate is diagnostic here rather than decorative: this engine steps
    // the sim in real time, so a low rate does not slow the waves down, it
    // samples their motion more coarsely. Judder and a wrong cadence look
    // similar on screen and have opposite causes.
    if (elapsed > 0) {
      const inst = 1 / elapsed;
      this.fpsEma = this.fpsEma ? this.fpsEma * 0.9 + inst * 0.1 : inst;
    }

    this.resize();

    // Steady state is one step per rendered frame, clamped — the prototype's
    // behaviour, and the reason a struggling machine goes gently slow-motion
    // rather than juddering. MAX_DT is the same per-step stability bound the
    // catch-up plan respects, so there is one number, not two.
    const dt = Math.min(elapsed, MAX_DT);
    this.time += dt;
    this.waves.step(dt, this.time);
    this.field.step(dt, this.brush(), this.waves, this.time);

    this.ptr.prevU = this.ptr.u;
    this.ptr.prevV = this.ptr.v;

    this.renderer.render(
      this.field, this.camera, this.config, this.waves, this.time,
      this.cursor(), this.view,
    );
  };

  private brush(): Brush | null {
    const p = this.ptr;
    if (!p.inside || !p.valid) return null;
    const { radius, depth, rim } = this.config.brush;
    return {
      kind: "press",
      a: [p.prevU, p.prevV],
      b: [p.u, p.v],
      radius,
      depth,
      rim,
      // Hovering presses lightly, pressing presses hard. Both converge to a
      // depth rather than digging, because the stamp is target-based.
      pressure: p.down ? 1.0 : 0.42,
    };
  }

  private cursor(): CursorState {
    const p = this.ptr;
    return {
      world: this.field.fieldToWorld(p.u, p.v),
      visible: p.inside && p.valid,
      radius: this.config.brush.radius * 2 * DOMAIN,
    };
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, this.tier.dpr);
    const w = Math.max(2, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(2, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.field.resize(w, h);
  }

  // ── input ─────────────────────────────────────────────────────────────────

  private track(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const basis = cameraBasis(this.camera);
    const hit = groundHit(
      basis,
      (e.clientX - r.left) / r.width,
      1 - (e.clientY - r.top) / r.height, // shader convention: Y up
      r.width / r.height,
    );
    const uv = hit ? this.field.worldToField(hit[0], hit[1]) : null;
    this.ptr.inside = true;
    this.ptr.valid = uv !== null;
    if (uv) {
      this.ptr.u = uv[0];
      this.ptr.v = uv[1];
    }
  }

  private bindEvents(): void {
    const c = this.canvas;

    c.addEventListener("pointermove", (e) => this.track(e), { passive: true });
    c.addEventListener("pointerdown", (e) => {
      c.setPointerCapture(e.pointerId);
      this.ptr.down = true;
      this.track(e);
    });
    addEventListener("pointerup", () => {
      this.ptr.down = false;
    });
    c.addEventListener("pointerleave", () => {
      this.ptr.inside = false;
      this.ptr.down = false;
      // Snap the segment shut, or re-entering elsewhere sweeps a stripe across
      // the beach from wherever the pointer left.
      this.ptr.prevU = this.ptr.u;
      this.ptr.prevV = this.ptr.v;
    });

    addEventListener("resize", () => {
      if (!this.running) this.renderStill();
    });

    document.addEventListener("visibilitychange", () => {
      this.visible = !document.hidden;
      this.last = performance.now();
    });

    if ("IntersectionObserver" in window) {
      this.observer = new IntersectionObserver(
        (entries) => {
          this.onscreen = entries[0]?.isIntersecting ?? true;
          this.last = performance.now();
        },
        { threshold: 0.01 },
      );
      this.observer.observe(c);
    }

    c.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.stop();
      // Recovery would mean a new context and an empty field. PRD §3 accepts
      // that — sand state dies on reload and is explicitly not persisted — so
      // this reports rather than pretending to restore.
      this.onUnavailable?.(new Error("WebGL context lost"));
    });
  }
}
