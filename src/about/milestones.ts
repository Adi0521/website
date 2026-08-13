/**
 * Timeline content — PRD §8.2.
 *
 * Data only, for now. §8.2's footprint trail — prints in the sand, hover or
 * scrub pressing one deeper — is deliberately NOT here: it lands with the rest
 * of the hover work rather than on its own.
 *
 * That is not just sequencing. A first pass built the trail as ordinary
 * `press` brushes, and the field takes one brush per step (see
 * `SandField.step`), so the prints could only be written on frames the pointer
 * did not want. The trail appeared when the cursor left the sand and eroded
 * away when it came back — a feature of the world coupled to cursor position.
 * Pressing alongside the pointer needs the separate stamp pass §6.4 defers to
 * Phase 5, and building the trail before that exists just buys the bug again.
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
   * World Z of the print, once there are prints.
   *
   * Five milestones ~1.4 world units apart across the camera's 2.0→7.6 travel
   * — one per screenful, so each arrives on its own. At a real walking spacing
   * of ~0.6 they crowd into a texture rather than reading as separate events,
   * and at the Standard tier's 768² field they stop resolving as footprints.
   *
   * Ordered with `now` lowest on the beach, so scrolling travels backwards
   * through time. Erosion will have to be keyed to AGE rather than distance
   * when the trail is built: keyed to distance, this layout would make the
   * OLDEST print the crispest and inverting §8.2's metaphor exactly.
   */
  z: number;
}

/** Copy is placeholder — §13 puts content in Phase 7. The z values are not. */
export const MILESTONES: Milestone[] = [
  { id: "now", z: 2.0, label: "Now", detail: "Building this." },
  { id: "m2", z: 3.4, label: "Placeholder", detail: "Second milestone." },
  { id: "m3", z: 4.8, label: "Placeholder", detail: "Third milestone." },
  { id: "m4", z: 6.2, label: "Placeholder", detail: "Fourth milestone." },
  { id: "m5", z: 7.6, label: "Earliest", detail: "Where it started." },
];
