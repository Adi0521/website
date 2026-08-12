/**
 * The route table (PRD §4).
 *
 * Every view returns real DOM as a string — §12 requires all content to be
 * readable with the canvas removed, and these pages are also what the
 * prerenderer captures for search, so a view that rendered nothing until the
 * scene booted would defeat both at once.
 *
 * Copy is placeholder by design (§13).
 */

import type { RouteDef } from "../router/router";
import { PROJECTS, bySlug } from "./projects";

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/** The measure and rhythm §9 asks for. Focus pages are meant to read as articles. */
const plate = (inner: string): string => `<article class="plate">${inner}</article>`;

const home: RouteDef = {
  path: "/",
  mode: "full",
  title: () => "Adi — Beach",
  description: () =>
    "A beach at low sun, where the sand is a live surface that remembers what touched it.",
  render: () => `
    <section class="hero">
      <h1>Adi</h1>
      <p class="lede">
        A beach at low sun. The sand is live — press into it and it remembers,
        until the wind fills it back in or a wave takes it.
      </p>
      <p class="util">Placeholder. Hero carve, timeline and slideshow are Phase 4 and 5.</p>
    </section>

    <!-- Phase 2's exit condition: scrolling an empty beach should be pleasant
         on its own. Until the About sections exist, this spacer is what drives
         the camera. It only exists on this route — focus pages do not scroll
         the scene. -->
    <div id="track" aria-hidden="true"></div>

    <section class="plate">
      <h2>Work</h2>
      <ul class="index">
        ${PROJECTS.map(
          (p) => `<li><a href="/work/${p.slug}">${esc(p.title)}</a> — ${esc(p.summary)}</li>`,
        ).join("")}
      </ul>
      <p><a href="/resume">Read the resume in full</a></p>
    </section>
  `,
};

const workIndex: RouteDef = {
  path: "/work",
  mode: "focus",
  title: () => "Work — Adi",
  description: () => "Project index.",
  render: () =>
    plate(`
      <h1>Work</h1>
      <p class="util">Placeholder index. §9: a plain list for scanning, no sand effects.</p>
      <ul class="index">
        ${PROJECTS.map(
          (p) => `
          <li>
            <a href="/work/${p.slug}">${esc(p.title)}</a>
            <span class="util">${esc(p.dates)}</span>
            <p>${esc(p.summary)}</p>
          </li>`,
        ).join("")}
      </ul>
    `),
};

const workDetail: RouteDef = {
  path: "/work/:slug",
  mode: "focus",
  // Unknown slugs fall through to the 404 rather than rendering an empty
  // project page at a URL that looks legitimate.
  valid: (p) => bySlug(p.slug ?? "") !== undefined,
  title: (p) => `${bySlug(p.slug!)?.title ?? "Work"} — Adi`,
  description: (p) => bySlug(p.slug!)?.summary ?? "",
  render: (p) => {
    const project = bySlug(p.slug!)!;
    const i = PROJECTS.indexOf(project);
    const prev = PROJECTS[i - 1];
    const next = PROJECTS[i + 1];
    return plate(`
      <h1>${esc(project.title)}</h1>
      <p class="util">${esc(project.dates)} · ${project.stack.map(esc).join(" · ")}</p>
      <p>${esc(project.summary)}</p>
      <h2>On the sand</h2>
      <p>${esc(project.sandBehaviour)}</p>
      <p class="util">Placeholder. Writeup, images and links land in Phase 7.</p>
      <nav class="prevnext">
        ${prev ? `<a href="/work/${prev.slug}">← ${esc(prev.title)}</a>` : "<span></span>"}
        ${next ? `<a href="/work/${next.slug}">${esc(next.title)} →</a>` : "<span></span>"}
      </nav>
    `);
  },
};

const resume: RouteDef = {
  path: "/resume",
  mode: "focus",
  title: () => "Resume — Adi",
  description: () => "Resume.",
  render: () =>
    plate(`
      <h1>Resume</h1>
      <p class="util">
        Placeholder. §9 is explicit that this is real HTML and not an iframed
        PDF — unreadable on mobile, invisible to search.
      </p>
      <p>
        <a href="/Adi-resume.pdf" download>Download PDF</a>
        — a plain anchor, so it works with JavaScript off.
      </p>
    `),
};

const contact: RouteDef = {
  path: "/contact",
  mode: "focus",
  title: () => "Contact — Adi",
  description: () => "Get in touch.",
  render: () =>
    plate(`
      <h1>Contact</h1>
      <p class="util">Placeholder. §9: short.</p>
    `),
};

export const notFound: RouteDef = {
  path: "/404",
  mode: "focus",
  title: () => "Not found — Adi",
  description: () => "That page does not exist.",
  render: () =>
    plate(`
      <h1>Not found</h1>
      <p>That page does not exist. <a href="/">Back to the beach</a>.</p>
    `),
};

export const ROUTES: RouteDef[] = [home, workIndex, workDetail, resume, contact];

/** Paths the prerenderer walks. Every one becomes a static HTML file. */
export const STATIC_PATHS: string[] = [
  "/",
  "/work",
  ...PROJECTS.map((p) => `/work/${p.slug}`),
  "/resume",
  "/contact",
];
