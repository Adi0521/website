/**
 * Waves are discrete events, not a repeating cycle. Each draws its own arrival
 * time, reach, build character and drain from a hash of its index — varied and
 * unpredictable, but deterministic and stateless.
 *
 * This runs on the CPU deliberately. Swash level varies only with time, not
 * position, so evaluating it per ray-march step would cost thousands of hashes
 * per pixel for a value that is constant across the entire frame. Two uniforms
 * instead. It also guarantees the simulation and renderer get identical state.
 */

export interface WaveParams {
  interval: number;   // mean seconds between waves, as an angular rate
  jitter: number;     // 0..0.7 — how uneven the spacing is
  drain: number;      // <1 makes the stranded film linger
  sizeVar: number;    // 0..1 — how much swell height drifts between sets
  speed: number;      // swell travel speed
  amp: number;        // base swell height
}

/**
 * Multiplier on how long the uprush takes. 1.0 is the Phase 1 prototype's
 * timing, where an isolated wave runs up in about 2.2s.
 *
 * This scales every wave uniformly rather than flattening them toward a fixed
 * duration, so the §7.3 coupling survives: build time is drawn from the same
 * hash as the easing exponent, which is what makes slow waves swell in while
 * quick ones snap up, and that correlation is what reads as intentional rather
 * than randomised. Reach and drain are drawn separately and are unaffected.
 */
const UPRUSH = 1.4;

const hash1 = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const ss = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};
const noise1 = (t: number): number => {
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  return hash1(i) * (1 - u) + hash1(i + 1) * u;
};

export function swashAt(t: number, drainExp: number, p: WaveParams): number {
  const period = 6.28318 / Math.max(p.interval, 0.01);
  const n0 = Math.floor(t / period);
  let best = 0;
  for (let k = -2; k <= 1; k++) {
    const n = n0 + k;
    const r1 = hash1(n * 1.13 + 3.7),  r2 = hash1(n * 2.71 + 11.3);
    const r3 = hash1(n * 0.57 + 27.9), r4 = hash1(n * 3.31 + 41.1);
    const T = (n + (r1 - 0.5) * p.jitter) * period;  // uneven spacing
    const A = 0.34 + 0.66 * r2;                      // how far it reaches
    const R = (0.14 + 0.42 * r3) * period * UPRUSH;  // build time
    const F = (0.60 + 0.90 * r4) * period;           // drain time
    const x = t - T;
    if (x < 0 || x > R + F) continue;
    // Build time and reach are correlated on purpose: a wave with a long rise
    // also gets a gentler easing curve, so slow waves swell in while quick
    // ones snap up. That coupling is what reads as intentional.
    const v = x < R
      ? Math.pow(ss(x / R), 0.70 + 1.70 * r3)
      : Math.pow(1 - ss((x - R) / F), drainExp);
    best = Math.max(best, A * v);
  }
  return best;
}

export class WaveScheduler {
  phase = 0;
  swashBody = 0;
  swashFilm = 0;
  amp = 0;

  constructor(private p: WaveParams) {}

  /** Call once per frame, before uploading uniforms to sim and render. */
  step(dt: number, t: number): void {
    // Speed drifts between sets. Integrating it keeps the train continuous —
    // recomputing phase from `t` with a changed speed rewrites the wave's
    // whole history and makes it jump.
    this.phase += dt * this.p.speed * (0.82 + 0.36 * noise1(t * 0.05 + 11.7));
    this.swashBody = swashAt(t, 1.25, this.p);
    this.swashFilm = Math.max(this.swashBody, swashAt(t, Math.max(this.p.drain, 0.05), this.p));
    this.amp = this.p.amp * (1 - this.p.sizeVar * 0.5 + this.p.sizeVar * noise1(t * 0.08 + 5.3));
  }
}

export const DEFAULT_WAVES: WaveParams = {
  interval: 0.5, jitter: 0.45, drain: 0.35, sizeVar: 0.65, speed: 0.85, amp: 0.055
};
