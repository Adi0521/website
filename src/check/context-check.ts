/**
 * Two throwaway routes and a live verdict panel. Scaffolding for the Phase 3
 * router decision — the point is to answer "does navigation keep the context"
 * BEFORE five project pages are built on the assumption that it does.
 *
 * The router here is a deliberately minimal History API one, so a PASS means
 * "the two-mode design is reachable", not "you are done". When a real router
 * is chosen, mount it over these same two routes and re-run: the probe is the
 * part worth keeping, this router is not.
 */

import { pickTier } from "../gl/quality";
import { boot, verify, resetBoots, tint, type Report } from "./context-probe";

const ROUTES: Record<string, { title: string; tint: [number, number, number] }> = {
  "/check/a": { title: "Route A — the beach", tint: [0.05, 0.08, 0.13] },
  "/check/b": { title: "Route B — a focus page", tint: [0.13, 0.1, 0.08] },
};

const path = () => (ROUTES[location.pathname] ? location.pathname : "/check/a");

let navs = 0;
const lines: string[] = [];

function log(msg: string): void {
  lines.push(msg);
  const el = document.getElementById("log");
  if (el) el.textContent = lines.slice(-14).join("\n");
}

function summarise(r: Report): string {
  const el = document.getElementById("verdict");
  if (el) {
    el.textContent = r.ok ? "PASS" : "FAIL";
    el.style.color = r.ok ? "#7dd3a0" : "#ff6b6b";
  }
  const meta = document.getElementById("meta");
  if (meta) {
    meta.textContent =
      `boots ${r.docBoots} · contexts ${r.epoch} · ` +
      `lost ${r.contextLost} · ${r.format} @ ${r.field}`;
  }
  return r.checks.map((c) => `    ${c.ok ? "ok  " : "FAIL"} ${c.label}: ${c.detail}`).join("\n");
}

function render(): void {
  const route = ROUTES[path()]!;
  tint(route.tint[0], route.tint[1], route.tint[2]);

  const app = document.getElementById("app")!;
  app.innerHTML = `
    <main style="position:relative;z-index:1;font:14px/1.6 ui-monospace,monospace;
                 color:#e8e2d8;padding:2rem;max-width:70ch">
      <h1 style="font-size:1.1rem;margin:0 0 .25rem">${route.title}</h1>
      <p style="opacity:.6;margin:0 0 1.5rem">
        The canvas behind this text is never re-created. Navigate, then use the
        browser back and forward buttons — those are where naive routers reload.
      </p>

      <nav style="display:flex;gap:.75rem;margin-bottom:1.5rem">
        <a href="/check/a" data-nav style="color:#9ec8ff">→ Route A</a>
        <a href="/check/b" data-nav style="color:#9ec8ff">→ Route B</a>
        <a href="/check/b" style="color:#ff9e9e"
           title="Full page load — this SHOULD fail, it is the control">
           → Route B (hard load, control)</a>
      </nav>

      <div style="border:1px solid #ffffff22;padding:1rem;border-radius:4px">
        <div style="display:flex;align-items:baseline;gap:.75rem">
          <strong id="verdict" style="font-size:1.4rem">—</strong>
          <span id="meta" style="opacity:.6;font-size:.85em"></span>
        </div>
        <pre id="log" style="margin:.75rem 0 0;white-space:pre-wrap;font-size:.85em;opacity:.85"></pre>
      </div>

      <p style="opacity:.5;margin-top:1.5rem;font-size:.85em">
        A reload is counted, so it stays FAIL for the rest of the tab once one
        happens — that is the point. <button id="reset" style="font:inherit">Reset run</button>
        clears the counter and starts a clean session.
      </p>
    </main>`;

  const el = document.getElementById("log");
  if (el) el.textContent = lines.slice(-14).join("\n");

  document.getElementById("reset")?.addEventListener("click", () => {
    resetBoots();
    location.assign("/check/a");
  });

  app.querySelectorAll<HTMLAnchorElement>("a[data-nav]").forEach((a) => {
    a.addEventListener("click", (e: Event) => {
      e.preventDefault();
      const href = a.getAttribute("href")!;
      if (href === location.pathname) return;
      history.pushState({}, "", href);
      navs += 1;
      render();
      log(`nav #${navs} → ${href}\n${summarise(verify())}`);
    });
  });
}

export function run(): void {
  const canvas = document.getElementById("scene") as HTMLCanvasElement;
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    zIndex: "0",
  });
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  document.body.style.background = "#0d1520";
  document.body.style.margin = "0";

  const tier = pickTier();
  render();

  const first = boot(canvas, tier.field);
  log(`boot — ${tier.name} tier, field ${tier.field}\n${summarise(first)}`);
  render();
  summarise(first);

  addEventListener("popstate", () => {
    navs += 1;
    render();
    log(`back/forward #${navs} → ${location.pathname}\n${summarise(verify())}`);
  });

  // Handle for the Puppeteer driver and for poking at it from the console.
  Object.assign(window, {
    __beach: { verify, resetBoots, navs: () => navs },
  });
}
