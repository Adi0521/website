/**
 * Tunables, carried over from the prototype's slider defaults. These are the
 * values Phase 1 was signed off on — the gate was "pressing into the sand
 * feels right", and it is these numbers that felt right. Changing one is a
 * look change, so they live in one table rather than scattered as literals.
 */

/** Sand half-extent in Z, world units. X scales with the field's aspect. */
export const DOMAIN = 2.6;

/**
 * Height texel to world units. The 0.06 × 2.4 factoring is kept from the
 * prototype because `relief` is a user-facing 0..1-ish dial and the product of
 * the other two is what makes a 0.6 stamp a believable few millimetres.
 */
export const heightToWorld = (relief: number): number => 0.06 * relief * 2.4;

/** Transport model — PRD §6.2. Slumping moves sand; it never deletes it. */
export interface TransportParams {
  /** Very slow global drift to rest. Keeps long sessions bounded. */
  decay: number;
  /** Wind smoothing, so fine detail softens before gross shape. */
  smooth: number;
  /** Slump rate. Clamped in-shader below the diffusion stability limit. */
  slump: number;
  /** Angle of repose, as a height difference between neighbours. */
  repose: number;
  /** Loose grain settling into hollows. Not conservative — wind imports it. */
  infill: number;
  /** Seconds a mark holds before filling. Freshly pressed sand is compacted. */
  delay: number;
}

/** Default brush shape. Per-brush overrides arrive with the agent system. */
export interface BrushParams {
  radius: number;
  depth: number;
  /** Rim height as a fraction of depth. Pressed sand pushes *up* at the edge. */
  rim: number;
}

/** The baked static layer: ripples and dunes, regenerated only on resize. */
export interface BakeParams {
  ripAmp: number;
  ripScale: number;
  ripAngle: number;
  duneAmp: number;
}

/** Water — PRD §7. `interval`, `jitter`, `drain`, `sizeVar` live on WaveParams. */
export interface WaterParams {
  seaLevel: number;
  shoreZ: number;
  /** Beach ramp gradient. Shallow, so a small level change sweeps a long way. */
  slope: number;
  waveLen: number;
  /** How far up the beach the swash reaches. */
  surge: number;
  /**
   * How much the swash reach varies along the beach, as a fraction. Zero is
   * the Phase 1 behaviour: one scalar swash, so the sheet arrives dead
   * straight across the whole width and every wave looks identical along its
   * length. Measured effect on how far the waterline wanders, in world units:
   *
   *     0     0.081   the baked ripples alone — this is the noise floor
   *     0.25  0.073   lost in it
   *     0.45  0.123
   *     0.7   0.193   shipped
   *     0.9   0.247
   *
   * Must stay below 1.0. At 1.0 the reach modulation touches zero and beyond
   * it goes negative, which inverts the swash into a wave that sucks backwards.
   */
  swashLateral: number;
  /** How hard the body of water scrubs marks away. */
  waveErase: number;
  /** How fast wet sand dries back. */
  dryRate: number;
  foam: number;
}

/** Look — PRD §5. The low sun is a technical requirement, not a mood. */
export interface LookParams {
  relief: number;
  sparkle: number;
  /** Sun elevation. Grazing: raise it and the surface flattens into plastic. */
  sunEl: number;
  sunAz: number;
  sky: number;
  fog: number;
  exposure: number;
  /** Applied after tone mapping, luminance-preserving. */
  sat: number;
}

/**
 * The focus pull (§10). Every part of it is a number here rather than a
 * constant in a shader, because which of them carries the transition is a look
 * decision and was got wrong once already.
 */
export interface FocusParams {
  /** Mip levels of defocus at full pull. Above ~6 the frame turns to soup. */
  blur: number;
  /** Luminance multiplier at full pull. 1 leaves the scene at its own brightness. */
  dim: number;
  /** 0 keeps the beach's own colour; 1 compresses it toward --sand-shadow. */
  desaturate: number;
  /** Camera push toward its target, as a fraction of the distance. */
  push: number;
}

export interface SandConfig {
  transport: TransportParams;
  brush: BrushParams;
  bake: BakeParams;
  water: WaterParams;
  look: LookParams;
  focus: FocusParams;
}

export const DEFAULT_SAND: SandConfig = {
  transport: { decay: 0.02, smooth: 0.6, slump: 10, repose: 0.012, infill: 0.55, delay: 1.2 },
  brush: { radius: 0.024, depth: 0.34, rim: 0.42 },
  bake: { ripAmp: 0.115, ripScale: 48, ripAngle: 0.42, duneAmp: 0.2 },
  water: {
    seaLevel: 0, shoreZ: 0, slope: 0.085, waveLen: 1.5,
    surge: 0.088, swashLateral: 0.7, waveErase: 4.2, dryRate: 0.12, foam: 1.0,
  },
  look: {
    relief: 1.0, sparkle: 0.55, sunEl: 0.17, sunAz: 2.35,
    sky: 0.6, fog: 0.055, exposure: 0.95, sat: 1.36,
  },
  // A blurred beach, at its own brightness and its own colour.
  focus: { blur: 5.0, dim: 1.0, desaturate: 0.0, push: 0.26 },
};

/**
 * Height of the bare beach ramp at a world Z.
 *
 * MIRRORS `beachY` in src/gl/shaders/common/wave.glsl. That chunk is shared by
 * the simulation and the renderer precisely so they cannot disagree about the
 * waterline — but the CPU has to know the same shape, and shaders cannot answer
 * questions for JavaScript. Two callers need it: the scroll camera, to hold a
 * fixed height above the sand as it travels up the ramp, and pointer picking,
 * to intersect the surface the renderer actually draws.
 *
 * Only this one line is duplicated; the parameters themselves are shared. If
 * `beachY` changes, change this with it. Drift here does not corrupt the
 * waterline — it sinks the camera into the beach, or lands the cursor's dip
 * somewhere the cursor is not.
 */
export function beachHeight(z: number, water: WaterParams): number {
  return Math.min(0.9, Math.max(-1.3, (z - water.shoreZ) * water.slope));
}

/** Debug visualisations, kept from the prototype. 0 is the shipped view. */
export const enum DebugView {
  Beauty = 0,
  Height = 1,
  Normals = 2,
  Disturbance = 3,
}
