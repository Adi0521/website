/**
 * Context-persistence probe — scaffolding for the Phase 3 router decision.
 * Delete once a router is chosen and the assertion lives in CI.
 *
 * `gl.isContextLost() === false` is NOT sufficient on its own. It is a
 * property of a context object, and both failure modes hand you a different
 * context object that is perfectly healthy:
 *
 *   1. The router does a full document load. Everything resets — new document,
 *      new canvas, new context — so isContextLost() reads false and the check
 *      "passes" while the sand field is gone. Caught by DOC_BOOTS, because
 *      sessionStorage survives a reload and module state does not.
 *
 *   2. The router keeps the document but unmounts and remounts the canvas
 *      (a React route swap, StrictMode's double-invoke, any keyed re-render).
 *      Brand-new context, also not lost. Caught by `epoch`.
 *
 * So the real assertion is "the same context, still holding what we wrote",
 * not "a context, not lost".
 */

const BOOT_KEY = "beach:check:boots";
const STAMP = 256; // stamped/read-back tile at the field origin — keep small, this is exact-match

/** Increments once per document evaluation. A jump means the document was torn down. */
const DOC_BOOTS = (() => {
  const n = Number(sessionStorage.getItem(BOOT_KEY) ?? "0") + 1;
  sessionStorage.setItem(BOOT_KEY, String(n));
  return n;
})();

export interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

export interface Report {
  ok: boolean;
  docBoots: number;
  epoch: number;
  contextLost: boolean;
  format: string;
  field: number;
  checks: Check[];
}

interface State {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  tex: [WebGLTexture, WebGLTexture];
  field: number;
  format: string;
  expected: number;
  bootedAt: number;
  lostEvents: number;
}

let state: State | null = null;
let epoch = 0;

// ── half-float codec ────────────────────────────────────────────────────────
// The field mirrors the prototype: RGBA16F. Stamp values are k/256 with
// k an integer in [0, 251), which half-float represents exactly, so the
// comparison stays an integer equality rather than an epsilon dance.

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

function toHalf(v: number): number {
  f32[0] = v;
  const x = u32[0]!;
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  let man = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (man ? 0x200 : 0);
  const e = exp - 112; // (exp - 127) + 15
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    man |= 0x800000;
    return sign | (man >>> (14 - e));
  }
  return sign | (e << 10) | (man >>> 13);
}

function fromHalf(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >>> 10) & 0x1f;
  const man = h & 0x3ff;
  if (exp === 0) return sign * man * 2 ** -24;
  if (exp === 0x1f) return man ? NaN : sign * Infinity;
  return sign * (man + 1024) * 2 ** (exp - 25);
}

/** Deterministic, position-dependent, and cheap to recompute for comparison. */
const stampValue = (i: number): number => (i * 37) % 251;

// ── boot ────────────────────────────────────────────────────────────────────

/**
 * Acquires the context ONCE per document and stamps the field. Calling it a
 * second time is itself the bug being hunted, so it bumps `epoch` loudly
 * rather than quietly handing back the existing context.
 */
export function boot(canvas: HTMLCanvasElement, field: number): Report {
  epoch += 1;

  const gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
  });
  if (!gl) {
    return {
      ok: false,
      docBoots: DOC_BOOTS,
      epoch,
      contextLost: true,
      format: "none",
      field,
      checks: [{ label: "webgl2", ok: false, detail: "context creation returned null" }],
    };
  }

  const floaty = !!(
    gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float")
  );
  const format = floaty ? "RGBA16F" : "RGBA8";

  // Full tier-sized allocation so the check also covers a driver evicting the
  // field under memory pressure; the stamp itself stays a small exact tile.
  const mk = (): WebGLTexture => {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (floaty) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, field, field, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, field, field, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  };

  const tex: [WebGLTexture, WebGLTexture] = [mk(), mk()];

  // Stamp the tile into the front buffer.
  const n = STAMP * STAMP * 4;
  let expected = 0;
  gl.bindTexture(gl.TEXTURE_2D, tex[0]);
  if (floaty) {
    const data = new Uint16Array(n);
    for (let i = 0; i < n; i++) {
      const k = stampValue(i);
      data[i] = toHalf(k / 256);
      expected += k;
    }
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, STAMP, STAMP, gl.RGBA, gl.HALF_FLOAT, data);
  } else {
    const data = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const k = stampValue(i);
      data[i] = k;
      expected += k;
    }
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, STAMP, STAMP, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }

  const s: State = {
    gl,
    canvas,
    tex,
    field,
    format,
    expected,
    bootedAt: DOC_BOOTS,
    lostEvents: 0,
  };
  state = s;

  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    s.lostEvents += 1;
  });

  return verify();
}

// ── verify ──────────────────────────────────────────────────────────────────

export function verify(): Report {
  const s = state;

  // Module state died but sessionStorage did not: the document was replaced.
  // This is the full-page-load failure, and it is the one that looks like a
  // pass if you only ask the fresh context whether it is lost.
  if (!s) {
    return {
      ok: false,
      docBoots: DOC_BOOTS,
      epoch,
      contextLost: true,
      format: "none",
      field: 0,
      checks: [
        {
          label: "document survived",
          ok: false,
          detail: `no stamp in this document (boot #${DOC_BOOTS}) — the navigation reloaded the page`,
        },
      ],
    };
  }

  const { gl } = s;
  const checks: Check[] = [];

  // Must be compared against the SESSION, not against this document's own boot
  // index — a reloaded document re-stamps the field, so any within-document
  // comparison agrees with itself and reports a healthy context over dead sand.
  checks.push({
    label: "document survived",
    ok: s.bootedAt === 1,
    detail:
      s.bootedAt === 1
        ? "one document evaluation this session"
        : `document #${s.bootedAt} this session — a navigation reloaded the page`,
  });

  checks.push({
    label: "same context",
    ok: epoch === 1,
    detail: epoch === 1 ? "one context acquired" : `${epoch} contexts acquired — canvas was remounted`,
  });

  const lost = gl.isContextLost();
  checks.push({
    label: "context not lost",
    ok: !lost && s.lostEvents === 0,
    detail: lost
      ? "isContextLost() === true"
      : s.lostEvents
        ? `${s.lostEvents} webglcontextlost event(s) seen`
        : "isContextLost() === false",
  });

  // Field contents.
  let ok = false;
  let detail = "not read";
  if (!lost) {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, s.tex[0], 0);

    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      detail = "framebuffer incomplete — cannot read the field back";
    } else {
      const type = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE) as number;
      const n = STAMP * STAMP * 4;
      let sum = 0;
      try {
        if (type === gl.FLOAT) {
          const px = new Float32Array(n);
          gl.readPixels(0, 0, STAMP, STAMP, gl.RGBA, gl.FLOAT, px);
          for (let i = 0; i < n; i++) sum += Math.round(px[i]! * 256);
        } else if (type === gl.HALF_FLOAT) {
          const px = new Uint16Array(n);
          gl.readPixels(0, 0, STAMP, STAMP, gl.RGBA, gl.HALF_FLOAT, px);
          for (let i = 0; i < n; i++) sum += Math.round(fromHalf(px[i]!) * 256);
        } else {
          const px = new Uint8Array(n);
          gl.readPixels(0, 0, STAMP, STAMP, gl.RGBA, gl.UNSIGNED_BYTE, px);
          for (let i = 0; i < n; i++) sum += px[i]!;
        }
        ok = sum === s.expected;
        detail = ok
          ? `${STAMP}×${STAMP} tile intact (checksum ${sum})`
          : `checksum ${sum}, expected ${s.expected}`;
      } catch (err) {
        detail = `readPixels threw: ${String(err)}`;
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
  } else {
    detail = "context lost — field contents are gone by definition";
  }
  checks.push({ label: "field holds contents", ok, detail });

  return {
    ok: checks.every((c) => c.ok),
    docBoots: DOC_BOOTS,
    epoch,
    contextLost: lost,
    format: s.format,
    field: s.field,
    checks,
  };
}

/**
 * Clears the default framebuffer to a per-route colour. Purely so the check is
 * legible by eye: if the canvas ever flashes to white between routes, the
 * element was replaced and the numbers below are about to say so.
 */
export function tint(r: number, g: number, b: number): void {
  if (!state || state.gl.isContextLost()) return;
  const { gl } = state;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, state.canvas.width, state.canvas.height);
  gl.clearColor(r, g, b, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

/** Clears the boot counter so a fresh run starts from a clean slate. */
export function resetBoots(): void {
  sessionStorage.removeItem(BOOT_KEY);
}
