#!/usr/bin/env node
/**
 * Writes a real HTML file for every route, so the site is indexable.
 *
 * A client-rendered SPA serves crawlers an empty shell. §9 already rejects an
 * iframed PDF partly because it is "invisible to search", and a `<div id=app>`
 * with nothing in it has the same problem for every page on the site.
 *
 * Rather than adopt a framework for this, it loads the built site in the
 * headless Chrome already used elsewhere here, lets the router render each
 * route, and snapshots the result. Every page then arrives as complete HTML:
 * crawlers read it, and a human sees text before the engine has booted. The
 * script tags stay, so the router takes over on load and navigation continues
 * to be client-side — the one WebGL context is untouched.
 *
 *   npm run build   (which runs this at the end)
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import puppeteer from "puppeteer";

const PORT = 5281;
const BASE = `http://localhost:${PORT}`;
const DIST = "dist";

const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
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
  throw new Error(`vite preview did not come up on ${BASE} — did you run vite build?`);
}

let browser;
try {
  await waitForServer();
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(BASE, { waitUntil: "networkidle0" });
  await page.waitForFunction("window.__router !== undefined", { timeout: 20000 });

  // Read the route list from the running app rather than keeping a second copy
  // here: adding a project must not be able to leave its page unprerendered.
  const paths = await page.evaluate(() => window.__staticPaths);
  if (!Array.isArray(paths) || !paths.length) {
    throw new Error("the app did not expose __staticPaths");
  }

  console.log("");
  for (const path of paths) {
    await page.goto(BASE + path, { waitUntil: "networkidle0" });
    await page.waitForFunction("window.__router !== undefined", { timeout: 20000 });
    // Wait for the route the URL asked for, not merely for a rendered page —
    // snapshotting mid-navigation would write one route's HTML at another's
    // address, which is worse than not prerendering at all.
    await page.waitForFunction(
      (p) => window.__router?.match?.path === p,
      { timeout: 20000 },
      path,
    );

    // The canvas holds no markup and its contents cannot be serialised, so the
    // snapshot is exactly the DOM a visitor without WebGL would get — which
    // §12 already requires to be complete on its own.
    const html = await page.evaluate(
      () => "<!DOCTYPE html>\n" + document.documentElement.outerHTML,
    );
    const out = path === "/" ? join(DIST, "index.html") : join(DIST, path, "index.html");
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, html, "utf8");
    console.log(`  ${path.padEnd(26)} → ${out.padEnd(34)} ${(Buffer.byteLength(html) / 1024).toFixed(1)} kB`);
  }

  if (errors.length) {
    console.error(`\n  ${errors.length} script error(s) while prerendering:`);
    for (const e of errors) console.error(`    ${e}`);
    process.exit(1);
  }
  console.log(`\n  ${paths.length} route(s) prerendered\n`);
} catch (err) {
  console.error("\n  ERROR", err.message, "\n");
  process.exit(1);
} finally {
  await browser?.close();
  stop();
}
