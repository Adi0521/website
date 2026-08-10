/** The extensibility contract. A project implements this and nothing else. */

export type BrushKind =
  | "press"   // depression plus displaced rim — text, footprints, cat, resume plate
  | "track"   // swept segment with tread — car
  | "erupt"   // crater with ejecta ring — aliens
  | "drag"    // furrow with leading pile-up — reserved
  | "none";   // shadow only, writes no height — hovering market props

/**
 * THE BRUSH SET IS CLOSED. Adding a sixth kind requires a scope conversation,
 * not a commit. Keeping it closed is what makes project #6 a one-day job.
 */
export interface Brush {
  kind: BrushKind;
  /** Field-space position, both in 0..1. */
  a: [number, number];
  /** Segment end, so fast motion leaves no gaps. Equal to `a` when static. */
  b: [number, number];
  radius: number;
  depth: number;
  rim: number;
  pressure: number;
  /**
   * Seconds a mark holds before it begins to fill. Per-brush rather than
   * global: timeline footprints are milestones and should not heal in the
   * eight seconds an ordinary mark takes.
   */
  fillDelay?: number;
}

export interface ShadowDesc {
  /** World XZ. */
  pos: [number, number];
  radius: number;
  softness: number;
  opacity: number;
}

export interface AABB { minX: number; minZ: number; maxX: number; maxZ: number; }

export interface SandAgent {
  readonly id: string;
  readonly bounds: AABB;
  /** The slideshow drives these. Only one agent is ever active. */
  enter(t: number): void;
  exit(t: number): void;
  update(dt: number, viewport: { width: number; height: number }): void;
  stamps(): Brush[];
  /** Rasterized props. Depth comes from gl_FragDepth written by the march. */
  props(): unknown[];
  shadow(): ShadowDesc[];
}
