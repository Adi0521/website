/**
 * The footprint trail — PRD §8.2.
 *
 * "Milestones running toward the horizon, recent ones near and crisp, older
 * ones receding and half-eroded."
 *
 * ── Why a mask, not brushes ────────────────────────────────────────────────
 *
 * The first attempt pressed each print with the ordinary `press` brush, and the
 * field takes ONE brush per step (SandField.step) — so the prints could only be
 * written on frames the pointer did not want, and the trail appeared when the
 * cursor left the sand and eroded when it came back.
 *
 * The mask stamp is a second footprint source inside the same stamp pass, and
 * it presses independently of the pointer. The name stopped using it when it
 * became geometry, so the whole trail goes in as ONE mask, restamped every
 * frame About is showing. That is also how the prints persist: the field has no
 * per-texel storage left for a long fill delay (§6.1 spends all four
 * channels), so a mark that must last is held by being restamped, not delayed.
 * Dig into a print with the cursor and the stamp presses it straight back.
 *
 * ── Age ────────────────────────────────────────────────────────────────────
 *
 * Older prints are shallower and softer. Depth rides in the mask's GREEN
 * channel as a fraction of red (sim.frag reads g/r), and softness is a wider
 * canvas blur. Both are keyed to the milestone's place in the list — its AGE —
 * not to its distance: milestones.ts lays `now` lowest on the beach, so keyed
 * to distance the oldest print would come out the crispest.
 */

import type { MaskStamp } from "../sand/mask";
import type { Milestone } from "./milestones";

export interface TrailOptions {
  /** World x the trail runs along. Right of centre, clear of the text column. */
  x: number;
  /** Foot length and width, world units. */
  footLength: number;
  footWidth: number;
  /** Gap between the two feet of a pair, centre to centre, world units. */
  stance: number;
  /** Outward splay of each foot, radians. */
  splay: number;
  /** Press depth of the newest print, field units. Older ones scale down. */
  depth: number;
  /** Depth of the oldest print, as a fraction of `depth`. */
  oldestDepth: number;
  rim: number;
  /** Canvas blur in mask pixels, newest and oldest. */
  softNew: number;
  softOld: number;
  /** Mask resolution, pixels per world unit. */
  pxPerUnit: number;
}

export const DEFAULT_TRAIL: TrailOptions = {
  x: 0.3,
  footLength: 0.26,
  footWidth: 0.1,
  stance: 0.17,
  splay: 0.12,
  // Shallow, and soft-edged, on purpose. At 0.42 with a 2.5px blur the walls
  // ran ~35x steeper than the angle of repose: slumping tore them down every
  // step, the restamp pushed them back, and the fight rendered as jagged spikes.
  // A footprint in dry sand is a centimetre or two, not a crater.
  depth: 0.14,
  oldestDepth: 0.4,
  rim: 0.35,
  softNew: 5,
  softOld: 12,
  pxPerUnit: 320,
};

export class FootprintTrail {
  private tex: WebGLTexture | null = null;
  private centre: [number, number] = [0, 0];
  private half: [number, number] = [1, 1];

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly opts: TrailOptions = DEFAULT_TRAIL,
  ) {}

  get ready(): boolean {
    return this.tex !== null;
  }

  /**
   * Rasterizes every print into one mask. Ordered as `milestones` is: the
   * first entry is the newest.
   */
  build(milestones: readonly Milestone[]): boolean {
    if (milestones.length === 0) return false;
    const o = this.opts;
    const zs = milestones.map((m) => m.z);
    // Room round the outermost prints for the rim and the blur.
    const margin = o.footLength;
    const z0 = Math.min(...zs) - margin;
    const z1 = Math.max(...zs) + margin;
    const halfX = o.stance / 2 + o.footWidth + margin * 0.5;
    this.centre = [o.x, (z0 + z1) / 2];
    this.half = [halfX, (z1 - z0) / 2];

    const w = Math.ceil(2 * halfX * o.pxPerUnit);
    const h = Math.ceil((z1 - z0) * o.pxPerUnit);
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const g = cv.getContext("2d");
    if (!g) return false;
    g.fillStyle = "#000";
    g.fillRect(0, 0, w, h);

    const n = milestones.length;
    milestones.forEach((m, i) => {
      const age = n > 1 ? i / (n - 1) : 0; // 0 newest, 1 oldest
      const depth = 1 - (1 - o.oldestDepth) * age;
      const soft = o.softNew + (o.softOld - o.softNew) * age;
      // Canvas row 0 is the smaller-z edge of the rect (see the orientation
      // note in sand/mask.ts), which is toward the sea — so "up" on the canvas
      // is the way the toes point.
      const cy = (m.z - z0) * o.pxPerUnit;
      const cx = w / 2;
      const off = (o.stance / 2) * o.pxPerUnit;
      // RED is coverage, GREEN is depth as a fraction of it. Filled in one
      // colour so the blur spreads both channels identically and g/r stays
      // the print's depth right out into the rim.
      g.fillStyle = `rgb(255, ${Math.round(255 * depth)}, 0)`;
      g.filter = `blur(${soft}px)`;
      // Right foot a little ahead of the left, as people stand.
      this.foot(g, cx - off, cy + 0.03 * o.pxPerUnit, -o.splay, false);
      this.foot(g, cx + off, cy - 0.03 * o.pxPerUnit, o.splay, true);
      g.filter = "none";
    });

    const gl = this.gl;
    if (!this.tex) this.tex = gl.createTexture();
    if (!this.tex) return false;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    // Unflipped, as every field mask is — see sand/mask.ts.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return true;
  }

  /**
   * One bare foot, toes toward canvas-up. Heel, a sole that narrows through
   * the arch on the inside, the ball, and five toes graded from the big toe on
   * the inner edge.
   */
  private foot(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    angle: number,
    right: boolean,
  ): void {
    const L = this.opts.footLength * this.opts.pxPerUnit;
    const W = this.opts.footWidth * this.opts.pxPerUnit;
    // +1 puts the inside edge (big toe, arch) toward the other foot.
    const inner = right ? -1 : 1;
    g.save();
    g.translate(x, y);
    g.rotate(angle);

    g.beginPath();
    g.ellipse(0, 0.30 * L, 0.36 * W, 0.17 * L, 0, 0, Math.PI * 2); // heel
    g.fill();
    // Sole: the outer edge runs straight, the inner edge pinches at the arch.
    g.beginPath();
    g.moveTo(-inner * 0.34 * W, 0.30 * L);
    g.lineTo(-inner * 0.44 * W, -0.10 * L);
    g.lineTo(inner * 0.40 * W, -0.12 * L);
    g.quadraticCurveTo(inner * 0.06 * W, 0.08 * L, inner * 0.30 * W, 0.30 * L);
    g.closePath();
    g.fill();
    g.beginPath();
    g.ellipse(0, -0.12 * L, 0.48 * W, 0.15 * L, 0, 0, Math.PI * 2); // ball
    g.fill();

    // Toes: big toe on the inside, then four smaller along a falling arc.
    const toes = [
      { u: 0.30, v: -0.34, r: 0.17 },
      { u: 0.06, v: -0.36, r: 0.115 },
      { u: -0.13, v: -0.33, r: 0.10 },
      { u: -0.29, v: -0.29, r: 0.09 },
      { u: -0.42, v: -0.23, r: 0.08 },
    ];
    for (const t of toes) {
      g.beginPath();
      g.arc(inner * t.u * W, t.v * L, t.r * W, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  /** The stamp, held at full pressure: the mask carries each print's depth. */
  stamp(): MaskStamp | null {
    if (!this.tex) return null;
    return {
      texture: this.tex,
      center: this.centre,
      half: this.half,
      pressure: 1,
      depth: this.opts.depth,
      rim: this.opts.rim,
    };
  }

  dispose(): void {
    if (this.tex) this.gl.deleteTexture(this.tex);
    this.tex = null;
  }
}
