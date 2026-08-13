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
import { MILESTONES } from "../about/milestones";
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
    <!-- data-carve is read by src/about/mount.ts, which rasterizes exactly this
         string. The <h1> stays visible and the sand carries an impression of
         it, so the two must agree — same face, same weight, same tracking. -->
    <section class="hero">
      <h1 data-carve>Adi</h1>
      <p class="lede">
        A beach at low sun. The sand is live — press into it and it remembers,
        until the wind fills it back in or a wave takes it.
      </p>
    </section>

    <!-- §8.2's timeline, as content. The footprint trail in the sand and the
         hover-to-press-deeper behaviour land together with the rest of the
         hover work — see src/about/milestones.ts.

         Plain list items, NOT buttons. They were buttons while the sand
         responded to focus; with nothing to activate, a <button> announces an
         action to a screen reader that does not exist. §12 asks for real text
         and a real reading order, and that is all this needs to be until there
         is something to press. -->
    <section id="timeline" aria-labelledby="timeline-h">
      <h2 id="timeline-h">Timeline</h2>
      <ol class="trail">
        ${MILESTONES.map(
          (m) => `
          <li class="milestone">
            <span class="util">${esc(m.label)}</span>
            <span class="detail">${esc(m.detail)}</span>
          </li>`,
        ).join("")}
      </ol>
    </section>

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
