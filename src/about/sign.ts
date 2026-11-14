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

    // Fit the INK to the board, not the font box — the same reason hero.ts
    // measures ink: a box with side bearings leaves the word off centre.
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
    g.textBaseline = "alphabetic";
    g.fillText(
      word,
      (cw - inkW) / 2 + m.actualBoundingBoxLeft,
      (ch - inkH) / 2 + m.actualBoundingBoxAscent,
    );

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
      post: [o.postHalfW, -o.postSink, o.boardY + o.boardHalfH * 0.6],
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
