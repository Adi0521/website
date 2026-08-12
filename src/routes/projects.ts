/**
 * The project manifest. PRD §3: "A CMS" is a non-goal — projects are code.
 *
 * Slugs are URLs and are the one field here that is expensive to change later,
 * because they are what gets linked to and indexed. Everything else is copy.
 *
 * The blurbs below are PLACEHOLDER. Phase 3 ships focus pages with placeholder
 * text on purpose (§13) so the mode system is built against an empty shell
 * rather than retrofitted around five finished writeups.
 */

export interface Project {
  slug: string;
  title: string;
  /** Display string, not parsed. */
  dates: string;
  stack: string[];
  /** One line, used on the index and as the meta description. */
  summary: string;
  /** Sand behaviour, from §8.3. Drives the agent in Phase 5. */
  sandBehaviour: string;
  links?: { label: string; href: string }[];
}

export const PROJECTS: Project[] = [
  {
    slug: "car",
    title: "Car",
    dates: "TBD",
    stack: ["TBD"],
    summary: "Placeholder — writeup not written yet.",
    sandBehaviour:
      "Drives a procedural path over the dunes, leaving tracks that persist and erode. Deeper on turns, spray on hard corners.",
  },
  {
    slug: "protein-prediction",
    title: "Protein prediction",
    dates: "TBD",
    stack: ["TBD"],
    summary: "Placeholder — writeup not written yet.",
    sandBehaviour:
      "Creatures erupt at staggered intervals with ejecta rings. Between eruptions, subtle heaving below the surface.",
  },
  {
    slug: "kalshi",
    title: "Kalshi / HFT",
    dates: "TBD",
    stack: ["TBD"],
    summary: "Placeholder — writeup not written yet.",
    sandBehaviour:
      "Tickers and a market panel hover, casting soft shadows that track their bob. A cat sits nearby, pressing in, ears tracking the price line.",
  },
];

export const bySlug = (slug: string): Project | undefined =>
  PROJECTS.find((p) => p.slug === slug);
