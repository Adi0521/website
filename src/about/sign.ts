/**
 * The signposts along the timeline — PRD §8.2.
 *
 * Weathered boards on posts, standing in the sand: a "Timeline" sign where the
 * footprint trail begins, then one beside each milestone's prints, carrying
 * its date, where, and what. The page's own timeline text stays in the DOM for
 * §12 (screen readers, search, no-WebGL) but goes transparent while the scene
 * carries it — the signs ARE the timeline on the beach.
 *
 * Placed up the beach past what the camera can see from the top of the page:
 * the eye trails ~2.8 behind its target and looks back toward the sea, so
 * anything above z≈4.6 is behind it at scroll 0 and walks in from the bottom
 * of the screen as you scroll. The "Timeline" sign comes first, then the
 * prints and their signs.
 *
 * Geometry is two analytic boxes per sign (common/sign.glsl); nothing is
 * marched. All boards' lettering is painted into ONE atlas texture.
 */

import { DEFAULT_CAMERA } from "../beach";
import type { Milestone } from "./milestones";
import { DEFAULT_TRAIL } from "./trail";

/** Must match MAX_SIGNS in common/sign.glsl. */
export const MAX_SIGNS = 8;

/** The brush-lettering face for everything but the hand-drawn "Timeline". */
const SIGN_FONT = '"CaveatBrush"';

export interface SignProp {
  /** Foot of the post on the sand. */
  foot: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
  normal: [number, number, number];
  /** Half width, half height, half thickness, centre height. */
  board: [number, number, number, number];
  /** Half width, bottom, top. */
  post: [number, number, number];
  /** This board's rectangle in the atlas: u0, v0, u1, v1. */
  uv: [number, number, number, number];
  /** Board width in atlas texels. */
  px: number;
  /**
   * The scroll pinned at this board's top corner, or null (the Timeline sign
   * has none): side (+1 local right / -1 left), half width, unrolled length,
   * rod height — sign-local, as the shader reads it.
   */
  scroll: [number, number, number, number] | null;
  /** The scroll's text in the atlas. */
  scrollUV: [number, number, number, number];
  /** 0 rolled .. 1 unrolled, eased toward `scrollTarget` every frame. */
  open: number;
  scrollTarget: number;
}

export interface SignSet {
  texture: WebGLTexture;
  signs: SignProp[];
}

export interface SignShape {
  /** Turn away from square-on to the camera, radians. Positive turns the face toward +x. */
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
}

// Low on purpose. The camera backs up the beach looking toward the sea, so a
// sign enters the frame from right beside the lens; the eye is only ~0.4 above
// the sand there, and a board at eye height fills the screen. Kept well under
// that, it passes beneath the view and rises up the frame.
export const TIMELINE_SIGN: SignShape & { x: number; z: number } = {
  // Left of the trail (x 0.1); turned a little back toward it.
  x: -0.45,
  z: 4.8,
  yaw: 0.22,
  lean: 0.05,
  boardHalfW: 0.2,
  boardHalfH: 0.058,
  boardHalfT: 0.01,
  boardY: 0.22,
  postHalfW: 0.016,
  postSink: 0.12,
};

/** A milestone sign: taller, for three lines — date, where, what. */
export const MILESTONE_SIGN: SignShape & { offset: number; scrollHalfW: number; scrollLength: number } = {
  /** Distance from the trail's centre line; signs alternate sides. */
  offset: 0.55,
  /**
   * The scroll: a small page, half its width and its unrolled length. Small
   * on purpose — it is read with the camera zoomed in on it, not from the trail.
   */
  scrollHalfW: 0.045,
  scrollLength: 0.13,
  yaw: 0.2,
  lean: 0.04,
  boardHalfW: 0.2,
  boardHalfH: 0.1,
  boardHalfT: 0.01,
  boardY: 0.24,
  postHalfW: 0.016,
  postSink: 0.12,
};

/** Atlas texels across one board, and across one scroll page. */
const CELL_W = 1024;
/** Must match SCROLL_PX in common/sign.glsl. */
const SCROLL_W = 512;
/** Gap between atlas cells, so mips do not bleed one board into the next. */
const PAD = 24;

type Paint = (g: CanvasRenderingContext2D, w: number, h: number) => void;

interface Placed {
  x: number;
  z: number;
  shape: SignShape;
  yaw: number;
  paint: Paint;
  /** Which local side the scroll hangs on, and what is written on it. */
  scroll?: { side: number; paint: Paint };
}

export class SignPosts {
  private tex: WebGLTexture | null = null;
  private value: SignSet | null = null;
  private fontLoading = false;
  /** Set when a font arrives and the boards should be repainted. */
  stale = false;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  get ready(): boolean {
    return this.value !== null;
  }

  /**
   * Paints every board and places every sign. `heading` is the "Timeline"
   * <h2>; `sandAt(z)` is the beach height. False until the brush face has
   * loaded — painting with a fallback face would bake the wrong letters in.
   */
  build(heading: HTMLElement | null, milestones: readonly Milestone[], sandAt: (z: number) => number): boolean {
    if ("fonts" in document && !document.fonts.check(`40px ${SIGN_FONT}`)) {
      if (!this.fontLoading) {
        this.fontLoading = true;
        void document.fonts.load(`40px ${SIGN_FONT}`).then(() => {
          this.fontLoading = false;
          this.stale = true;
        });
      }
      return false;
    }

    const word = heading?.textContent?.trim() || "Timeline";
    const placed: Placed[] = [
      {
        x: TIMELINE_SIGN.x, z: TIMELINE_SIGN.z, shape: TIMELINE_SIGN, yaw: TIMELINE_SIGN.yaw,
        paint: (g, w, h) => {
          if (!paintWord(g, word, w, h)) paintLines(g, [{ text: word, size: 1 }], w, h, rng(7));
        },
      },
    ];
    milestones.slice(0, MAX_SIGNS - 1).forEach((m, i) => {
      // Alternating sides of the trail, starting opposite the Timeline sign,
      // each turned a little toward the prints it stands beside. The order
      // puts the LAST sign on the left: the camera's arc swings the view right
      // as the scroll ends, and a right-hand sign that close is cut off.
      const side = i % 2 === 0 ? 1 : -1;
      placed.push({
        x: DEFAULT_TRAIL.x + side * MILESTONE_SIGN.offset,
        z: m.z,
        shape: MILESTONE_SIGN,
        yaw: -side * MILESTONE_SIGN.yaw,
        // Pinned at the board's top corner on the TRAIL side — the outer
        // corner sits off-screen or behind the next sign. Local right is world
        // +x near enough (signs face the camera), so inward is -side.
        scroll: {
          side: -side,
          paint: (g, w, h) =>
            paintScroll(g, m.org, `${m.label} \u00b7 ${m.role}`, m.story, w, h, rng(301 + i)),
        },
        paint: (g, w, h) =>
          paintLines(g, [
            { text: m.label.toUpperCase(), size: 0.62 },
            { text: m.org, size: 1.0 },
            { text: m.role, size: 0.78 },
          ], w, h, rng(101 + i)),
      });
    });

    // The atlas, in three columns so it stays well inside every GPU's texture
    // size limit: the boards down the first, the scroll pages alternating
    // down the other two. Every cell padded on every side, so mips do not
    // bleed one into the next.
    const cells = placed.map((p) => Math.round((CELL_W * p.shape.boardHalfH) / p.shape.boardHalfW));
    const scrollH = Math.round((SCROLL_W * MILESTONE_SIGN.scrollLength) / (2 * MILESTONE_SIGN.scrollHalfW));
    const nScroll = placed.filter((p) => p.scroll).length;
    const colX = [PAD, PAD * 2 + CELL_W, PAD * 3 + CELL_W + SCROLL_W];
    const W = PAD * 4 + CELL_W + 2 * SCROLL_W;
    const H = Math.max(
      cells.reduce((s, h) => s + h + PAD, PAD),
      Math.ceil(nScroll / 2) * (scrollH + PAD) + PAD,
    );
    const colY = [PAD, PAD];
    let nth = 0;
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const g = cv.getContext("2d");
    if (!g) return false;
    g.fillStyle = "#000";
    g.fillRect(0, 0, W, H);

    const signs: SignProp[] = [];
    let y = PAD;
    placed.forEach((p, i) => {
      const ch = cells[i]!;
      g.save();
      g.translate(PAD, y);
      g.beginPath();
      g.rect(0, 0, CELL_W, ch);
      g.clip();
      p.paint(g, CELL_W, ch);
      g.restore();
      const sign = this.place(p, sandAt(p.z), [PAD / W, y / H, (PAD + CELL_W) / W, (y + ch) / H]);
      y += ch + PAD;
      if (p.scroll) {
        const col = nth++ % 2;
        const sx = colX[col + 1]!;
        const sy = colY[col]!;
        g.save();
        g.translate(sx, sy);
        g.beginPath();
        g.rect(0, 0, SCROLL_W, scrollH);
        g.clip();
        p.scroll.paint(g, SCROLL_W, scrollH);
        g.restore();
        sign.scroll = [
          p.scroll.side,
          MILESTONE_SIGN.scrollHalfW,
          MILESTONE_SIGN.scrollLength,
          // The rod sits just under the board's top edge.
          p.shape.boardY + p.shape.boardHalfH - 0.012,
        ];
        sign.scrollUV = [sx / W, sy / H, (sx + SCROLL_W) / W, (sy + scrollH) / H];
        colY[col] = sy + scrollH + PAD;
        // A rebuild (resize, font arriving) keeps whatever was open, open.
        const prev = this.value?.signs[i];
        if (prev) {
          sign.open = prev.open;
          sign.scrollTarget = prev.scrollTarget;
        }
      }
      signs.push(sign);
    });

    const gl = this.gl;
    if (!this.tex) this.tex = gl.createTexture();
    if (!this.tex) return false;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    // Row 0 is the top of each board; the shader's v runs the same way.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    this.value = { texture: this.tex, signs };
    return true;
  }

  /** Facing the camera's line of sight, turned by `yaw`, leaning back by `lean`. */
  private place(p: Placed, sandY: number, uv: [number, number, number, number]): SignProp {
    const s = p.shape;
    const az = DEFAULT_CAMERA.azimuth - p.yaw;
    const f: [number, number] = [Math.cos(az), Math.sin(az)];
    const right: [number, number, number] = [f[1], 0, -f[0]];
    const cl = Math.cos(s.lean);
    const sl = Math.sin(s.lean);
    const up: [number, number, number] = [-f[0] * sl, cl, -f[1] * sl];
    const normal: [number, number, number] = [
      right[1] * up[2] - right[2] * up[1],
      right[2] * up[0] - right[0] * up[2],
      right[0] * up[1] - right[1] * up[0],
    ];
    return {
      foot: [p.x, sandY, p.z],
      right,
      up,
      normal,
      board: [s.boardHalfW, s.boardHalfH, s.boardHalfT, s.boardY],
      // Topped out under the board's top edge, so its end grain never shows
      // above the board as a dark cap.
      post: [s.postHalfW, -s.postSink, s.boardY + s.boardHalfH * 0.5],
      uv,
      px: CELL_W,
      scroll: null,
      scrollUV: [0, 0, 0, 0],
      open: 0,
      scrollTarget: 0,
    };
  }

  /**
   * Which sign's scroll the ray `ro + t·rd` lands on first, or -1. A box round
   * each scroll as it currently stands — padded, since a small scroll is a
   * small target — tested against every board too, so a scroll hidden behind
   * a nearer sign cannot be clicked through it.
   */
  pick(ro: readonly number[], rd: readonly number[]): number {
    if (!this.value) return -1;
    let best = Infinity;
    let hit = -1;
    this.value.signs.forEach((s, i) => {
      const o = toLocal(s, [ro[0]! - s.foot[0], ro[1]! - s.foot[1], ro[2]! - s.foot[2]]);
      const d = toLocal(s, rd);
      const [bw, bh, bt, by] = s.board;
      const tb = rayBox(o, d, [-bw, by - bh, -bt - 2 * s.post[0]], [bw, by + bh, bt]);
      if (tb < best) {
        best = tb;
        hit = -1;
      }
      if (!s.scroll) return;
      const g = scrollGeom(s);
      const pad = 0.025;
      const ts = rayBox(
        o, d,
        [g.xc - g.hw - pad, g.yr - g.rr - pad, g.z0 - pad],
        [g.xc + g.hw + pad, g.yt + pad, g.z0 + pad],
      );
      // A scroll in front of its own board's face still wins the tie. The
      // finite check matters: a miss is Infinity, and Infinity <= Infinity
      // would make every ray "hit" a scroll and block the sand everywhere.
      if (ts < Infinity && ts <= best + 1e-4) {
        best = ts;
        hit = i;
      }
    });
    return hit;
  }

  /** Sets where scroll `i` is heading: 1 unrolled, 0 rolled. */
  setTarget(i: number, target: number): void {
    const s = this.value?.signs[i];
    if (s?.scroll) s.scrollTarget = target;
  }

  /** How far scroll `i` has unrolled, 0..1. */
  openness(i: number): number {
    return this.value?.signs[i]?.open ?? 0;
  }

  /**
   * The close-up for reading scroll `i`, fully unrolled: square on to the page
   * from a touch above, near enough that the page fills most of the frame.
   */
  zoomView(i: number, fovDeg: number): { target: [number, number, number]; azimuth: number; elevation: number; distance: number } | null {
    const s = this.value?.signs[i];
    if (!s?.scroll) return null;
    const g = scrollGeom(s, 1);
    const lx = g.xc, ly = g.yt - g.len / 2, lz = g.z0;
    const target: [number, number, number] = [0, 1, 2].map(
      (k) => s.foot[k]! + s.right[k]! * lx + s.up[k]! * ly + s.normal[k]! * lz,
    ) as [number, number, number];
    // The renderer's focal length is 1/tan(fov/2) against a frame one unit
    // TALL (pix runs ±0.5), so the frame spans tan(fov/2)·d at distance d —
    // half what the usual 2·tan(fov/2)·d would say.
    // Leaves room for the rod above and the roll below the page.
    const fill = 0.7;
    const distance = g.len / fill / Math.tan((fovDeg * Math.PI) / 360);
    return { target, azimuth: Math.atan2(s.normal[2], s.normal[0]), elevation: 0.1, distance };
  }

  /** Eases every scroll toward its target. `dt` in seconds. */
  animate(dt: number): void {
    if (!this.value) return;
    // About a second to unroll — paper has some weight to it.
    const k = 1 - Math.exp(-3.5 * dt);
    for (const s of this.value.signs) {
      s.open += (s.scrollTarget - s.open) * k;
      if (Math.abs(s.scrollTarget - s.open) < 0.001) s.open = s.scrollTarget;
    }
  }

  get set(): SignSet | null {
    return this.value;
  }

  dispose(): void {
    if (this.tex) this.gl.deleteTexture(this.tex);
    this.tex = null;
    this.value = null;
  }
}

/**
 * A scroll's sign-local geometry, exactly as common/sign.glsl builds it —
 * keep the two in step. `open` defaults to the eased amount being drawn.
 */
function scrollGeom(s: SignProp, open?: number) {
  const [side, hw, len, yt] = s.scroll!;
  const o = open ?? s.open;
  const op = o * o * (3 - 2 * o);
  const xc = side * (s.board[0] + 0.008 + hw);
  const z0 = s.board[2] + 0.006;
  const rr = 0.01 + (0.006 - 0.01) * op;
  const yr = yt - 0.0035 - rr - len * op;
  return { side, hw, len, yt, xc, z0, rr, yr };
}

type Vec3 = readonly number[];
function toLocal(s: SignProp, v: Vec3): [number, number, number] {
  const dot = (a: Vec3, b: Vec3) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  return [dot(v, s.right), dot(v, s.up), dot(v, s.normal)];
}

/** Slab test: entry distance, or Infinity for a miss (or a box behind the ray). */
function rayBox(o: Vec3, d: Vec3, lo: Vec3, hi: Vec3): number {
  let tn = -Infinity;
  let tf = Infinity;
  for (let k = 0; k < 3; k++) {
    const dk = Math.abs(d[k]!) < 1e-9 ? 1e-9 : d[k]!;
    const a = (lo[k]! - o[k]!) / dk;
    const b = (hi[k]! - o[k]!) / dk;
    tn = Math.max(tn, Math.min(a, b));
    tf = Math.min(tf, Math.max(a, b));
  }
  return tf >= Math.max(tn, 0) ? Math.max(tn, 0) : Infinity;
}

/**
 * What is written inside a scroll: the place as a heading, the date and role
 * under it, a ruled line, then the story — a few sentences, since it is read
 * zoomed in — wrapped to fill the page, in brown-ink brush lettering.
 */
function paintScroll(
  g: CanvasRenderingContext2D,
  title: string,
  sub: string,
  body: string,
  w: number,
  h: number,
  rand: () => number,
): void {
  const margin = w * 0.1;
  const maxW = w - 2 * margin;
  g.fillStyle = "#fff";
  g.strokeStyle = "#fff";
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  const wrap = (text: string, font: string): string[] => {
    g.font = font;
    const out: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (g.measureText(next).width > maxW && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    if (line) out.push(line);
    return out;
  };
  // Largest body size at which heading, sub-line and story all fit the page.
  let size = w * 0.12;
  let lines: string[] = [];
  for (; size > 8; size *= 0.95) {
    lines = wrap(body, `${size}px ${SIGN_FONT}`);
    const used = size * 1.6 + size * 1.2 + size * 0.8 + lines.length * size * 1.12;
    if (used < h * 0.88) break;
  }
  let y = h * 0.06 + size * 1.45;
  g.font = `${size * 1.45}px ${SIGN_FONT}`;
  g.fillText(title, margin, y);
  y += size * 1.15;
  g.globalAlpha = 0.8;
  g.font = `${size * 0.85}px ${SIGN_FONT}`;
  g.fillText(sub, margin, y);
  g.globalAlpha = 1;
  // A ruled line, drawn by hand.
  y += size * 0.45;
  g.lineWidth = Math.max(2, size * 0.06);
  g.beginPath();
  g.moveTo(margin, y);
  g.quadraticCurveTo(w / 2, y + size * (rand() - 0.5) * 0.15, w - margin, y + size * 0.05);
  g.stroke();
  y += size * 0.2;
  g.font = `${size}px ${SIGN_FONT}`;
  for (const l of lines) {
    y += size * 1.12;
    g.save();
    g.translate(margin + (rand() - 0.5) * size * 0.08, y);
    g.rotate((rand() - 0.5) * 0.01);
    g.fillText(l, 0, 0);
    g.restore();
  }
}

/**
 * Lines of brush lettering in the Caveat Brush face, then roughened into
 * paint: edges doubled with a little jitter (a brush never lands twice in the
 * same place), and streaks of dry brush wiped out along the stroke direction.
 */
function paintLines(
  g: CanvasRenderingContext2D,
  lines: { text: string; size: number }[],
  w: number,
  h: number,
  rand: () => number,
): void {
  const tc = document.createElement("canvas");
  tc.width = w;
  tc.height = h;
  const t = tc.getContext("2d");
  if (!t) return;
  const total = lines.reduce((s, l) => s + l.size, 0);
  const lineH = (h * 0.84) / total;
  let y = h * 0.08;
  t.fillStyle = "#fff";
  t.textAlign = "center";
  t.textBaseline = "middle";
  for (const l of lines) {
    let px = lineH * l.size * 1.05;
    t.font = `${px}px ${SIGN_FONT}`;
    const mw = t.measureText(l.text).width;
    if (mw > w * 0.88) {
      px *= (w * 0.88) / mw;
      t.font = `${px}px ${SIGN_FONT}`;
    }
    const cy = y + (lineH * l.size) / 2;
    const rot = (rand() - 0.5) * 0.05;
    for (let k = 0; k < 3; k++) {
      t.save();
      t.translate(w / 2 + (rand() - 0.5) * px * 0.03, cy + (rand() - 0.5) * px * 0.03);
      t.rotate(rot);
      t.globalAlpha = k === 0 ? 1 : 0.6;
      t.fillText(l.text, 0, 0);
      t.restore();
    }
    y += lineH * l.size;
  }
  // Dry brush: thin streaks wiped out of the paint, mostly along the line.
  t.globalCompositeOperation = "destination-out";
  t.lineCap = "round";
  const n = Math.round(h * 1.4);
  for (let k = 0; k < n; k++) {
    const sy = rand() * h;
    const sx = rand() * w;
    const len = w * (0.05 + rand() * 0.3);
    t.globalAlpha = 0.15 + rand() * 0.45;
    t.lineWidth = 0.8 + rand() * 2.2;
    t.beginPath();
    t.moveTo(sx, sy);
    t.lineTo(sx + len, sy + (rand() - 0.5) * len * 0.06);
    t.stroke();
  }
  t.globalCompositeOperation = "source-over";
  t.globalAlpha = 1;
  g.drawImage(tc, 0, 0);
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
