/**
 * The timeline signpost — PRD §8.2.
 *
 * A weathered board on a post, standing in the sand where the footprint trail
 * begins. Like the name, the word on it is measured off the real heading
 * (`#timeline-h`), so the DOM stays the content (§12) and the scene carries it.
 *
 * Placed up the beach past what the camera can see from the top of the page:
 * the eye trails ~2.8 behind its target and looks back toward the sea, so
 * anything above z≈4.6 is behind it at scroll 0 and walks in from the bottom
 * of the screen as you scroll. The sign comes first, then the prints.
 *
 * Geometry is two analytic boxes (common/sign.glsl); nothing is marched.
 */

import { DEFAULT_CAMERA } from "../beach";

export interface SignProp {
  texture: WebGLTexture;
  /** Foot of the post on the sand. */
  foot: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
  normal: [number, number, number];
  /** Half width, half height, half thickness, centre height. */
  board: [number, number, number, number];
  /** Half width, bottom, top. */
  post: [number, number, number];
  /** Lettering mask width in texels. */
  px: number;
}

export interface SignOptions {
  x: number;
  z: number;
  /** Turn away from square-on to the camera, radians. Positive turns it toward the trail. */
  yaw: number;
  /** Lean back, radians. Posts in sand are never quite plumb. */
  lean: number;
  boardHalfW: number;
  boardHalfH: number;
  boardHalfT: number;
  /** Board centre, height above the sand. */
  boardY: number;
  postHalfW: number;
  /** How far the post goes into the sand, so it never shows a floating end. */
  postSink: number;
  maskPx: number;
}

export const DEFAULT_SIGN: SignOptions = {
  x: -0.1,
  z: 5.0,
  yaw: 0.22,
  lean: 0.05,
  // Low on purpose. The camera backs up the beach looking toward the sea, so
  // the sign enters the frame from right beside the lens; the eye is only
  // ~0.4 above the sand there, and a board at eye height fills the screen.
  // Kept well under that, it passes beneath the view and rises up the frame.
  boardHalfW: 0.2,
  boardHalfH: 0.058,
  boardHalfT: 0.01,
  boardY: 0.22,
  postHalfW: 0.016,
  postSink: 0.12,
  maskPx: 1024,
};

export class TimelineSign {
  private tex: WebGLTexture | null = null;
  private value: SignProp | null = null;
  private word = "";

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly opts: SignOptions = DEFAULT_SIGN,
  ) {}

  get ready(): boolean {
    return this.value !== null;
  }

  get label(): string {
    return this.word;
  }

  /**
   * Cuts the heading's text into a mask the size of the board. `sandY` is the
   * beach height at the sign's z. False if the heading has no text yet.
   */
  build(el: HTMLElement | null, sandY: number): boolean {
    const o = this.opts;
    const word = el?.textContent?.trim() || "Timeline";
    const cs = el ? getComputedStyle(el) : null;
    const family = cs?.fontFamily || "serif";
    const weight = cs?.fontWeight || "700";

    const cw = o.maskPx;
    const ch = Math.round((cw * o.boardHalfH) / o.boardHalfW);
    const cv = document.createElement("canvas");
    cv.width = cw;
    cv.height = ch;
    const g = cv.getContext("2d");
    if (!g) return false;
    g.fillStyle = "#000";
    g.fillRect(0, 0, cw, ch);

    // Hand-painted: each letter is a brush path laid down bristle by bristle
    // (see paintWord). A word with a letter the stroke alphabet lacks falls
    // back to the heading's own face, roughened, so the binding to the DOM
    // still holds if the heading text changes.
    if (!paintWord(g, word, cw, ch)) {
      let size = ch * 0.62;
      g.font = `${weight} ${size}px ${family}`;
      let m = g.measureText(word);
      let inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
      if (inkW > cw * 0.84) {
        size *= (cw * 0.84) / inkW;
        g.font = `${weight} ${size}px ${family}`;
        m = g.measureText(word);
        inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
      }
      const inkH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
      g.fillStyle = "#fff";
      g.fillText(word, (cw - inkW) / 2 + m.actualBoundingBoxLeft, (ch - inkH) / 2 + m.actualBoundingBoxAscent);
    }

    const gl = this.gl;
    if (!this.tex) this.tex = gl.createTexture();
    if (!this.tex) return false;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    // Row 0 is the top of the word; the shader's v runs the same way.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    // Facing the camera's line of sight (the eye sits at azimuth `az` from
    // its target), turned a little by `yaw`, leaning back by `lean`.
    const az = DEFAULT_CAMERA.azimuth - o.yaw;
    const f: [number, number] = [Math.cos(az), Math.sin(az)];
    const right: [number, number, number] = [f[1], 0, -f[0]];
    const cl = Math.cos(o.lean);
    const sl = Math.sin(o.lean);
    const up: [number, number, number] = [-f[0] * sl, cl, -f[1] * sl];
    const normal: [number, number, number] = [
      right[1] * up[2] - right[2] * up[1],
      right[2] * up[0] - right[0] * up[2],
      right[0] * up[1] - right[1] * up[0],
    ];
    this.word = word;
    this.value = {
      texture: this.tex,
      foot: [o.x, sandY, o.z],
      right,
      up,
      normal,
      board: [o.boardHalfW, o.boardHalfH, o.boardHalfT, o.boardY],
      // Topped out under the board's top edge, so its end grain never shows
      // above the board as a dark cap.
      post: [o.postHalfW, -o.postSink, o.boardY + o.boardHalfH * 0.5],
      px: cw,
    };
    return true;
  }

  prop(): SignProp | null {
    return this.value;
  }

  dispose(): void {
    if (this.tex) this.gl.deleteTexture(this.tex);
    this.tex = null;
    this.value = null;
  }
}

// ── Brush lettering ─────────────────────────────────────────────────────────
//
// Strokes in glyph units: baseline y = 0, x-height 1, ascenders ~1.6, y up.
// Each stroke is a Catmull-Rom path through its points, in the order a hand
// would paint it — the brush runs dry toward the END of a stroke, so the
// direction matters.

type Pt = [number, number];
interface Glyph {
  adv: number;
  strokes: Pt[][];
}

const GLYPHS: Record<string, Glyph> = {
  T: {
    adv: 1.2,
    strokes: [
      [[0.0, 1.5], [0.45, 1.56], [1.15, 1.6]],
      [[0.6, 1.58], [0.57, 0.8], [0.52, 0.0]],
    ],
  },
  i: {
    adv: 0.42,
    strokes: [
      [[0.18, 0.95], [0.16, 0.45], [0.13, 0.0]],
      [[0.17, 1.3], [0.22, 1.36]],
    ],
  },
  l: {
    adv: 0.45,
    strokes: [[[0.2, 1.62], [0.17, 0.8], [0.14, 0.12], [0.28, 0.0]]],
  },
  m: {
    adv: 1.3,
    strokes: [
      [[0.04, 0.95], [0.02, 0.0]],
      [[0.04, 0.62], [0.18, 0.92], [0.38, 0.98], [0.52, 0.74], [0.54, 0.0]],
      [[0.55, 0.62], [0.7, 0.92], [0.9, 0.98], [1.04, 0.72], [1.06, 0.0]],
    ],
  },
  n: {
    adv: 0.9,
    strokes: [
      [[0.04, 0.95], [0.02, 0.0]],
      [[0.04, 0.62], [0.2, 0.92], [0.44, 0.98], [0.62, 0.74], [0.64, 0.0]],
    ],
  },
  e: {
    adv: 0.95,
    strokes: [
      [
        [0.06, 0.5], [0.42, 0.52], [0.74, 0.58], [0.66, 0.86], [0.38, 0.98],
        [0.1, 0.78], [0.04, 0.38], [0.24, 0.04], [0.56, 0.0], [0.8, 0.16],
      ],
    ],
  },
};

/** Deterministic, so the sign is the same sign on every visit. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function catmull(pts: Pt[], per: number): Pt[] {
  if (pts.length < 2) return pts;
  const out: Pt[] = [];
  const P = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))]!;
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [P(i - 1), P(i), P(i + 1), P(i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/**
 * Paints `word` in white onto `g` with a thick, half-loaded flat brush.
 * False if any letter is missing from the stroke alphabet.
 */
function paintWord(g: CanvasRenderingContext2D, word: string, cw: number, ch: number): boolean {
  const glyphs = [...word].map((c) => GLYPHS[c]);
  if (glyphs.some((gl) => !gl)) return false;
  const rand = rng(0x5eed);
  const gap = 0.12;
  const total = glyphs.reduce((s, gl) => s + gl!.adv + gap, -gap);
  const unit = Math.min((cw * 0.82) / total, (ch * 0.7) / 1.62);
  const brush = unit * 0.32;
  const x0 = (cw - total * unit) / 2;
  // Baseline a touch below centre: the ascenders need the room.
  const base = ch / 2 + unit * 0.72;

  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = "#fff";
  g.fillStyle = "#fff";
  let pen = 0;
  for (const gl of glyphs) {
    // Hand-painted letters are never quite on the line or quite upright.
    const rot = (rand() - 0.5) * 0.12;
    const dy = (rand() - 0.5) * unit * 0.12;
    const sc = 1 + (rand() - 0.5) * 0.08;
    const ox = x0 + pen * unit;
    const toPx = ([x, y]: Pt): Pt => {
      const xr = x * Math.cos(rot) - y * Math.sin(rot);
      const yr = x * Math.sin(rot) + y * Math.cos(rot);
      return [ox + xr * unit * sc, base + dy - yr * unit * sc];
    };
    for (const stroke of gl!.strokes) {
      const path = catmull(stroke.map(toPx), 14);
      paintStroke(g, path, brush * (0.9 + rand() * 0.2), rand);
    }
    pen += gl!.adv + gap;
  }
  return true;
}

/**
 * One brush stroke as ~30 bristles. Each bristle has its own load of paint,
 * runs out at its own point, and skips where the brush lifts on the grain —
 * which is what turns a smooth line into a brushstroke.
 */
function paintStroke(g: CanvasRenderingContext2D, path: Pt[], width: number, rand: () => number): void {
  const n = path.length;
  if (n < 2) {
    g.beginPath();
    g.arc(path[0]![0], path[0]![1], width / 2, 0, Math.PI * 2);
    g.fill();
    return;
  }
  // Arc length, for the dry-out and the taper.
  const len: number[] = [0];
  for (let i = 1; i < n; i++) len.push(len[i - 1]! + Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]));
  const L = len[n - 1]! || 1;
  // A loaded brush leaves a blob where it first touches down.
  g.globalAlpha = 0.95;
  g.beginPath();
  g.ellipse(path[0]![0], path[0]![1], width * 0.55, width * 0.48, rand() * 3, 0, Math.PI * 2);
  g.fill();

  const bristles = 36;
  for (let b = 0; b < bristles; b++) {
    const off = (b / (bristles - 1) - 0.5) + (rand() - 0.5) * 0.05;
    const load = 0.55 + rand() * 0.45; // how far along this bristle's paint lasts
    const alpha = 0.55 + rand() * 0.45;
    const phase = rand() * 100;
    g.lineWidth = (width / bristles) * (2.2 + rand() * 1.6);
    g.globalAlpha = alpha;
    let drawing = false;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const u = len[i]! / L;
      const a = path[Math.max(0, i - 1)]!, c = path[Math.min(n - 1, i + 1)]!;
      let tx = c[0] - a[0], ty = c[1] - a[1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      // Brush swells as it presses in, then thins as it lifts off.
      const press = Math.min(1, 0.55 + u * 4) * (1 - 0.25 * u * u);
      const x = path[i]![0] - ty * off * width * press;
      const y = path[i]![1] + tx * off * width * press;
      // Dry brush: past this bristle's load it skips, more and more often.
      const dry = u > load ? (u - load) / (1 - load + 1e-3) : 0;
      const skip = Math.sin(len[i]! * 0.21 + phase) * 0.5 + 0.5 < dry * 1.3 ||
        (Math.abs(off) > 0.42 && Math.sin(len[i]! * 0.07 + phase * 1.7) > 0.55);
      if (skip) { drawing = false; continue; }
      if (!drawing) { g.moveTo(x, y); drawing = true; } else g.lineTo(x, y);
    }
    g.stroke();
  }
  g.globalAlpha = 1;
}
