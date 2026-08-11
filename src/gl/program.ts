/**
 * Program compilation and uniform plumbing.
 *
 * Every pass is one fullscreen triangle — there is no geometry anywhere in
 * this engine, because the terrain is raymarched (PRD §6.3). A triangle that
 * overhangs the viewport beats a quad: one primitive, no diagonal seam.
 */

/** Thrown with the driver's log attached so the caller can show or report it. */
export class ShaderError extends Error {
  constructor(
    readonly stage: string,
    readonly log: string,
  ) {
    super(`${stage}: ${log}`);
    this.name = "ShaderError";
  }
}

export class Program {
  private readonly loc = new Map<string, WebGLUniformLocation | null>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly program: WebGLProgram,
  ) {
    const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(program, i);
      if (info) this.loc.set(info.name, gl.getUniformLocation(program, info.name));
    }
  }

  use(): void {
    this.gl.useProgram(this.program);
  }

  /**
   * Uniforms optimised out by the compiler are simply absent, so every setter
   * is a no-op on an unknown name. That is deliberate: render.frag declares
   * uniforms it does not currently read, and a stricter lookup would turn a
   * dead uniform into a crash at the first frame.
   */
  private at(name: string): WebGLUniformLocation | null {
    return this.loc.get(name) ?? null;
  }

  f(name: string, v: number): void {
    const l = this.at(name);
    if (l) this.gl.uniform1f(l, v);
  }

  f2(name: string, x: number, y: number): void {
    const l = this.at(name);
    if (l) this.gl.uniform2f(l, x, y);
  }

  f3(name: string, x: number, y: number, z: number): void {
    const l = this.at(name);
    if (l) this.gl.uniform3f(l, x, y, z);
  }

  i(name: string, v: number): void {
    const l = this.at(name);
    if (l) this.gl.uniform1i(l, v);
  }

  /** Binds `tex` to `unit` and points the sampler at it. */
  tex(name: string, unit: number, tex: WebGLTexture): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    this.i(name, unit);
  }
}

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  src: string,
  stage: string,
): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s) ?? "(no log)";
    gl.deleteShader(s);
    throw new ShaderError(stage, log);
  }
  return s;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
  name: string,
): Program {
  const vs = compile(gl, gl.VERTEX_SHADER, vertSrc, `${name}.vert`);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc, `${name}.frag`);
  const p = gl.createProgram()!;
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  // Bound before linking so every program shares attribute 0 and one VAO
  // serves all three passes.
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p) ?? "(no log)";
    gl.deleteProgram(p);
    throw new ShaderError(`${name}.link`, log);
  }
  return new Program(gl, p);
}

/** One oversized triangle, bound once for the life of the context. */
export function bindFullscreenTriangle(gl: WebGL2RenderingContext): void {
  gl.bindVertexArray(gl.createVertexArray());
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
}

export function drawFullscreen(gl: WebGL2RenderingContext): void {
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
