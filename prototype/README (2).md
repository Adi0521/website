# Beach

Personal site. A beach at low sun where sand is a live, deformable surface that
remembers what touched it.

Full spec in [`docs/PRD.md`](docs/PRD.md).

## Quickstart

```sh
npm install
sudo apt-get install glslang-tools     # or: brew install glslang
npm run validate                       # shader gate
npm run dev
```

`prototype/sand-phase1.html` is the working Phase 1 reference. Open it directly
in a browser — no build step. Diff against it when porting.

## The two invariants

**One WebGL context for the whole session.** The focus pull between the beach
and the text pages, and the sand keeping its state when you navigate back, both
depend on the canvas surviving route changes. Verify this before choosing a
router: a full page load tears down the context and the whole design collapses
to a slideshow with a loading flash.

**One shared wave chunk.** `src/gl/shaders/common/wave.glsl` is included by both
`sim.frag` and `render.frag`. If they ever hold separate copies, the waterline
you *see* and the waterline that *wets the sand* drift apart, and you get foam
that erases nothing sitting over dark sand with no water on it.

## Verification

`npm run validate` compiles every shader with `glslangValidator` after resolving
`#include`, plus scans for GLSL ES 3.00 reserved words. Wired into CI and
available as a pre-commit hook (`git config core.hooksPath .githooks`).

Two lessons paid for in advance:

- **Brace-balance and uniform-name checks are not verification.** A `patch`
  identifier passed both and failed in the browser. `patch`, `sample`, `half`,
  `input`, `output`, `buffer`, `shared`, `filter` and `this` are all reserved.
- **Software rendering cannot test temporal behaviour.** A fill-in test looked
  like a flat line because ~1s of simulated time elapsed in 25 real seconds.
  Time-dependent behaviour goes through `tools/sim-unit.mjs`, not screenshots.

## Layout

```
src/gl/shaders/    bake · sim · render, with common/{noise,wave}.glsl
src/gl/quality.ts  tier table — scales field, steps and DPR together
src/waves/         CPU wave scheduler (ported, working)
src/agents/        SandAgent contract — the brush set is CLOSED
src/styles/        palette and type stack
tools/             shader gate, sim harness
prototype/         Phase 1 reference, runs standalone
```

## Next

1. Port the engine from `prototype/` into `src/gl` and `src/sand`.
2. **Scroll-driven camera** — never built, and Phase 2's exit condition is that
   scrolling an empty beach is pleasant on its own.
3. **Camera-following clipmap** — the sand field is currently a bounded patch
   and interaction stops at its edge. Dollying makes this worse.
4. **Phase 3 (routing, nav, focus pull) before any project content.** Retrofitting
   a two-mode system after five project pages exist is the expensive path.

## Hero name

`prototype/hero-name.html` — the name as a sand structure standing on the beach.
Open directly, no build step.

**Sculpted mode (default).** The letters are real geometry, not a texture: the
text mask is extruded into a slab and marched like any other solid, so they have
thickness, side walls, and take exactly the same light as the ground — warm sun,
blue sky-fill shadow, grain, sparkle. That is why they belong to the scene
instead of sitting on top of it, and why a bark-and-rope version would be a much
bigger job: wood needs a material the beach does not already provide.

**Flat mode.** Real DOM text pinned onto a plane in the scene by a `matrix3d`
transform derived from the renderer's own camera, with only its shadow in the
shader. Crisper and selectable, but flat.

Either way the `<h1>` stays in the document and the accessibility tree — in
sculpted mode it is transparent rather than removed, because the mask is
measured from its layout.

The position, lean and size are computed **once per frame and read by both** the
DOM transform and the shader, the same rule as `common/wave.glsl`. Two copies of
"where is the text" would drift and the shadow would slide out from under the
letters.

**Lighting is a trade-off, not a default.** Front-lit letters hide their own
shadow; back-lit letters throw a long raking shadow but go dark. Sun azimuth
sits between the two. `Sun azimuth` and `Sun elevation` are the two sliders that
move it.
