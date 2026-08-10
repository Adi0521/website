/**
 * Tiers scale sand-field resolution, march steps AND device pixel ratio
 * together. Scaling only one of them is how you end up with a tier that is
 * still GPU-bound but now also looks worse.
 *
 * Dev hardware measures ~120fps vsync-capped even at Cinematic, so Cinematic
 * is the desktop default. The Standard numbers are guesswork until someone
 * runs this on integrated graphics.
 */
export interface Tier {
  name: string; field: number; steps: number; dpr: number; post: "full" | "bloom" | "grain" | "none";
}

export const TIERS: Record<string, Tier> = {
  cinematic: { name: "cinematic", field: 2048, steps: 128, dpr: 2.0, post: "full"  },
  high:      { name: "high",      field: 1500, steps:  96, dpr: 1.5, post: "bloom" },
  standard:  { name: "standard",  field:  768, steps:  48, dpr: 1.0, post: "grain" },
};

export function pickTier(): Tier {
  const stored = localStorage.getItem("beach:tier");
  if (stored && TIERS[stored]) return TIERS[stored]!;
  const coarse = matchMedia("(pointer: coarse)").matches;
  return coarse ? TIERS.standard! : TIERS.cinematic!;
}
