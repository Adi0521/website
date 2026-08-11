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

  // The look cannot be judged here — SwiftShader collapses the value noise to a
  // constant, so the baked ripples are absent in the prototype too. What CAN be
  // asserted is that the ported sim path writes the shape PRD §6.2 specifies:
  // a depression with sand pushed UP at its rim. Without the rim a footprint
  // looks stamped into clay, and a decay model would produce the hole alone.
  const stamp = await page.evaluate(() => {
    const b = window.__beach;
    b.stop(); // take the loop out of the way so the step count is exact
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
