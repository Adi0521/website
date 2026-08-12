/**
 * A render target: one RGBA16F texture plus the framebuffer that writes to it.
 * The sand field is two of these ping-ponged (PRD §6.1); the baked static
 * layer is a third.
 */

export interface Target {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
  width: number;
  height: number;
}

export interface TargetOptions {
  wrap?: number;
  /**
   * Allocate a mip chain and filter through it. The focus pull blurs by
   * walking down the chain, which is why the composite target needs one and
   * the sand field does not.
   */
  mipmaps?: boolean;
  /** 8-bit is enough once the scene has been tone-mapped and clamped. */
  format?: "rgba16f" | "rgba8";
}

export function createTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  opts: TargetOptions | number = {},
): Target {
  // Numeric third argument is the wrap mode, kept for the field's call sites.
  const o: TargetOptions = typeof opts === "number" ? { wrap: opts } : opts;
  const wrap = o.wrap ?? gl.CLAMP_TO_EDGE;

  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (o.format === "rgba8") {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
  }
  // LINEAR throughout: the renderer samples the field at arbitrary world
  // positions along the march, not on the texel grid.
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    o.mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  if (o.mipmaps) gl.generateMipmap(gl.TEXTURE_2D);

  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return { tex, fb, width, height };
}

export function clearTarget(gl: WebGL2RenderingContext, t: Target): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
  gl.viewport(0, 0, t.width, t.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

export function disposeTarget(gl: WebGL2RenderingContext, t: Target): void {
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fb);
}
