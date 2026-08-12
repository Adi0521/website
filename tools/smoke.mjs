#!/usr/bin/env node
/**
 * PRD §14.4: load the page in headless Chrome, assert no runtime errors, and
 * confirm the scene actually rendered.
 *
 * "It built" and "it typechecked" are both true of a black screen, so the
 * assertion that matters is on pixels: a beach has a sky, a lit sand plane and
 * a shadowed side, which means real spread in the histogram. A single flat
 * colour is the failure this exists to catch.
 *
 * Deliberately NOT a temporal test — see the fill-in lesson in §14. It asks
 * "did one frame come out", nothing about how the frame evolves.
 *
 *   node tools/smoke.mjs [--shot out.png]
 */

import { spawn } from "node:child_process";
import puppeteer from "puppeteer";

const PORT = 5275;
const BASE = `http://localhost:${PORT}`;
const shotAt = process.argv.indexOf("--shot");
const shotPath = shotAt > -1 ? process.argv[shotAt + 1] : null;

const server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  stdio: ["ignore", "pipe", "pipe"],
});
const stop = () => server.kill("SIGTERM");
process.on("exit", stop);
process.on("SIGINT", () => (stop(), process.exit(130)));

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(BASE, { signal: AbortSignal.timeout(500) });
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`vite did not come up on ${BASE}`);
}

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
};

let browser;
try {
  await waitForServer();
  browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  // Script errors and failed requests are kept apart on purpose. Lumping them
  // together turns "the engine threw" and "an asset is missing" into the same
  // red, and they need different people to fix them.
  const errors = [];
  const missing = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Chrome probes for /favicon.ico whether or not the page asks for one, so it
  // is noise here rather than a missing asset the page depends on.
  const referenced = (url) => !url.endsWith("/favicon.ico");
  page.on("requestfailed", (r) => referenced(r.url()) && missing.push(r.url()));
  page.on("response", (r) => {
    if (r.status() >= 400 && referenced(r.url())) missing.push(`${r.status()} ${r.url()}`);
  });

  await page.goto(BASE, { waitUntil: "networkidle0" });

  const booted = await page
    .waitForFunction("window.__beach !== undefined", { timeout: 20000 })
    .then(() => true)
    .catch(() => false);

  console.log("");
  check("the engine boots", booted, booted ? null : "window.__beach never appeared");
  if (!booted) {
    console.log(`\n  scene unavailable${errors.length ? `: ${errors[0]}` : ""}\n`);
    process.exit(1);
  }

  const info = await page.evaluate(() => {
    const b = window.__beach;
    const gl = b.gl;
    // Render into the back buffer and read it in the same task, before the
    // compositor swaps it away.
    b.renderStill();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);

    let sum = 0;
    let sumSq = 0;
    let black = 0;
    const n = w * h;
    const buckets = new Set();
    for (let i = 0; i < n; i++) {
      const r = px[i * 4], g = px[i * 4 + 1], bl = px[i * 4 + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
      sum += lum;
      sumSq += lum * lum;
      if (r + g + bl === 0) black += 1;
      buckets.add((r >> 4) * 256 + (g >> 4) * 16 + (bl >> 4));
    }
    const mean = sum / n;
    return {
      tier: b.tier.name,
      field: `${b.field.width}×${b.field.height}`,
      drawing: `${w}×${h}`,
      mean,
      stddev: Math.sqrt(Math.max(0, sumSq / n - mean * mean)),
      blackFraction: black / n,
      distinct: buckets.size,
      glError: gl.getError(),
      reducedMotion: b.reducedMotion,
    };
  });

  console.log(
    `\n  ${info.tier} tier · field ${info.field} · drawing buffer ${info.drawing}\n`,
  );

  check("no uncaught script errors", errors.length === 0, errors[0] ?? null);
  check(
    "every asset resolves",
    missing.length === 0,
    missing.length ? `${missing.length} failed: ${missing.map((m) => m.split("/").pop()).join(", ")}` : null,
  );
  check("no GL error after a frame", info.glError === 0, `getError() ${info.glError}`);
  check(
    "the frame is not blank",
    info.blackFraction < 0.5,
    `${(info.blackFraction * 100).toFixed(1)}% pure black`,
  );
  check(
    "the frame has real tonal range",
    info.stddev > 8,
    `mean ${info.mean.toFixed(1)}, stddev ${info.stddev.toFixed(1)}`,
  );
  check(
    "the frame is not one flat colour",
    info.distinct > 24,
    `${info.distinct} distinct colour buckets`,
  );

  // Render pacing, measured against what this machine can actually draw rather
  // than against a fixed cap. A fixed low cap does not work here: SwiftShader
  // renders this scene at somewhere between 0.3 and 3fps depending on load, so
  // a cap of 1 sometimes sits ABOVE the uncapped rate, and then no cap can
  // limit anything and the assertion is a coin flip. Which is §14's own lesson
  // — software rendering cannot test wall-clock behaviour — reaching a check
  // that §14 also mandates. So: measure free-running first, derive a cap at a
  // third of it, and if the machine has no headroom to spare, skip and say so.
  const CAP_FLOOR = 6; // fps below which a cap cannot be told from the ceiling
  const pace = await page.evaluate(async (floor) => {
    const b = window.__beach;
    b.autoDowngrade = false; // a deliberate low cap would otherwise trip it
    const measure = async (cap, ms) => {
      b.maxFps = cap;
      // Settle for a few frames at the new cap, not a fixed 400ms — at 2fps
      // that is less than one frame and the count starts mid-transition.
      await new Promise((r) => setTimeout(r, Math.max(400, 3000 / cap)));
      const f0 = b.frames, t0 = performance.now();
      await new Promise((r) => setTimeout(r, ms));
      return (b.frames - f0) / ((performance.now() - t0) / 1000);
    };
    const restore = () => ((b.maxFps = 60), (b.autoDowngrade = true));
    const free = await measure(1000, 3000);
    if (free < floor) return restore(), { free, skipped: true };
    const cap = Math.max(2, free / 3);
    const capped = await measure(cap, 4000);
    restore();
    // The pacing gate allows a frame 4ms early (jitter slack), so the real
    // ceiling sits above the nominal cap — by 9% at 20fps and 30% at 60fps.
    // Comparing against the nominal number would fail the faster the GPU is.
    return { free, cap, capped, ceiling: 1000 / (1000 / cap - 4) };
  }, CAP_FLOOR);
  if (pace.skipped) {
    console.log(
      `  skip  the render cap actually limits the loop — ${pace.free.toFixed(1)}fps uncapped, no headroom under a cap`,
    );
  } else {
    check(
      "the render cap actually limits the loop",
      pace.capped < pace.free * 0.7 && pace.capped <= pace.ceiling * 1.25,
      `uncapped ${pace.free.toFixed(1)}fps → ${pace.capped.toFixed(1)}fps at a cap of ${pace.cap.toFixed(1)}`,
    );
  }

  // Auto-downgrade (PRD §11, "still to build"). SwiftShader genuinely cannot
  // keep up, so this environment exercises the path for real — but a machine
  // with a working GPU will not, and that is not a failure.
  const down = await page.evaluate(async () => {
    const b = window.__beach;
    const from = b.tier.name;
    b.maxFps = 60;
    b.autoDowngrade = true;
    const t0 = performance.now();
    // Sample as we poll. Downgrading zeroes the EMA to re-measure the new
    // tier, so reading b.fps afterwards reports 0 and loses the number that
    // explains the decision.
    let fps = b.fps;
    while (b.tier.name === from && performance.now() - t0 < 12000) {
      await new Promise((r) => setTimeout(r, 250));
      if (b.tier.name === from) fps = b.fps;
    }
    return { from, to: b.tier.name, secs: (performance.now() - t0) / 1000, fps };
  });
  if (down.to === down.from && down.fps >= 45) {
    console.log(`  skip  auto-downgrade — machine sustains ${down.fps}fps, path not exercised`);
  } else {
    check(
      "a machine that cannot keep up is downgraded",
      down.to !== down.from,
      `${down.from} → ${down.to} after ${down.secs.toFixed(1)}s at ${down.fps}fps`,
    );
  }

  // Scroll owns the camera (PRD §3). Run before the field tests below, which
  // stop the loop.
  const scroll = await page.evaluate(async () => {
    const b = window.__beach;
    // Eye position and the ground under it, so "is the camera inside the
    // beach" can be asked directly rather than inferred.
    const eye = () => {
      const c = b.camera, ce = Math.cos(c.elevation);
      const p = [
        c.target[0] + Math.cos(c.azimuth) * ce * c.distance,
        c.target[1] + Math.sin(c.elevation) * c.distance,
        c.target[2] + Math.sin(c.azimuth) * ce * c.distance,
      ];
      const w = b.config.water;
      const raw = (p[2] - w.shoreZ) * w.slope;
      const ground = Math.min(0.9, Math.max(-1.3, raw));
      // `raw` past 0.9 means the ramp has clamped and the eye is over the flat
      // plateau, where the near foreground stops being a beach and becomes a shelf.
      return { y: p[1], ground, clear: p[1] - ground, onSlope: raw < 0.9 };
    };

    const z0 = b.camera.target[2], az0 = b.camera.azimuth;
    const clear0 = eye().clear;
    scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 1600)); // let the easing settle
    const e1 = eye();
    return {
      z0, az0, clear0,
      z1: b.camera.target[2],
      az1: b.camera.azimuth,
      targetY: b.camera.target[1],
      clear1: e1.clear,
      onSlope: e1.onSlope,
      eyeZ: e1.y,
      patch: b.field.center[1],
      scrollable: document.documentElement.scrollHeight - innerHeight,
    };
  });

  check("the page scrolls", scroll.scrollable > 100, `${scroll.scrollable}px of travel`);
  check(
    "scrolling retreats up the dry beach",
    scroll.z1 - scroll.z0 > 1,
    `z ${scroll.z0.toFixed(2)} → ${scroll.z1.toFixed(2)}`,
  );
  check(
    "scrolling sweeps the azimuth",
    Math.abs(scroll.az1 - scroll.az0) > 0.01,
    `${scroll.az0.toFixed(3)} → ${scroll.az1.toFixed(3)} rad ` +
      `(${(((scroll.az1 - scroll.az0) * 180) / Math.PI).toFixed(1)}°)`,
  );
  // The ramp rises as you travel up it. A camera whose look-at point stayed at
  // y=0 would be underground well before the top, and the frame would fill
  // with sand from the inside.
  check(
    "the camera rides the ramp instead of sinking into it",
    scroll.clear0 > 0.2 && scroll.clear1 > 0.2,
    `eye clears the sand by ${scroll.clear0.toFixed(2)} at the top, ` +
      `${scroll.clear1.toFixed(2)} at the bottom (target y ${scroll.targetY.toFixed(2)})`,
  );
  check(
    "the travel stays on the sloped beach",
    scroll.onSlope,
    scroll.onSlope
      ? "the eye never reaches the ramp's clamp"
      : "endZ puts the eye over the flat plateau past z≈10.6",
  );
  check(
    "the sand patch follows the camera",
    Math.abs(scroll.patch - scroll.z1) < 0.1,
    `patch at z ${scroll.patch.toFixed(2)}, camera at z ${scroll.z1.toFixed(2)}`,
  );

  // Pointer picking, at both ends of the scroll travel. The dip has to land
  // under the cursor, and the way it stopped doing so was subtle: picking
  // against a flat y=0 plane is self-consistent, so a round-trip through the
  // projection would agree with itself and prove nothing. The invariant that
  // has teeth ties the pick to the RAMP — the surface the renderer marches and
  // the camera rides. Two forms of it, both exact:
  //   · the ray through the centre pixel must land on the camera's own target
  //   · off centre, the ray must pass through the ramp at the picked point
  // Flat-plane picking failed the second by the eye's height above the ramp,
  // which is why the error grew with scrolling rather than being a fixed nudge.
  const pick = await page.evaluate(async () => {
    const b = window.__beach;
    const w = b.config.water;
    const ramp = (z) => Math.min(0.9, Math.max(-1.3, (z - w.shoreZ) * w.slope));
    const sub = (a, c) => [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
    const norm = (a) => {
      const l = Math.hypot(a[0], a[1], a[2]) || 1;
      return [a[0] / l, a[1] / l, a[2] / l];
    };
    const cross = (a, c) => [
      a[1] * c[2] - a[2] * c[1],
      a[2] * c[0] - a[0] * c[2],
      a[0] * c[1] - a[1] * c[0],
    ];
    // Deliberately rebuilt here rather than imported, so the check cannot
    // agree with the code under test by sharing its arithmetic.
    const basis = () => {
      const c = b.camera, ce = Math.cos(c.elevation);
      const ro = [
        c.target[0] + Math.cos(c.azimuth) * ce * c.distance,
        c.target[1] + Math.sin(c.elevation) * c.distance,
        c.target[2] + Math.sin(c.azimuth) * ce * c.distance,
      ];
      const ww = norm(sub(c.target, ro));
      const uu = norm(cross(ww, [0, 1, 0]));
      return { ro, uu, vv: cross(uu, ww), ww, fov: 1 / Math.tan((c.fovDeg * Math.PI) / 360) };
    };

    const probe = (fx, fy) => {
      const el = b.canvas;
      const r = el.getBoundingClientRect();
      el.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: r.left + r.width * fx,
          clientY: r.top + r.height * fy,
          bubbles: true,
        }),
      );
      const { x, z, valid } = b.ptr;
      const { ro, uu, vv, ww, fov } = basis();
      const px = (fx - 0.5) * (r.width / r.height);
      const py = 1 - fy - 0.5;
      const rd = norm([
        px * uu[0] + py * vv[0] + fov * ww[0],
        px * uu[1] + py * vv[1] + fov * ww[1],
        px * uu[2] + py * vv[2] + fov * ww[2],
      ]);
      // Distance along the ray to the picked column, taken in the horizontal
      // plane so a grazing ray does not divide by a near-zero rd.y.
      const t = ((x - ro[0]) * rd[0] + (z - ro[2]) * rd[2]) / (rd[0] * rd[0] + rd[2] * rd[2]);
      return { x, z, valid, offRamp: Math.abs(ro[1] + rd[1] * t - ramp(z)) };
    };

    const sample = () => {
      const centre = probe(0.5, 0.5);
      // Spread across the frame, below the horizon so every ray meets sand.
      const off = [probe(0.3, 0.62), probe(0.72, 0.55), probe(0.5, 0.85)];
      return {
        z: b.camera.target[2],
        centreErr: Math.hypot(centre.x - b.camera.target[0], centre.z - b.camera.target[2]),
        offRamp: Math.max(...off.map((p) => p.offRamp)),
        valid: off.every((p) => p.valid),
      };
    };

    const bottom = sample(); // the page is still scrolled down from above
    scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 1600));
    const top = sample();
    return { top, bottom };
  });

  for (const [where, p] of [["top", pick.top], ["bottom", pick.bottom]]) {
    check(
      `the dip lands under the cursor at the ${where} of the scroll`,
      p.centreErr < 0.01 && p.offRamp < 0.01,
      `z ${p.z.toFixed(2)}: centre pixel misses the camera target by ${p.centreErr.toFixed(3)}, ` +
        `ray misses the ramp by ${p.offRamp.toFixed(3)} world units`,
    );
  }
  check(
    "the picked point is inside the interactive patch",
    pick.top.valid && pick.bottom.valid,
    "off-centre picks land in the clipmap, not past its edge",
  );

  // ── Focus pull (PRD §10) ────────────────────────────────────────────────
  const pull = await page.evaluate(async () => {
    const b = window.__beach;
    const r = window.__router;
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const settle = async (fn) => {
      for (let i = 0; i < 80; i++) { if (fn()) return true; await wait(100); }
      return false;
    };

    // Mean luminance and mean chroma of the composited frame. renderStill()
    // redraws through whatever path the current focus selects, so this reads
    // the real output rather than a reconstruction of it.
    const sample = () => {
      b.renderStill();
      const gl = b.gl, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let lum = 0, chroma = 0, detail = 0;
      const n = w * h;
      const lumAt = (i) => 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
      for (let i = 0; i < n; i++) {
        const R = px[i * 4], G = px[i * 4 + 1], B = px[i * 4 + 2];
        lum += 0.2126 * R + 0.7152 * G + 0.0722 * B;
        chroma += Math.max(R, G, B) - Math.min(R, G, B);
      }
      // Mean gradient between horizontally adjacent pixels. Defocus is a loss
      // of high frequencies, so this measures the blur itself rather than
      // something the blur happens to correlate with.
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w - 1; x++) {
          detail += Math.abs(lumAt(y * w + x + 1) - lumAt(y * w + x));
        }
      }
      return { lum: lum / n, chroma: chroma / n, detail: detail / n };
    };

    r.navigate("/");
    const reachedBeach = await settle(() => b.focusAmount === 0);
    const beachFrame = sample();

    r.navigate("/resume");
    const reachedFocus = await settle(() => b.focusAmount === 1);
    await wait(300);
    const framesAtRest = b.frames;
    const simAtRest = b.elapsedSimulated;
    await wait(1500);
    const framesLater = b.frames;
    const simLater = b.elapsedSimulated;
    const focusFrame = sample();

    // §10: deep links skip the animation. Distinguishable from the animated
    // path deterministically, without depending on catching it mid-flight.
    r.navigate("/");
    await settle(() => b.focusAmount === 0);
    b.setFocus(1);
    const afterAnimated = b.focusAmount;
    b.setFocus(1, true);
    const afterImmediate = b.focusAmount;

    // NOT navigate("/") — we are already on "/", and the router correctly
    // treats that as a no-op, so onNavigate never fires and the pull forced
    // above would stay latched at 1 for everything after this.
    b.setFocus(0);
    await settle(() => b.focusAmount === 0);
    return {
      reachedBeach, reachedFocus, beachFrame, focusFrame,
      framesAtRest, framesLater, simAtRest, simLater,
      afterAnimated, afterImmediate,
    };
  });

  check("the pull reaches both ends", pull.reachedBeach && pull.reachedFocus,
    `focus 0 on the beach, 1 on a focus route`);
  check(
    "the pulled scene defocuses",
    pull.focusFrame.detail < pull.beachFrame.detail * 0.5,
    `mean adjacent-pixel gradient ${pull.beachFrame.detail.toFixed(3)} → ` +
      `${pull.focusFrame.detail.toFixed(3)} ` +
      `(${((pull.focusFrame.detail / pull.beachFrame.detail) * 100).toFixed(0)}% of the detail left)`,
  );
  check(
    "the pull keeps the beach's own brightness and colour",
    pull.focusFrame.lum > pull.beachFrame.lum * 0.8 &&
      pull.focusFrame.chroma > pull.beachFrame.chroma * 0.7,
    `luminance ${pull.beachFrame.lum.toFixed(1)} → ${pull.focusFrame.lum.toFixed(1)}, ` +
      `chroma ${pull.beachFrame.chroma.toFixed(1)} → ${pull.focusFrame.chroma.toFixed(1)} ` +
      `— no dark wash over the scene`,
  );
  check(
    "the waves keep running on a focus page",
    pull.framesLater > pull.framesAtRest && pull.simLater > pull.simAtRest,
    `${pull.framesLater - pull.framesAtRest} frame(s) and ` +
      `${(pull.simLater - pull.simAtRest).toFixed(2)}s of simulation in 1.5s of reading`,
  );
  check(
    "a deep link skips the animation, a navigation does not",
    pull.afterAnimated < 0.5 && pull.afterImmediate === 1,
    `animated starts at ${pull.afterAnimated.toFixed(2)}, immediate lands at ${pull.afterImmediate}`,
  );

  // The point of the deviation from §10: water still moves, sand does not get
  // written. Driven through real pointer events rather than the brush API, so
  // it tests the path a visitor actually takes.
  const marking = await page.evaluate(() => {
    window.__probeDeepest = () => {
      const b = window.__beach, gl = b.gl;
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, b.field.texture, 0);
      const px = new Float32Array(b.field.width * b.field.height * 4);
      gl.readPixels(0, 0, b.field.width, b.field.height, gl.RGBA, gl.FLOAT, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);
      let lo = 0;
      for (let i = 0; i < b.field.width * b.field.height; i++) if (px[i * 4] < lo) lo = px[i * 4];
      return lo;
    };
    return true;
  });

  // Scrolled to the top first: the scroll assertion above leaves the page at
  // the bottom, which puts the camera at z=7.6 where these screen coordinates
  // land outside the interactive patch and nothing would be marked either way.
  const sweep = async () => {
    await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    await new Promise((r) => setTimeout(r, 700));
    for (const [x, y] of [[400, 500], [640, 600], [900, 700], [300, 760]]) {
      await page.mouse.move(x, y);
    }
    await new Promise((r) => setTimeout(r, 900));
    return page.evaluate(() => ({
      deepest: window.__probeDeepest(),
      ptr: window.__beach.pointer,
      focus: window.__beach.focusAmount,
      camZ: +window.__beach.camera.target[2].toFixed(2),
      running: window.__beach.frames,
    }));
  };

  const settleTo = async (path, want) => {
    await page.evaluate(async ([p, w]) => {
      window.__router.navigate(p);
      // Belt and braces: navigating to the path already showing is a no-op,
      // so the pull is set directly rather than assumed to follow.
      window.__beach.setFocus(w);
      for (let i = 0; i < 80; i++) {
        if (window.__beach.focusAmount === w) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      window.__beach.field.reset();
    }, [path, want]);
    return sweep();
  };

  const onBeach = await settleTo("/", 0);
  const onFocus = await settleTo("/resume", 1);

  check("the pointer marks the sand on the beach", onBeach.deepest < -0.02,
    `deepest ${onBeach.deepest.toFixed(3)} · ptr ${JSON.stringify(onBeach.ptr)} · ` +
    `focus ${onBeach.focus} · camZ ${onBeach.camZ}`);
  check("the pointer leaves no mark on a focus page", onFocus.deepest > -0.005,
    `deepest ${onFocus.deepest.toFixed(3)} · focus ${onFocus.focus}`);
  await page.evaluate(() => window.__router.navigate("/"));

  // Lateral swash. Measured through the SIMULATION's wetness channel, not the
  // picture: it proves the shared wave chunk bends the waterline for the sim
  // and the renderer alike, which is the invariant that matters. Differential,
  // so it does not depend on anything else that varies across the beach.
  const lat = await page.evaluate(() => {
    const b = window.__beach;
    b.stop();
    const gl = b.gl;

    // Waterline row per column, across a band spanning the swash zone. Its
    // spread is the thing being asked about: a scalar swash puts every column's
    // waterline at the same height, give or take whatever the baked ripples
    // contribute underneath.
    const waterlineSpread = (swashLateral) => {
      b.config.water.swashLateral = swashLateral;
      b.field.setOrigin(0, 0);
      b.field.reset();
      // Hold the wave still, mid-reach, and kill the travelling swell so the
      // only thing that can vary along the beach is the swash itself.
      b.waves.amp = 0;
      b.waves.phase = 0;
      b.waves.swashBody = 0.55;
      b.waves.swashFilm = 0.55;
      for (let i = 0; i < 8; i++) b.field.step(0.016, null, b.waves, 0);

      const lo = Math.round(b.field.worldToField(0, -0.2)[1] * b.field.height);
      const hi = Math.round(b.field.worldToField(0, 1.4)[1] * b.field.height);
      const rows = hi - lo;
      const W = b.field.width;
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, b.field.texture, 0);
      const px = new Float32Array(W * rows * 4);
      gl.readPixels(0, lo, W, rows, gl.RGBA, gl.FLOAT, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);

      const edge = [];
      for (let x = 0; x < W; x++) {
        let top = -1;
        for (let y = 0; y < rows; y++) if (px[(y * W + x) * 4 + 2] > 0.5) top = y;
        if (top >= 0) edge.push(top);
      }
      if (edge.length < W * 0.5) return { sd: 0, covered: edge.length / W };
      const mean = edge.reduce((a, v) => a + v, 0) / edge.length;
      const sd = Math.sqrt(edge.reduce((a, v) => a + (v - mean) ** 2, 0) / edge.length);
      // Rows to world Z, so the number means something outside this texture.
      return { sd: (sd / b.field.height) * 2 * 2.6, covered: edge.length / W };
    };

    const shipped = b.config.water.swashLateral;
    const straight = waterlineSpread(0);
    const bent = waterlineSpread(shipped);
    b.config.water.swashLateral = shipped;
    b.waves.swashBody = 0;
    b.waves.swashFilm = 0;
    return { straight, bent, shipped };
  });

  check(
    "lateral variation bends the waterline",
    lat.bent.sd > lat.straight.sd * 1.5,
    `swashLateral ${lat.shipped}: waterline spread ${lat.straight.sd.toFixed(3)} → ` +
      `${lat.bent.sd.toFixed(3)} world units ` +
      `(${(lat.bent.sd / Math.max(lat.straight.sd, 1e-6)).toFixed(1)}× the baked-ripple floor)`,
  );

  // The look cannot be judged here — SwiftShader collapses the value noise to a
  // constant, so the baked ripples are absent in the prototype too. What CAN be
  // asserted is that the ported sim path writes the shape PRD §6.2 specifies:
  // a depression with sand pushed UP at its rim. Without the rim a footprint
  // looks stamped into clay, and a decay model would produce the hole alone.
  const stamp = await page.evaluate(() => {
    const b = window.__beach;
    b.stop(); // take the loop out of the way so the step count is exact
    // Still water, explicitly: the swash reach now varies along the beach, and
    // a wave arriving mid-test would scrub the mark being measured.
    b.waves.swashBody = 0; b.waves.swashFilm = 0; b.waves.amp = 0;
    b.field.reset();
    const brush = {
      kind: "press", a: [0.5, 0.5], b: [0.5, 0.5],
      radius: 0.024, depth: 0.34, rim: 0.42, pressure: 1.0,
    };
    for (let i = 0; i < 24; i++) b.field.step(0.016, brush, b.waves, 0);

    const gl = b.gl;
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, b.field.texture, 0);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;

    // A horizontal strip through the middle of the stamp.
    const W = 240;
    const x0 = Math.round(b.field.width / 2 - W / 2);
    const y0 = Math.round(b.field.height / 2);
    const px = new Float32Array(W * 4);
    gl.readPixels(x0, y0, W, 1, gl.RGBA, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);

    let lowest = 0, highest = 0, disturbance = 0;
    for (let i = 0; i < W; i++) {
      lowest = Math.min(lowest, px[i * 4]);
      highest = Math.max(highest, px[i * 4]);
      disturbance = Math.max(disturbance, px[i * 4 + 1]);
    }
    return { complete, lowest, highest, disturbance };
  });

  check("the field is readable", stamp.complete, stamp.complete ? null : "framebuffer incomplete");
  check(
    "a press carves a depression",
    stamp.lowest < -0.05,
    `floor ${stamp.lowest.toFixed(3)}`,
  );
  check(
    "the press raises a rim",
    stamp.highest > 0.005,
    `rim ${stamp.highest.toFixed(3)} — displaced sand, not a decay model`,
  );
  check(
    "the press marks the sand as disturbed",
    stamp.disturbance > 0.1,
    `G channel ${stamp.disturbance.toFixed(3)}`,
  );

  // The clipmap's whole job: the patch travels with the camera, but the sand
  // stays where it was pressed. If the shift has the wrong sign the mark rides
  // along with the patch, which looks fine in isolation and is completely wrong.
  const clip = await page.evaluate(() => {
    const b = window.__beach;
    b.stop();
    b.waves.swashBody = 0; b.waves.swashFilm = 0; b.waves.amp = 0;
    b.field.setOrigin(0, 0);
    b.field.reset();
    b.field.step(0.016, null, b.waves, 0);

    // Up the beach, clear of the swash zone — at the waterline the wave would
    // scrub the mark away mid-test.
    const WZ = 1.5;
    const uv = b.field.worldToField(0, WZ);
    const brush = {
      kind: "press", a: uv, b: uv,
      radius: 0.024, depth: 0.34, rim: 0.42, pressure: 1.0,
    };
    for (let i = 0; i < 24; i++) b.field.step(0.016, brush, b.waves, 0);

    const gl = b.gl;
    const fb = gl.createFramebuffer();
    const row = Math.round(uv[1] * b.field.height);
    const readRow = () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, b.field.texture, 0);
      const px = new Float32Array(b.field.width * 4);
      gl.readPixels(0, row, b.field.width, 1, gl.RGBA, gl.FLOAT, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      let col = -1, lo = 0;
      for (let i = 0; i < b.field.width; i++) {
        if (px[i * 4] < lo) { lo = px[i * 4]; col = i; }
      }
      return { col, lo };
    };

    const before = readRow();

    // Dolly the patch a whole number of texels along the shore.
    const texel = (2 * b.field.domainX) / b.field.width;
    const TEXELS = 20;
    b.field.setOrigin(TEXELS * texel, 0);
    for (let i = 0; i < 3; i++) b.field.step(0.016, null, b.waves, 0);
    const after = readRow();
    gl.deleteFramebuffer(fb);

    return { before, after, expected: -TEXELS, moved: after.col - before.col };
  });

  check(
    "a mark survives the patch moving",
    clip.after.lo < -0.05,
    `depth ${clip.after.lo.toFixed(3)} after the dolly`,
  );
  check(
    "the mark stays put in the world",
    Math.abs(clip.moved - clip.expected) <= 1,
    `patch moved +20 texels, mark moved ${clip.moved} texels in the field ` +
      `(expected ${clip.expected} — equal and opposite)`,
  );

  if (shotPath) {
    await page.screenshot({ path: shotPath });
    console.log(`\n  screenshot → ${shotPath}`);
  }

  console.log(`\n  ${failures ? "FAIL" : "PASS"} — scene renders\n`);
  process.exit(failures ? 1 : 0);
} catch (err) {
  console.error("\n  ERROR", err.message, "\n");
  process.exit(1);
} finally {
  await browser?.close();
  stop();
}
