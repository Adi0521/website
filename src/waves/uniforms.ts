/**
 * The JavaScript half of the shared-wave invariant.
 *
 * `common/wave.glsl` is one file included by both sim.frag and render.frag so
 * they cannot compute different waterlines. That guarantee only holds if they
 * are also *fed* the same numbers — two call sites uploading these ten
 * uniforms would reintroduce exactly the drift the shared chunk prevents, and
 * the symptom is the confusing one: foam that erases nothing, sitting over
 * dark sand with no water on it.
 *
 * So there is one uploader, and both passes call it.
 */

import type { WaveScheduler } from "./scheduler";
import type { Program } from "../gl/program";
import type { WaterParams } from "../sand/params";

export function applyWaveUniforms(
  p: Program,
  water: WaterParams,
  waves: WaveScheduler,
  time: number,
): void {
  p.f("uTime", time);
  p.f("uSeaLevel", water.seaLevel);
  p.f("uShoreZ", water.shoreZ);
  p.f("uSlope", water.slope);
  p.f("uWaveAmp", waves.amp);
  p.f("uWaveLen", water.waveLen);
  p.f("uWavePhase", waves.phase);
  p.f("uSurge", water.surge);
  p.f("uSwash", waves.swashBody);
  p.f("uSwashFilm", waves.swashFilm);
}
