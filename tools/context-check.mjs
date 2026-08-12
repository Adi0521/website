#!/usr/bin/env node
/**
 * Proves the router never loads a document — the assumption the two-mode
 * design rests on (§10).
 *
 * `gl.isContextLost() === false` does not answer this. It is a property of a
 * context object, and both realistic failure modes hand you a different,
 * perfectly healthy one:
 *
 *   1. A full document load. New document, new canvas, new context. Reports
 *      not-lost, and the sand is gone. Caught by the boot token: sessionStorage
 *      survives a reload, a `window` property does not.
 *   2. The canvas unmounted and remounted. Same document, brand-new context.
 *      Also not lost. Caught by pressing a mark and looking for it afterwards.
 *
 * So this presses into the sand, navigates the real routes the real way — nav
 * clicks, back, forward, a deep link — and asks whether the mark is still
 * there. A full page load is the control, and must fail.
 *
 *   npm run check:context
 */

import { spawn } from "node:child_process";
import puppeteer from "puppeteer";

const PORT = 5274;
const BASE = `http://localhost:${PORT}`;

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

/** Presses a mark at the camera's target and records how deep it went. */
const PRESS = `(() => {
  const b = window.__beach;
  b.stop();
  b.field.reset();
  b.field.step(0.016, null, b.waves, 0);
  const t = b.camera.target;
  const uv = b.field.worldToField(t[0], t[2]);
  const brush = {
    kind: "press", a: uv, b: uv, radius: 0.05, depth: 0.34, rim: 0.42,
    pressure: 1.0, fillDelay: 600,
  };
  for (let i = 0; i < 24; i++) b.field.step(0.016, brush, b.waves, 0);
  sessionStorage.setItem("probe:token", "T");
  window.__probeToken = "T";
  window.__probeWorld = [t[0], t[2]];
  b.start();
  return true;
})()`;

/**
 * Reads back the deepest point near where the mark was pressed. The long
 * fillDelay keeps it from healing during the run, so any loss of depth here
 * means the field itself went away rather than the sand simply settling.
 */
const LOOK = `(() => {
  const b = window.__beach;
  const gl = b.gl;
  const reloaded = window.__probeToken !== sessionStorage.getItem("probe:token");
  const world = window.__probeWorld;
  let depth = 0, readable = false;
  if (!gl.isContextLost() && world) {
    const uv = b.field.worldToField(world[0], world[1]);
    if (uv) {
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, b.field.texture, 0);
      readable = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      if (readable) {
        const px = new Float32Array(b.field.width * 4);
        gl.readPixels(0, Math.round(uv[1] * b.field.height), b.field.width, 1, gl.RGBA, gl.FLOAT, px);
        for (let i = 0; i < b.field.width; i++) if (px[i * 4] < depth) depth = px[i * 4];
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);
    }
  }
  return {
    reloaded,
    lost: gl.isContextLost(),
    depth,
    readable,
    path: location.pathname,
    mode: document.documentElement.dataset.mode,
  };
})()`;

const report = (label, s) => {
  const ok = !s.reloaded && !s.lost && s.depth < -0.02;
  check(label, ok,
    `${s.path} (${s.mode}) · ${s.reloaded ? "DOCUMENT RELOADED · " : ""}` +
    `${s.lost ? "context lost · " : ""}mark ${s.depth.toFixed(3)}`);
  return ok;
};

let browser;
try {
  await waitForServer();
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(BASE, { waitUntil: "networkidle0" });
  await page.waitForFunction("window.__beach !== undefined && window.__router !== undefined", {
    timeout: 20000,
  });

  console.log("");
  const started = await page.evaluate(PRESS);
  check("a mark is pressed into the sand", started === true);
  report("still there at boot", await page.evaluate(LOOK));

  // Real navigation, the way a visitor does it: clicking the nav.
  const go = async (selector, label) => {
    await page.click(selector);
    await page.waitForFunction("window.__router.match !== null", { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 250));
    report(label, await page.evaluate(LOOK));
  };

  await go('#nav a[href="/work"]', "nav → /work");
  await go('.index a[href="/work/car"]', "link → /work/car");
  await go('#nav a[href="/resume"]', "nav → /resume");
  await go('#nav a[href="/"]', "nav → / (back to the beach)");

  for (const [label, act] of [
    ["back button", () => page.goBack()],
    ["back button again", () => page.goBack()],
    ["forward button", () => page.goForward()],
  ]) {
    await act();
    await new Promise((r) => setTimeout(r, 250));
    report(label, await page.evaluate(LOOK));
  }

  // Control: a real document load MUST lose it. Without this the four checks
  // above could all be passing on a probe that cannot tell the difference.
  await page.goto(`${BASE}/resume`, { waitUntil: "networkidle0" });
  await page.waitForFunction("window.__beach !== undefined", { timeout: 20000 });
  const control = await page.evaluate(LOOK);
  const controlOk = control.reloaded && control.depth > -0.02;
  check("control: a full page load is detected as a teardown", controlOk,
    controlOk
      ? "document reloaded and the sand is gone, as it must be"
      : `reloaded=${control.reloaded} depth=${control.depth.toFixed(3)} — the probe cannot tell`);

  // A deep link is a document load by definition (§4), and must still render.
  const deep = await page.evaluate(
    () => ({ path: location.pathname, mode: document.documentElement.dataset.mode, h1: document.querySelector("#app h1")?.textContent }),
  );
  check("a deep link lands in focus mode", deep.mode === "focus" && deep.h1 === "Resume",
    `${deep.path} → ${deep.mode}, heading "${deep.h1}"`);

  if (errors.length) {
    check("no uncaught script errors", false, errors[0]);
  } else {
    check("no uncaught script errors", true);
  }

  console.log(`\n  ${failures ? "FAIL — see above" : "PASS — one context survives the router"}\n`);
  process.exit(failures ? 1 : 0);
} catch (err) {
  console.error("\n  ERROR", err.message, "\n");
  process.exit(1);
} finally {
  await browser?.close();
  stop();
}
