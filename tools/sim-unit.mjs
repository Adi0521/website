#!/usr/bin/env node
/**
 * Drives sim.frag headless with fixed timesteps and reads heights back through
 * an RGBA8 probe, so erosion and wave behaviour can be asserted numerically.
 *
 * This is separate from screenshotting the page for a specific reason: software
 * rendering cannot test temporal behaviour. A fill-in test against the live page
 * looked like a flat line purely because ~1 second of simulated time elapsed in
 * 25 real seconds. Anything time-dependent goes through this harness.
 *
 * The fill-in curve at shipped defaults, 1280x800 field, measured here:
 *     pressed  -0.339   +1s  -0.331   +3s  -0.118   +8s  -0.007
 * The rim dropping on the same schedule as the hole is the diagnostic that
 * slumping is working rather than decay.
 *
 * PRD §6.2's table has the same shape normalised but is 1.8x deeper, because
 * it was taken with `depth` near 0.6; the stamp converges to -depth, and the
 * shipped default is 0.34. The curve is also resolution-dependent — see the
 * pinned viewport below.
 *
 * Modules are loaded through Vite rather than imported directly: CI runs Node
 * 20, which cannot strip types, and the GPU suite below will need Vite anyway
 * to resolve `#include` in the shaders through vite-plugin-glsl.
 */

import { createServer } from "vite";
import puppeteer from "puppeteer";

const PORT = 5280;

let failures = 0;
let ran = 0;

function check(label, fn) {
  ran += 1;
  try {
    const detail = fn();
    console.log(`  ok    ${label}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL  ${label}\n          ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

const vite = await createServer({ server: { port: PORT, strictPort: true } });
await vite.listen();
let browser;

try {
  const { planCatchUp, MAX_DT, CATCH_UP_CAP } = await vite.ssrLoadModule("/src/sand/catchup.ts");

  // ── Focus-mode catch-up (PRD §9 vs §10) ──────────────────────────────────
  // §9 stops the sim on focus pages, §10 wants marks "further eroded" on
  // return. The plan that reconciles them has to stay inside the §6.2
  // per-step stability bound without stalling the §10 transition budget.
  console.log("\ncatch-up stepping — returning from focus mode\n");

  check("the constants are anchored, not self-referential", () => {
    // Every check below reads MAX_DT from the module under test, so on its own
    // the suite would happily certify a constant that rings the field.
    // 0.05 is the clamp the working prototype ships (sand-phase1.html:903).
    assert(MAX_DT <= 0.05, `MAX_DT ${MAX_DT} exceeds the prototype clamp of 0.05`);
    assert(CATCH_UP_CAP >= 8, `cap of ${CATCH_UP_CAP}s truncates the §6.2 fill-in curve`);
    return `MAX_DT ${MAX_DT} <= 0.05, cap ${CATCH_UP_CAP}s >= 8s`;
  });

  check("an ordinary frame is left alone", () => {
    const p = planCatchUp(1 / 60);
    assert(p.steps === 1, `expected 1 step, got ${p.steps}`);
    assert(near(p.simulated, 1 / 60), `simulated ${p.simulated}`);
    assert(p.skipped === 0, `skipped ${p.skipped}`);
    return `1 step of ${p.dt.toFixed(4)}s`;
  });

  check("no substep can exceed the per-step ceiling", () => {
    // Holds across the whole range including absurd gaps. What it protects is
    // the AMOUNT of erosion, not stability — see the GPU section below, where
    // one 8s leap erodes 58% against 98% for the same span substepped.
    for (const gap of [0.05, 0.06, 0.9, 3, 7.99, 8, 8.01, 240, 3600, 86_400]) {
      const p = planCatchUp(gap);
      assert(p.dt <= MAX_DT + 1e-12, `gap ${gap}s produced dt ${p.dt} > ${MAX_DT}`);
    }
    return `dt <= ${MAX_DT} for gaps up to 24h`;
  });

  check("a long focus-page visit is capped", () => {
    const p = planCatchUp(240); // four minutes reading /work/:slug
    assert(near(p.simulated, CATCH_UP_CAP), `simulated ${p.simulated}s`);
    assert(near(p.skipped, 240 - CATCH_UP_CAP), `skipped ${p.skipped}s`);
    return `240s → ${p.simulated}s simulated, ${p.steps} passes`;
  });

  check("the return transition cannot be stalled", () => {
    // §10 budgets ~600ms, eased and interruptible. An uncapped catch-up over a
    // four-minute visit would be 4,800 passes in the frame the pull starts.
    const ceiling = Math.ceil(CATCH_UP_CAP / MAX_DT);
    for (const gap of [8, 60, 240, 3600, 86_400]) {
      const p = planCatchUp(gap);
      assert(p.steps <= ceiling, `gap ${gap}s wanted ${p.steps} passes, ceiling is ${ceiling}`);
    }
    return `worst case ${ceiling} passes, not 4800`;
  });

  check("short navigations erode exactly, nothing discarded", () => {
    // Below the cap the promise in §10 is kept literally, not approximated.
    for (const gap of [0.2, 1, 3, 7.9, CATCH_UP_CAP]) {
      const p = planCatchUp(gap);
      assert(p.skipped === 0, `gap ${gap}s discarded ${p.skipped}s`);
      assert(near(p.simulated, gap), `gap ${gap}s simulated ${p.simulated}s`);
    }
    return `exact up to the ${CATCH_UP_CAP}s cap`;
  });

  check("steps land on the simulated span with no drift", () => {
    // Repeated focus-mode round trips must not accumulate error.
    for (const gap of [0.016, 0.07, 1.3, 5.5, 8, 500]) {
      const p = planCatchUp(gap);
      assert(near(p.steps * p.dt, p.simulated, 1e-9), `gap ${gap}s: ${p.steps} × ${p.dt}`);
    }
    return "steps × dt === simulated";
  });

  check("a suspended tab cannot produce a hang", () => {
    // These arrive from wall-clock deltas across sleep, tab discard and clock
    // adjustment. A negative or NaN gap must not become a step count.
    for (const bad of [0, -1, -0.0001, NaN, Infinity, -Infinity]) {
      const p = planCatchUp(bad);
      assert(p.steps === 0, `gap ${bad} produced ${p.steps} steps`);
      assert(p.dt === 0, `gap ${bad} produced dt ${p.dt}`);
    }
    return "0 / negative / NaN / Infinity → empty plan";
  });


  // ── Field behaviour, on the GPU ──────────────────────────────────────────
  // Driven with FIXED timesteps, which is the whole point. The screenshot
  // lesson in §14 is about wall-clock time: under software rendering only ~1s
  // of simulated time passed in 25 real seconds, so anything measured against
  // the clock read as a flat line. Stepping the field a counted number of
  // times is immune to that — it just takes a while.
  console.log("\nfield behaviour — sim.frag driven at fixed timesteps\n");

  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage();
  // Pinned, because the fill-in rate is resolution-dependent: slumping compares
  // neighbouring texels, so a finer field has smaller height differences
  // between them, fewer pairs past the angle of repose, and slower fill.
  // Comparing these numbers to anything means matching this viewport.
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`http://localhost:${PORT}`, { waitUntil: "networkidle0" });
  await page.waitForFunction("window.__beach !== undefined", { timeout: 20000 });

  const gpu = await page.evaluate(() => {
    const b = window.__beach;
    b.stop();
    b.autoDowngrade = false;
    // Still water. A wave arriving mid-run would scrub the mark being measured
    // and the curve would be of the wrong thing entirely.
    b.waves.swashBody = 0; b.waves.swashFilm = 0; b.waves.amp = 0; b.waves.phase = 0;
    b.field.setOrigin(0, 0);

    const gl = b.gl;
    const fb = gl.createFramebuffer();
    // Up the dry beach but inside the patch: it only spans DOMAIN (2.6) either
    // side of its origin, and the swash reaches z≈1.76 at full lateral spread.
    const WZ = 2.2;
    const uv = b.field.worldToField(0, WZ);
    if (!uv) throw new Error(`z=${WZ} is outside the patch`);
    const row = Math.round(uv[1] * b.field.height);

    const sample = () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, b.field.texture, 0);
      const px = new Float32Array(b.field.width * 4);
      gl.readPixels(0, row, b.field.width, 1, gl.RGBA, gl.FLOAT, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      let hole = 0, rim = 0, crossings = 0, prev = 0;
      for (let i = 0; i < b.field.width; i++) {
        const h = px[i * 4];
        if (h < hole) hole = h;
        if (h > rim) rim = h;
        // Sign flips above the noise floor. Ringing shows up here as a run of
        // alternating texels; a settled field crosses zero only at the rim.
        if (Math.abs(h) > 0.004) {
          const s = Math.sign(h);
          if (prev !== 0 && s !== prev) crossings += 1;
          prev = s;
        }
      }
      return { hole, rim, crossings };
    };

    const brush = {
      kind: "press", a: uv, b: uv,
      radius: 0.024, depth: 0.34, rim: 0.42, pressure: 1.0,
    };
    const fresh = () => {
      b.field.reset();
      b.field.step(0.016, null, b.waves, 0);
      for (let i = 0; i < 30; i++) b.field.step(0.016, brush, b.waves, 0);
    };
    const settle = (secs, dt) => {
      const n = Math.round(secs / dt);
      for (let i = 0; i < n; i++) b.field.step(dt, null, b.waves, 0);
    };

    // Fill-in curve (PRD §6.2).
    fresh();
    const pressed = sample();
    settle(1, 0.016); const at1 = sample();
    settle(2, 0.016); const at3 = sample();
    settle(5, 0.016); const at8 = sample();

    // Catch-up: the same 8 seconds, planned into substeps versus taken in one
    // leap. This is the numeric claim the cap in src/sand/catchup.ts rests on.
    fresh();
    const before = sample();
    for (let i = 0; i < 160; i++) b.field.step(0.05, null, b.waves, 0);
    const planned = sample();

    fresh();
    b.field.step(8.0, null, b.waves, 0);
    const oneLeap = sample();

    gl.deleteFramebuffer(fb);
    return {
      field: `${b.field.width}×${b.field.height}`,
      pressed, at1, at3, at8, before, planned, oneLeap,
    };
  });

  const f = (v) => (v >= 0 ? " " : "") + v.toFixed(3);
  console.log(`  field ${gpu.field}\n`);
  console.log("           hole     rim");
  console.log(`  pressed ${f(gpu.pressed.hole)}  ${f(gpu.pressed.rim)}`);
  console.log(`  +1s     ${f(gpu.at1.hole)}  ${f(gpu.at1.rim)}`);
  console.log(`  +3s     ${f(gpu.at3.hole)}  ${f(gpu.at3.rim)}`);
  console.log(`  +8s     ${f(gpu.at8.hole)}  ${f(gpu.at8.rim)}\n`);

  check("the mark fills in monotonically", () => {
    const d = [gpu.pressed.hole, gpu.at1.hole, gpu.at3.hole, gpu.at8.hole].map(Math.abs);
    for (let i = 1; i < d.length; i++) {
      assert(d[i] <= d[i - 1] + 1e-4, `depth grew between sample ${i - 1} and ${i}: ${d[i - 1]} → ${d[i]}`);
    }
    return `${d.map((x) => x.toFixed(3)).join(" → ")}`;
  });

  check("the fill delay holds the mark through the first second", () => {
    const kept = Math.abs(gpu.at1.hole) / Math.abs(gpu.pressed.hole);
    assert(kept > 0.8, `only ${(kept * 100).toFixed(0)}% of the depth survived 1s`);
    return `${(kept * 100).toFixed(0)}% of the depth still there at +1s`;
  });

  check("the rim falls with the hole, not after it", () => {
    // §6.2's diagnostic. Under a decay model each texel shrinks on its own and
    // the rim would persist while the hole vanished; slumping trades material
    // between them, so they go together.
    const hole = 1 - Math.abs(gpu.at3.hole) / Math.abs(gpu.pressed.hole);
    const rim = 1 - Math.abs(gpu.at3.rim) / Math.abs(gpu.pressed.rim);
    assert(rim > hole * 0.4, `by +3s the hole lost ${(hole * 100).toFixed(0)}% but the rim only ${(rim * 100).toFixed(0)}%`);
    return `by +3s the hole lost ${(hole * 100).toFixed(0)}%, the rim ${(rim * 100).toFixed(0)}%`;
  });

  check("the mark is effectively gone by +8s", () => {
    const left = Math.abs(gpu.at8.hole) / Math.abs(gpu.pressed.hole);
    assert(left < 0.15, `${(left * 100).toFixed(0)}% of the depth remains`);
    return `${(left * 100).toFixed(1)}% of the depth remains`;
  });

  check("a planned catch-up erodes; one leap does not", () => {
    // The reason src/sand/catchup.ts substeps. Every rate in sim.frag is
    // clamped per step, so a single huge dt does not blow up — it quietly
    // applies one step's worth of erosion and calls eight seconds done.
    const planned = 1 - Math.abs(gpu.planned.hole) / Math.abs(gpu.before.hole);
    const leap = 1 - Math.abs(gpu.oneLeap.hole) / Math.abs(gpu.before.hole);
    assert(planned > 0.8, `160 substeps only eroded ${(planned * 100).toFixed(0)}%`);
    assert(planned > leap * 1.5, `one leap eroded ${(leap * 100).toFixed(0)}%, substeps ${(planned * 100).toFixed(0)}% — substepping is not doing anything`);
    return `160 × 0.05s erodes ${(planned * 100).toFixed(0)}%, one 8s step ${(leap * 100).toFixed(0)}%`;
  });

  check("neither path rings the field", () => {
    // The per-step clamps are what prevent this. A ringing field alternates
    // sign texel to texel and the crossing count runs away.
    assert(gpu.planned.crossings <= 4, `planned catch-up left ${gpu.planned.crossings} sign changes`);
    assert(gpu.oneLeap.crossings <= 4, `one leap left ${gpu.oneLeap.crossings} sign changes`);
    return `${gpu.planned.crossings} and ${gpu.oneLeap.crossings} sign changes across the row`;
  });

  // ── Phase 4: the mask stamp (PRD §8.1) ───────────────────────────────────
  //
  // §14 is right that software rendering cannot judge appearance, so this does
  // not try to. Whether carved type is LEGIBLE is a question for a real GPU and
  // a person. Whether the mask stamped the shape it was given is numeric, and
  // that is what is asserted here: a probe inside a stroke against a probe
  // inside a counter.
  //
  // The mask is built from raw pixel data rather than from rasterized text on
  // purpose. Two reasons. The thing under test is the stamp path in sim.frag,
  // not the font stack — a test that also depended on Mattone arriving over the
  // network would fail for a reason that has nothing to do with the sand. And
  // canvas `filter: blur()` is not guaranteed under SwiftShader, so the soft
  // edge the rim is derived from is computed here instead of drawn.
  console.log("\nmask stamp — text carved as a field, not as a path\n");

  const mask = await page.evaluate(() => {
    const b = window.__beach;
    b.stop();
    b.autoDowngrade = false;
    b.waves.swashBody = 0; b.waves.swashFilm = 0; b.waves.amp = 0; b.waves.phase = 0;
    b.field.setOrigin(0, 0);

    const gl = b.gl;

    // Two bars with a gap: stroke, counter, stroke. The edges ramp over 8
    // texels, which is what gives the rim band something to sit in — a hard
    // mask has no gradient, so mRing is zero everywhere and the carve comes out
    // rimless. That is worth knowing about the real rasterizer too, and is why
    // TextMask blurs.
    const MW = 256, MH = 64;
    const BAR1 = [40, 100], GAP = [100, 156], BAR2 = [156, 216];
    const px = new Uint8Array(MW * MH * 4);
    const ramp = (x, edge) => Math.max(0, Math.min(1, (x - edge) / 8));
    for (let y = 0; y < MH; y++) {
      for (let x = 0; x < MW; x++) {
        const in1 = Math.min(ramp(x, BAR1[0]), 1 - ramp(x, BAR1[1] - 8));
        const in2 = Math.min(ramp(x, BAR2[0]), 1 - ramp(x, BAR2[1] - 8));
        const v = Math.round(255 * Math.max(0, Math.max(in1, in2)));
        const i = (y * MW + x) * 4;
        px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255;
      }
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, MW, MH, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    // Up the dry beach, clear of the swash for the same reason the fill-in
    // probe above is.
    const WZ = 2.2;
    const DEPTH = 0.5;
    const stamp = {
      texture: tex,
      center: [0, WZ],
      half: [1.0, 1.0 / (MW / MH)], // aspect-matched, or the type skews
      pressure: 1.0,
      depth: DEPTH,
      rim: 0.45,
      fillDelay: 6,
    };

    // World X of each feature's centre, from its pixel column in the mask.
    const worldX = (col) => (col / MW - 0.5) * 2 * stamp.half[0];
    const xStroke1 = worldX((BAR1[0] + BAR1[1]) / 2);
    const xCounter = worldX((GAP[0] + GAP[1]) / 2);
    const xStroke2 = worldX((BAR2[0] + BAR2[1]) / 2);
    // Outside the rect entirely — the mask must be local to where it is placed.
    const xOutside = stamp.half[0] * 1.6;

    const fb = gl.createFramebuffer();
    const probe = (x, z) => {
      const uv = b.field.worldToField(x, z);
      if (!uv) return null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, b.field.texture, 0);
      const out = new Float32Array(4);
      gl.readPixels(
        Math.round(uv[0] * b.field.width), Math.round(uv[1] * b.field.height),
        1, 1, gl.RGBA, gl.FLOAT, out,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return out[0];
    };

    const carve = (steps, s) => {
      for (let i = 0; i < steps; i++) b.field.step(0.016, null, b.waves, 0, s);
    };

    b.field.reset();
    b.field.step(0.016, null, b.waves, 0);
    carve(40, stamp);

    const shape = {
      stroke1: probe(xStroke1, WZ),
      counter: probe(xCounter, WZ),
      stroke2: probe(xStroke2, WZ),
      outside: probe(xOutside, WZ),
    };

    // The rim: highest point across the row through the carve. Pressed sand
    // pushes up at the edge (§6.4), so a carve with no positive anywhere in it
    // is a dent in plastic.
    let rim = 0;
    for (let c = 0; c < 40; c++) {
      const x = -stamp.half[0] + (c / 39) * 2 * stamp.half[0];
      const h = probe(x, WZ);
      if (h !== null && h > rim) rim = h;
    }

    // ── World anchoring ──────────────────────────────────────────────────
    // The carve is placed in world space, so travelling the patch under it must
    // leave it where it was. Lifted first: with the mask still pressing it
    // would simply re-carve at the new position and a uv-anchored bug would
    // pass. The shift is a whole number of texels by construction (setOrigin
    // snaps), so the resample is exact.
    const beforeShift = probe(xStroke1, WZ);
    b.field.setOrigin(0, 0.4);
    b.field.step(0.016, null, b.waves, 0, null);
    const afterShift = probe(xStroke1, WZ);
    b.field.setOrigin(0, 0);
    b.field.step(0.016, null, b.waves, 0, null);

    // ── Fill-delay scoping ───────────────────────────────────────────────
    // A brush with a long delay must hold ITS OWN mark, not stop the whole
    // field eroding. This was a real defect: the delay was one uniform, and
    // `ramp` gates transport for every texel, so any long-delay brush froze the
    // entire beach for the steps it was active.
    const P = b.field.worldToField(-0.6, WZ);
    const Q = b.field.worldToField(0.9, WZ); // far from P, so coverage there is 0
    const ordinary = { kind: "press", a: P, b: P, radius: 0.024, depth: 0.34, rim: 0.42, pressure: 1.0 };
    const patient = { kind: "press", a: Q, b: Q, radius: 0.024, depth: 0.34, rim: 0.42, pressure: 1.0, fillDelay: 20 };

    const erodeAt = (companion) => {
      b.field.reset();
      b.field.step(0.016, null, b.waves, 0);
      for (let i = 0; i < 30; i++) b.field.step(0.016, ordinary, b.waves, 0);
      const pressed = probe(-0.6, WZ);
      // 3 seconds during which `companion` is the active brush somewhere else.
      for (let i = 0; i < Math.round(3 / 0.016); i++) b.field.step(0.016, companion, b.waves, 0);
      return { pressed, after: probe(-0.6, WZ) };
    };
    const alone = erodeAt(null);
    const alongside = erodeAt(patient);

    gl.deleteFramebuffer(fb);
    gl.deleteTexture(tex);
    return {
      depth: DEPTH, shape, rim,
      beforeShift, afterShift,
      alone, alongside,
    };
  });

  const g = (v) => (v >= 0 ? " " : "") + v.toFixed(3);
  console.log(`  stroke ${g(mask.shape.stroke1)}   counter ${g(mask.shape.counter)}   ` +
              `stroke ${g(mask.shape.stroke2)}   outside ${g(mask.shape.outside)}\n`);

  check("the mask carves its strokes to depth", () => {
    // The stamp converges to -depth, exactly as the segment brush does.
    for (const [name, h] of [["first", mask.shape.stroke1], ["second", mask.shape.stroke2]]) {
      assert(h < -mask.depth * 0.7, `${name} stroke only reached ${h.toFixed(3)} of -${mask.depth}`);
    }
    return `both strokes at ~${mask.shape.stroke1.toFixed(3)} against a target of -${mask.depth}`;
  });

  check("the counter is not carved", () => {
    // The whole point of a mask over a swept segment. A path-based stamp
    // joining the two strokes would fill this in, and the letters would come
    // out as a trench.
    const stroke = Math.abs(mask.shape.stroke1);
    const counter = Math.abs(mask.shape.counter);
    assert(counter < stroke * 0.25, `counter at ${mask.shape.counter.toFixed(3)} against stroke ${mask.shape.stroke1.toFixed(3)}`);
    return `counter ${mask.shape.counter.toFixed(3)} vs stroke ${mask.shape.stroke1.toFixed(3)}`;
  });

  check("the carve stays inside its own rect", () => {
    // CLAMP_TO_EDGE would otherwise smear the mask's border row along the
    // whole beach, which is what the rect test in maskAt() exists to stop.
    assert(Math.abs(mask.shape.outside) < 0.01, `sand outside the rect moved to ${mask.shape.outside.toFixed(3)}`);
    return `${mask.shape.outside.toFixed(4)} outside the rect`;
  });

  check("the carve has a rim", () => {
    // §6.4: pressed sand pushes up at the edge. Without it the title looks
    // stamped into clay. The rim comes from the mask's soft edge, so this is
    // also the check that the softness survives into the field.
    assert(mask.rim > 0.02, `highest point across the carve is only ${mask.rim.toFixed(4)}`);
    return `rim reaches +${mask.rim.toFixed(3)}`;
  });

  check("the carve is anchored in the world, not in the patch", () => {
    // The clipmap travels with the camera. A mask placed in uv would slide
    // across the beach as you scrolled and the title would swim.
    const drift = Math.abs(mask.afterShift - mask.beforeShift);
    assert(drift < Math.abs(mask.beforeShift) * 0.2,
      `moving the patch changed the carve at a fixed world point from ${mask.beforeShift.toFixed(3)} to ${mask.afterShift.toFixed(3)}`);
    return `${mask.beforeShift.toFixed(3)} → ${mask.afterShift.toFixed(3)} across a 0.4 patch move`;
  });

  check("a long fill delay holds its own mark, not the whole field", () => {
    // Regression. With the delay as a single uniform, a patient brush anywhere
    // on the beach stopped erosion everywhere for the steps it was active.
    const soloLeft = Math.abs(mask.alone.after) / Math.abs(mask.alone.pressed);
    const withLeft = Math.abs(mask.alongside.after) / Math.abs(mask.alongside.pressed);
    assert(withLeft < soloLeft + 0.1,
      `a distant 20s-delay brush left ${(withLeft * 100).toFixed(0)}% of an ordinary mark against ${(soloLeft * 100).toFixed(0)}% alone`);
    return `${(soloLeft * 100).toFixed(0)}% alone vs ${(withLeft * 100).toFixed(0)}% alongside a 20s-delay brush`;
  });

  console.log(`\n${failures ? "FAIL" : "PASS"} — ${ran - failures}/${ran} checks\n`);
  process.exit(failures ? 1 : 0);
} finally {
  // Both in the finally: a throw inside the GPU section would otherwise leave
  // a headless Chrome and a dev server alive and the CI job would sit there
  // until its timeout rather than failing.
  await browser?.close();
  await vite.close();
}
