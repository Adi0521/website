/**
 * Camera basis and pointer picking.
 *
 * The idle orbit drift in the prototype is deliberately not ported. PRD §3
 * lists autonomous camera rotation as a non-goal: scroll owns the camera, an
 * orbit fights it, destabilises text placement over a live scene and makes the
 * focus pull impossible to aim. What remains is a camera you can *place* —
 * the scroll driver that places it is the open Phase 2 gap.
 */

export type Vec3 = readonly [number, number, number];

export interface CameraState {
  /** Radians around Y. */
  azimuth: number;
  /** Radians above the horizon. Low, because sand only reads raked. */
  elevation: number;
  distance: number;
  fovDeg: number;
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

/** Orbits the world origin, always looking at it. */
export function cameraBasis(c: CameraState): CameraBasis {
  const ce = Math.cos(c.elevation);
  const ro: Vec3 = [
    Math.cos(c.azimuth) * ce * c.distance,
    Math.sin(c.elevation) * c.distance,
    Math.sin(c.azimuth) * ce * c.distance,
  ];
  const ww = normalize([-ro[0], -ro[1], -ro[2]]);
  const uu = normalize(cross(ww, [0, 1, 0]));
  const vv = cross(uu, ww);
  return { ro, uu, vv, ww, fov: 1 / Math.tan((c.fovDeg * Math.PI) / 360) };
}

/**
 * Intersects the pointer ray with the y=0 plane and returns world XZ.
 *
 * `sx`/`sy` are normalised viewport coordinates with Y **up**, matching the
 * shader's convention rather than the DOM's. Returns null when the ray is
 * level or aimed at the sky, which is a real state: the pointer is over the
 * horizon and there is nothing to press.
 */
export function groundHit(
  b: CameraBasis,
  sx: number,
  sy: number,
  aspect: number,
): [number, number] | null {
  const px = (sx - 0.5) * aspect;
  const py = sy - 0.5;
  const rd = normalize([
    px * b.uu[0] + py * b.vv[0] + b.fov * b.ww[0],
    px * b.uu[1] + py * b.vv[1] + b.fov * b.ww[1],
    px * b.uu[2] + py * b.vv[2] + b.fov * b.ww[2],
  ]);
  if (rd[1] >= -1e-4) return null;
  const t = -b.ro[1] / rd[1];
  if (t < 0 || t > 40) return null;
  return [b.ro[0] + rd[0] * t, b.ro[2] + rd[2] * t];
}
