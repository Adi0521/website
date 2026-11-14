/**
 * Timeline content — PRD §8.2.
 *
 * The prints themselves are pressed by src/about/trail.ts, as one mask stamp
 * rather than as `press` brushes — see that file for why. Hover or scrub
 * pressing one deeper is not built yet.
 *
 * What IS here is the content, and §12 wants it to stand on its own anyway:
 * every milestone is real text, readable with the canvas removed. The list is
 * also what gives About its scroll length, which is what drives the camera up
 * the beach (§13, Phase 2) now that the placeholder spacer is gone.
 */

export interface Milestone {
  id: string;
  label: string;
  detail: string;
  /**
   * World Z of the print.
   *
   * The trail starts just past the "Timeline" signpost (z 5.0, sign.ts) and
   * runs up to 9.0, ~0.85 apart. Everything above z≈4.6 is behind the camera
   * at the top of the page, so the sign and then the prints walk in from the
   * bottom of the screen as you scroll. 9.0 is about the highest a print can
   * sit and still be clear of the bottom edge when the scroll ends (camera
   * target 7.6, the ground at the screen's bottom edge ~1.8 beyond it).
   *
   * Ordered with `now` lowest on the beach, so scrolling travels backwards
   * through time. Erosion is keyed to AGE, not distance (see trail.ts).
   */
  z: number;
}

/** Copy is placeholder — §13 puts content in Phase 7. The z values are not. */
export const MILESTONES: Milestone[] = [
  { id: "now", z: 5.6, label: "Now", detail: "Building this." },
  { id: "m2", z: 6.45, label: "Placeholder", detail: "Second milestone." },
  { id: "m3", z: 7.3, label: "Placeholder", detail: "Third milestone." },
  { id: "m4", z: 8.15, label: "Placeholder", detail: "Fourth milestone." },
  { id: "m5", z: 9.0, label: "Earliest", detail: "Where it started." },
];
