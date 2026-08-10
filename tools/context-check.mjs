#!/usr/bin/env node
/**
 * Drives the context-persistence harness in a real browser: two routes,
 * forward navigation, then the back and forward buttons, asserting after each
 * hop that it is still the SAME context and the field still holds its stamp.
 *
 * This is a legitimate use of headless despite the screenshot lesson in the
 * README. That lesson is about *temporal* behaviour — software rendering runs
 * ~1s of simulated time in 25 real seconds, so anything that evolves over time
 * reads as a flat line. Context identity and texture contents are discrete
 * state, not time-dependent, so SwiftShader answers them correctly.
 *
 *   node tools/context-check.mjs
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

const show = (label, report) => {
  console.log(`\n  ${report.ok ? "PASS" : "FAIL"}  ${label}`);
  for (const c of report.checks) {
    console.log(`        ${c.ok ? "ok  " : "FAIL"} ${c.label} — ${c.detail}`);
  }
  return report.ok;
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
  // §14.4 makes "no runtime errors" part of the gate, not a log line.
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await page.goto(`${BASE}/check/a`, { waitUntil: "networkidle0" });
  await page.waitForFunction("window.__beach !== undefined", { timeout: 15000 });

  const first = await page.evaluate(() => window.__beach.verify());
  if (first.format === "none") {
    console.log("\n  SKIP  no WebGL2 in this headless environment — run the harness by hand:");
    console.log(`        npm run dev  →  ${BASE.replace(String(PORT), "5273")}/check/a\n`);
    process.exit(0);
  }
  console.log(`\n  field ${first.format} @ ${first.field}`);

  let ok = show("boot", first);

  // Forward navigation through the toy History API router.
  const hops = [
    ["/check/b", 'a[data-nav][href="/check/b"]'],
    ["/check/a", 'a[data-nav][href="/check/a"]'],
  ];
  for (const [href, sel] of hops) {
    const before = await page.evaluate(() => window.__beach.navs());
    await page.click(sel);
    await page.waitForFunction((n) => window.__beach.navs() > n, {}, before);
    ok = show(`pushState → ${href}`, await page.evaluate(() => window.__beach.verify())) && ok;
  }

  // The back and forward buttons — the part that reloads under a naive router.
  for (const [label, act] of [
    ["back button", () => page.goBack()],
    ["forward button", () => page.goForward()],
  ]) {
    await act();
    await page.waitForFunction("window.__beach !== undefined", { timeout: 15000 });
    ok = show(label, await page.evaluate(() => window.__beach.verify())) && ok;
  }

  // Control: a full document load MUST fail, otherwise the probe is not
  // measuring anything and every result above is meaningless.
  await page.goto(`${BASE}/check/b`, { waitUntil: "networkidle0" });
  await page.waitForFunction("window.__beach !== undefined", { timeout: 15000 });
  const control = await page.evaluate(() => window.__beach.verify());
  const controlOk = !control.ok;
  console.log(`\n  ${controlOk ? "PASS" : "FAIL"}  control: full page load is detected as a teardown`);
  if (!controlOk) console.log("        the probe reported a healthy context after a real reload");

  if (pageErrors.length) {
    console.log(`\n  FAIL  ${pageErrors.length} uncaught runtime error(s)`);
    for (const m of pageErrors) console.log(`        ${m}`);
  }

  ok = ok && controlOk && pageErrors.length === 0;
  console.log(`\n  ${ok ? "PASS — one context survives routing" : "FAIL — see above"}\n`);
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.error("\n  ERROR", err.message, "\n");
  process.exit(1);
} finally {
  await browser?.close();
  stop();
}
