/**
 * Context acquisition and the two capability gates the engine cannot run
 * without. Both failures are recoverable at the product level — PRD §12
 * specifies a no-WebGL fallback serving a static image and the same DOM — so
 * they surface as a typed error the caller can branch on rather than a throw
 * that takes the page down.
 */

export type UnsupportedReason = "webgl2" | "float-targets";

export class GLUnsupported extends Error {
  constructor(
    readonly reason: UnsupportedReason,
    message: string,
  ) {
    super(message);
    this.name = "GLUnsupported";
  }
}

/**
 * One context, acquired once, for the whole session. Losing and re-acquiring
 * it discards the sand field, which is the continuity PRD §10 is built on —
 * see the harness in src/check for why that is worth asserting rather than
 * assuming.
 */
export function createContext(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext("webgl2", {
    antialias: false, // the march is the sampler; MSAA would cost for nothing
    alpha: false,
    powerPreference: "high-performance",
  });

  if (!gl) {
    throw new GLUnsupported(
      "webgl2",
      "WebGL2 is unavailable. The beach needs it; the page falls back to static.",
    );
  }

  // The field is RGBA16F (PRD §6.1) and is rendered to every frame, so being
  // able to *sample* half-float is not enough — the driver has to accept it as
  // a colour attachment.
  if (
    !gl.getExtension("EXT_color_buffer_float") &&
    !gl.getExtension("EXT_color_buffer_half_float")
  ) {
    throw new GLUnsupported(
      "float-targets",
      "This GPU will not render to float textures, which the sand simulation needs.",
    );
  }

  return gl;
}
