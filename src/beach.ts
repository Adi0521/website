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
import { pickTier, TIERS, type Tier } from "./gl/quality";
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

/**
 * Render pacing. A raymarched fullscreen shader costs the same whether the
 * display asks for it 60 or 120 times a second, so an unpaced loop on a 120Hz
 * panel spends exactly twice the GPU for motion nobody is looking directly at.
 * This is a background for a portfolio, not a game.
 */
const MAX_FPS = 60;

/**
 * The window is visible but not focused — another window in front, a second
 * monitor, the browser behind an editor. `visibilitychange` does not fire for
 * any of that, so without this the beach keeps drawing at full rate while the
 * machine is busy with whatever the person actually switched to.
 */
const UNFOCUSED_FPS = 12;

/** Sustained frame rate below this, while focused, drops a tier. */
const DOWNGRADE_BELOW = 45;
/** How long it has to stay there. Long enough to ignore a hitch. */
const DOWNGRADE_AFTER = 4;
/**
 * Settling time before the frame rate is trusted, in SECONDS rather than
 * frames. A frame-count warmup is self-defeating here: at 4fps, sixty frames
 * is fifteen seconds, so the check would open last on precisely the machines
 * it exists to rescue.
 */
const WARMUP_SECONDS = 2;

const DEFAULT_CAMERA: CameraState = {
  azimuth: 1.55,
  elevation: 0.23,
  distance: 2.9,
  fovDeg: 46,
  target: [0, 0, 0],
};

/**
 * Kept in WORLD space, not field uv. The patch moves under the pointer, so a
 * uv held across frames would mean a different place on the beach each time —
 * the brush would smear sideways whenever the camera travelled.
 */
interface Pointer {
  x: number;
  z: number;
  /** Previous position, so fast motion sweeps a segment and leaves no gaps. */
  prevX: number;
  prevZ: number;
  inside: boolean;
  valid: boolean;
  down: boolean;
}

export class Beach {
  readonly gl: WebGL2RenderingContext;
  /** Not readonly: auto-downgrade replaces it when the machine cannot keep up. */
  tier: Tier;
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

  /** Frames actually rendered. Pacing means this is not the RAF count. */
  frames = 0;
  /** Render cap while focused. Lower it to hand the GPU back. */
  maxFps = MAX_FPS;
  /** Set false to pin the tier and stop auto-downgrade. */
  autoDowngrade = true;

  private fpsEma = 0;
  private lastRender = 0;
  /** Timestamp the frame rate became trustworthy again. */
  private warmFrom = 0;
  private slowFor = 0;
  private visible = true;
  private onscreen = true;
  private focused = true;
  private observer: IntersectionObserver | null = null;

  private ptr: Pointer = {
    x: 0, z: 0, prevX: 0, prevZ: 0, inside: false, valid: false, down: false,
  };

  /** Called each frame before the sim steps. The scroll camera hangs here. */
  onFrame: ((dt: number) => void) | null = null;

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
    this.warmFrom = now;
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
   * Drops to the next tier down. PRD §11 lists tier auto-detection as still to
   * build, and §11's own numbers are why it is needed: the ~120fps measurement
   * was taken at DPR ≤1.4, so Cinematic at DPR 2.0 — four times the fragments
   * of DPR 1.0 — rests on a measurement that never covered it.
   *
   * Reallocating the field discards the sand. That is a real cost, but it
   * happens at most twice in a session and only on a machine that is already
   * dropping frames, where the alternative is staying unusably slow.
   */
  private downgrade(): void {
    const ladder = ["cinematic", "high", "standard"];
    const next = ladder[ladder.indexOf(this.tier.name) + 1];
    const tier = next ? TIERS[next] : undefined;
    this.slowFor = 0;
    if (!tier) return; // already at the bottom; nothing left to give
    this.tier = tier;
    this.field.setTier(tier);
    this.renderer.setTier(tier);
    this.resize();
    this.fpsEma = 0;
    this.warmFrom = performance.now();
    console.info(`[beach] downgraded to ${tier.name} — field ${tier.field}, dpr ${tier.dpr}`);
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

    // Off-screen and hidden reset the clock rather than banking time, so a tab
    // left in the background does not run an hour of simulation on return.
    if (!this.visible || !this.onscreen) {
      this.last = now;
      return;
    }

    // Pacing. The 1ms slack matters: without it a 60Hz display whose frames
    // land a hair early would fail the test every other frame and render at 30.
    const interval = 1000 / (this.focused ? this.maxFps : UNFOCUSED_FPS);
    if (now - this.lastRender < interval - 1) return;
    this.lastRender = now;

    const elapsed = (now - this.last) / 1000;
    this.last = now;

    // Frame rate is diagnostic here rather than decorative: this engine steps
    // the sim in real time, so a low rate does not slow the waves down, it
    // samples their motion more coarsely. Judder and a wrong cadence look
    // similar on screen and have opposite causes.
    if (elapsed > 0) {
      const inst = 1 / elapsed;
      this.fpsEma = this.fpsEma ? this.fpsEma * 0.9 + inst * 0.1 : inst;
      // Only judged while focused and unpaced-limited: the unfocused cap would
      // otherwise look exactly like a machine that cannot keep up, and the
      // beach would downgrade itself every time you clicked another window.
      if (this.autoDowngrade && this.focused && now - this.warmFrom > WARMUP_SECONDS * 1000) {
        const slow = this.fpsEma < Math.min(DOWNGRADE_BELOW, this.maxFps - 5);
        this.slowFor = slow ? this.slowFor + elapsed : 0;
        if (this.slowFor > DOWNGRADE_AFTER) this.downgrade();
      }
    }
    this.frames += 1;

    this.resize();

    // Steady state is one step per rendered frame, clamped — the prototype's
    // behaviour, and the reason a struggling machine goes gently slow-motion
    // rather than juddering. MAX_DT is the same per-step stability bound the
    // catch-up plan respects, so there is one number, not two.
    // Real elapsed, NOT the clamped sim dt. The camera is not a diffusion
    // process and has no stability bound, so feeding it the clamp would make
    // it ease more slowly the worse the frame rate gets — the camera would
    // visibly lag the scrollbar on exactly the machines that can least afford
    // it, while the sand kept its own correct pace.
    this.onFrame?.(elapsed);

    const dt = Math.min(elapsed, MAX_DT);
    // The patch follows the camera's look-at point, so the interactive zone
    // travels with the view instead of being stranded at the world origin.
    this.field.setOrigin(this.camera.target[0], this.camera.target[2]);

    this.time += dt;
    this.waves.step(dt, this.time);
    this.field.step(dt, this.brush(), this.waves, this.time);

    this.ptr.prevX = this.ptr.x;
    this.ptr.prevZ = this.ptr.z;

    this.renderer.render(
      this.field, this.camera, this.config, this.waves, this.time,
      this.cursor(), this.view,
    );
  };

  private brush(): Brush | null {
    const p = this.ptr;
    if (!p.inside || !p.valid) return null;
    const b = this.field.worldToField(p.x, p.z);
    if (!b) return null;
    // If the previous point has since left the patch, collapse the segment to a
    // point rather than sweeping from a clamped edge position.
    const a = this.field.worldToField(p.prevX, p.prevZ) ?? b;
    const { radius, depth, rim } = this.config.brush;
    return {
      kind: "press",
      a,
      b,
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
      world: [p.x, p.z],
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
    this.ptr.inside = true;
    // Valid means "on the ground and inside the patch". Outside it there is
    // nothing to press, and the cursor ring disappears to show where the
    // interactive zone ends — which is exactly the edge the clipmap moves.
    this.ptr.valid = hit !== null && this.field.worldToField(hit[0], hit[1]) !== null;
    if (hit) {
      this.ptr.x = hit[0];
      this.ptr.z = hit[1];
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
      this.ptr.prevX = this.ptr.x;
      this.ptr.prevZ = this.ptr.z;
    });

    addEventListener("resize", () => {
      if (!this.running) this.renderStill();
    });

    document.addEventListener("visibilitychange", () => {
      this.visible = !document.hidden;
      this.last = performance.now();
    });

    this.focused = document.hasFocus();
    addEventListener("focus", () => {
      this.focused = true;
      this.last = performance.now();
      // Do not judge the tier on frames measured while throttled, and give the
      // rate time to settle again before trusting it.
      this.fpsEma = 0;
      this.slowFor = 0;
      this.warmFrom = this.last;
    });
    addEventListener("blur", () => {
      this.focused = false;
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
