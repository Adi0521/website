/**
 * Camera basis and pointer picking.
 *
 * The idle orbit drift in the prototype is deliberately not ported. PRD §3
 * lists autonomous camera rotation as a non-goal: scroll owns the camera, an
 * orbit fights it, destabilises text placement over a live scene and makes the
 * focus pull impossible to aim. What remains is a camera you can *place* —
 * the scroll driver that places it is the open Phase 2 gap.
 */

import { beachHeight, type WaterParams } from "../sand/params";

export type Vec3 = readonly [number, number, number];

export interface CameraState {
  /** Radians around Y. */
  azimuth: number;
  /** Radians above the horizon. Low, because sand only reads raked. */
  elevation: number;
  distance: number;
  fovDeg: number;
  /**
   * World point the camera orbits and looks at. Decoupling this from the
   * origin is what lets the camera travel along the beach at all — and it is
   * what the sand patch follows, so the interactive zone goes with it.
   */
  target: Vec3;
}

export interface CameraBasis {
  ro: Vec3;
  uu: Vec3;
  vv: Vec3;
  ww: Vec3;
  /** Focal length, matching the shader's `uFov`. */
  fov: number;
}

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const normalize = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Orbits `target`, always looking at it. */
export function cameraBasis(c: CameraState): CameraBasis {
  const ce = Math.cos(c.elevation);
  const t = c.target;
  const ro: Vec3 = [
    t[0] + Math.cos(c.azimuth) * ce * c.distance,
    t[1] + Math.sin(c.elevation) * c.distance,
    t[2] + Math.sin(c.azimuth) * ce * c.distance,
  ];
  const ww = normalize([t[0] - ro[0], t[1] - ro[1], t[2] - ro[2]]);
  const uu = normalize(cross(ww, [0, 1, 0]));
  const vv = cross(uu, ww);
  return { ro, uu, vv, ww, fov: 1 / Math.tan((c.fovDeg * Math.PI) / 360) };
}

/**
 * Intersects the pointer ray with the beach ramp and returns world XZ.
 *
 * `sx`/`sy` are normalised viewport coordinates with Y **up**, matching the
 * shader's convention rather than the DOM's. Returns null when the ray never
 * meets the ramp, which is a real state: the pointer is over the horizon and
 * there is nothing to press.
 *
 * **The ground is not y=0.** The beach rises with z, `scroll.ts` places the
 * camera target on that ramp, and the renderer marches against it — so a
 * picker using a flat plane is the only part of the system that disagrees
 * about where the sand is. It put the dip past the cursor by the eye's height
 * above the ramp divided by the ray's descent, which with a deliberately
 * grazing camera is several world units, and grew as scrolling climbed the
 * beach. That is the whole reason this takes `water`.
 */
export function groundHit(
  b: CameraBasis,
  sx: number,
  sy: number,
  aspect: number,
  water: WaterParams,
): [number, number] | null {
  const px = (sx - 0.5) * aspect;
  const py = sy - 0.5;
  const rd = normalize([
    px * b.uu[0] + py * b.vv[0] + b.fov * b.ww[0],
    px * b.uu[1] + py * b.vv[1] + b.fov * b.ww[1],
    px * b.uu[2] + py * b.vv[2] + b.fov * b.ww[2],
  ]);

  // Ramp plane: y = (z - shoreZ)·slope, so ro.y + t·rd.y = (ro.z + t·rd.z -
  // shoreZ)·slope, which rearranges to the t below. The denominator is the
  // ray's descent RELATIVE to the ramp: a ray falling slower than the beach
  // rises runs parallel to it forever and is the horizon case.
  const denom = rd[1] - water.slope * rd[2];
  if (denom >= -1e-4) return null;
  let t = (water.slope * (b.ro[2] - water.shoreZ) - b.ro[1]) / denom;
  let z = b.ro[2] + rd[2] * t;

  // Beyond either clamp the ramp flattens out, so the sloped solve overshoots
  // and the surface there is an ordinary horizontal plane. Both clamps sit
  // well outside the shipped camera travel — this keeps the far case sane
  // rather than silently wrong, and is approximate only at the knee itself.
  const y = beachHeight(z, water);
  if (Math.abs(y - (z - water.shoreZ) * water.slope) > 1e-6) {
    if (rd[1] >= -1e-4) return null;
    t = (y - b.ro[1]) / rd[1];
    z = b.ro[2] + rd[2] * t;
  }

  if (t < 0 || t > 40) return null;
  return [b.ro[0] + rd[0] * t, z];
}
