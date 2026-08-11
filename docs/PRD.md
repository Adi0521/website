# Beach — Personal Site PRD

**Status:** Draft v0.4
**Owner:** Arnav
**Last updated:** August 11, 2026

**v0.4.** Engine ported out of the prototype into `src/gl` and `src/sand`. Both Phase 2 gaps closed — scroll-driven camera and camera-following clipmap (§13). Measured numbers refreshed against the shipped engine: the §6.2 fill-in curve, the §7.3 wave sequence, and the §11 tier table, whose Cinematic DPR drops to 1.5. Tier auto-detection, a render cap and an unfocused throttle are built (§11). Swash reach now varies along the beach (§7.3). Verification gate restated against the tools that actually exist (§14).

**v0.3.1.** Frame time measured: ~120fps vsync-capped on dev hardware even at maximum settings, so under 8.3ms worst case. The §6.3 props fork is resolved in favour of `gl_FragDepth`, and Cinematic becomes the desktop default. Performance drops from top risk to low-end tier calibration.

**Changes from v0.2.** Rewritten against a working Phase 1 prototype. The renderer is raymarched, not rasterized — this reverses v0.2's central technical assumption and opens a real fork about props (§6.3). Erosion is now a mass-conserving slump model rather than decay (§6.2). Water is built and specified (§7). Performance is now the top risk because it has never been measured on real hardware (§11). Phases restated against actual status (§13).

---

## 1. Premise

A personal site set on a beach at low sun. Sand is a live, deformable surface that remembers what touched it. Headings press into it. Each project performs on it in a way particular to that project.

**Engineering thesis: everything on this site is something writing into sand.** Text stamps a depression. A car carves tracks. Aliens erupt and throw ejecta. A market widget darkens sand with a soft shadow. Waves wash in and erase. Different-looking effects, one system underneath.

**Structural thesis: one scene, two intensities.** The About page is the beach at full fidelity. The focus pages are that same scene with the focus pulled — blurred, desaturated, frozen — so text can carry the weight. Not two designs. One design at two settings.

---

## 2. Goals

| # | Goal | How we know it worked |
|---|------|----------------------|
| G1 | Sand reads as physically real and responsive | A first-time visitor tries to interact with it unprompted |
| G2 | Each project is memorable through its sand behaviour | Someone can describe a project's effect a week later |
| G3 | The work is findable in under 10 seconds | A visitor who wants the resume gets it without scrolling |
| G4 | Focus pages are genuinely readable | Long-form text is as comfortable as a plain article page |
| G5 | 60fps on a 3-year-old laptop, degrading cleanly | ~121fps on dev hardware (vsync-capped). Low-end floor still unmeasured |
| G6 | Fully usable with motion and WebGL both off | Content complete and navigable in fallback |
| G7 | Adding project #6 takes under a day | One agent implementation, no engine changes |

## 3. Non-goals

- **Granular physics.** No discrete element method. Sand is a heightfield with plausible transport rules.
- **Accurate shadows.** Heightfield shadow marching for sand-on-sand; blob and contact shadows for props.
- **Autonomous camera rotation.** The prototype's idle orbit drift is scaffolding and does not ship. Scroll owns the camera; an autonomous orbit fights it, destabilises text placement over a live scene, and makes the focus pull impossible to aim. Pointer parallax of a degree or two that eases back to rest is fine.
- **A second visual system for focus pages.** Same scene, reduced.
- **A game.** No free camera, no controllable character.
- **Sand persistence across sessions.** State lives in a texture and dies on reload.
- **Effect parity on mobile.**
- **A CMS.** Projects are code.
- **Audio on load.**
- **WebGPU.** WebGL2 for reach.

---

## 4. Information architecture

```
  ┌──────────────────────────────────────────────────┐
  │  ARNAV        About   Work   Resume   Contact    │   ← persistent nav
  ├──────────────────────────────────────────────────┤
  │   /  ABOUT — full beach, everything live         │
  │   ├── hero            title carved in sand       │
  │   ├── timeline        footprint trail            │
  │   ├── work slideshow  one stage, agents swap ────┼──┐
  │   └── resume plate    rests on sand ─────────────┼┐ │
  └──────────────────────────────────────────────────┘│ │
        FOCUS PAGES — same scene, blurred + frozen    │ │
        /resume  ◄────────────────────────────────────┘ │
        /work/:slug  ◄──────────────────────────────────┘
        /contact
```

| Route | Mode | Contains |
|-------|------|----------|
| `/` | Full | Hero, timeline, work slideshow, embedded resume |
| `/work` | Focus | Project index, plain list |
| `/work/:slug` | Focus | One project: writeup, images, links |
| `/resume` | Focus | Full resume as HTML, PDF download |
| `/contact` | Focus | Short |

**Two paths into every focus page:** the nav bar, and the corresponding section on About. Both run the same focus-pull; the nav version moves the camera to the right part of the scene first. Real routes, real URLs, real back button. Deep links land in focus mode without playing the transition.

### Nav bar

Quiet. Uppercase utility mono, letterspaced, hairline rule beneath. Translucent over the sky on About; solid plate on focus pages. Current section marked with a filled dot. Sticky. Collapses to a menu button under 640px.

---

## 5. Design direction

### The art direction is derived, not decorative

Sand only reads as sand when raked by low light — displacement is invisible under a high sun. The prototype confirmed this bluntly: raising the sun elevation slider flattens the surface into plastic, and no amount of texture work compensates. So the site sits in the last hour before sunset, and that comes from the technical requirement.

It also solves the aesthetic risk. A beach brief pulls hard toward warm cream with a terracotta accent, which is the house style of every AI-generated portfolio. The physics gives us the way out: **sand shadows are blue.** Sunlit sand is warm; shadowed sand is lit by the sky dome and shifts cool.

### Palette

| Token | Hex | Role |
|-------|-----|------|
| `--sand-lit` | `#EDDCB8` | Dry sand in direct sun |
| `--sand-shadow` | `#5C7A99` | Sky-fill shadow — the signature colour |
| `--sea-shallow` | `#3298B0` | Turquoise where sand shows through |
| `--sea-deep` | `#134F92` | Deep blue offshore |
| `--sun-rim` | `#FFE9B0` | Rim light on crests and props |
| `--foam` | `#F7FBF9` | Wave foam, near-white |
| `--sea` | `#3E8F84` | UI accent only |

Global saturation sits at ~1.36, applied after tone mapping in display space so it stays luminance-preserving.

### Focus mode

Same palette compressed. Scene desaturates toward `--sand-shadow`, blurs, drops to ~30% luminance. Text plates in `--foam`, body copy in `--sand-shadow`, `--sea` for links so they stay consistent across modes. **Once in focus mode it must feel like a well-set article:** 65–75 character measure, real vertical rhythm, nothing competing with the text.

### Typography

- **Display: a wide/expanded grotesque.** Wide type is horizon-shaped. *Candidate: Archivo Expanded.*
- **Body: a neutral grotesque.** *Candidate: Inter.*
- **Utility: monospace.** *Candidate: JetBrains Mono.*

**Still unlocked. Blocks Phase 3.**

---

## 6. Core system: the Sand Field

### 6.1 Representation

A persistent RGBA half-float texture, ping-ponged between two framebuffers. All four channels are now in use.

| Channel | Meaning |
|---------|---------|
| **R** | Height, signed. Negative carved, positive berm |
| **G** | Disturbance. Freshly moved sand is rougher and darker |
| **B** | Wetness. Written by wave reach, dries over time |
| **A** | Settle age. Resets under the brush, gates the fill-in delay |

The G channel is what sells it: a footprint is visible partly because the sand *inside* it is rougher than the wind-smoothed surface around it. Height alone looks like a dent in plastic.

### 6.2 Transport model

v0.2 specified decay toward rest. That was wrong in kind, not degree — `h *= exp(-k·dt)` shrinks every texel independently, so the hole gets shallower and the rim gets shorter but no sand ever travels between them. Marks evaporated instead of filling.

What is built instead, in order per frame:

1. **Wind smoothing** — a small blur, so fine detail softens before gross shape.
2. **Slumping** — any neighbour pair whose slope exceeds the angle of repose trades material. The exchange function is antisymmetric, so whatever one texel loses the other gains exactly. Sand is *moved*, never deleted, and a footprint fills from its own rim. Eight-neighbour flow, normalised by total weight, coefficient clamped at 0.22 below the diffusion stability limit — without that clamp high slump rates oscillate and the field rings.
3. **Wind infill** — loose grain settles into hollows and scours mounds at ~45% the rate. Not conservative, because wind imports sand from outside the frame.
4. **Wave action** — water in reach flattens sand and writes wetness (§7).
5. **Settle** — a very slow global drift, keeps long sessions bounded.
6. **Stamp** — target-based, so holding still converges to a depth rather than digging a canyon.

Measured fill-in at shipped defaults (`depth` 0.34), 1280×800 field, from `npm run test:sim`:

```
pressed    -0.339  (rim +0.138)
+1s        -0.331  (rim +0.136)   ← the delay holding
+3s        -0.118  (rim +0.083)
+8s        -0.007  (rim +0.020)
```

The rim dropping on the same schedule as the hole is the diagnostic that slumping is working rather than decay.

Two caveats on comparing these numbers to anything. **The stamp converges to `-depth`**, so the absolute floor is whatever `depth` is set to — v0.3's table showed −0.600, which is the same curve normalised but taken at `depth` ≈ 0.6, not at the shipped default. **And the curve is resolution-dependent**: slumping compares neighbouring texels, so a finer field has smaller differences between them, fewer pairs past the angle of repose, and slower fill. The harness pins the viewport for this reason.

**Fill delay** exists because freshly pressed sand is compacted; the delay is that packing giving way. It resets under the brush via channel A. **Timeline footprints will want a much longer delay than a general mark**, which argues for making delay per-brush rather than global in Phase 4.

### 6.3 Rendering — and an open fork

**v0.2 specified a rasterized displaced mesh. The prototype is a raymarched heightfield and it looks materially better.** One fullscreen triangle, zero geometry; depth comes entirely from the march.

What the march has to get right, all learned the hard way:

- **Slope-aware stepping.** Step by `d / max(-rd.y, ε)` — how far the ray must travel to lose height `d` — not by `d` itself. A grazing ray covers far more ground per unit of descent, and stepping by the vertical gap burns the entire budget before reaching the ground.
- **Bisection on crossing.** Eight iterations. Without it the hit snaps to the marching step and the sand renders as flat slabs stitched together.
- **No sky holes.** Rays that exhaust their budget while still descending shade the far point rather than falling through to sky, which otherwise produces a hard band where the beach stops resolving.
- **Distance LOD.** Normal sampling widens with distance; one texel projects to well under a pixel near the horizon, and unwidened it is pure aliasing noise. Grain sparkle and micro-relief fade with distance for the same reason.
- **Fragment normals from central differences**, giving detail far beyond the texel grid.
- **Heightfield shadow marching** toward the sun. With a grazing sun this is what makes a 2mm depression legible at all.

**The fork.** v0.2 chose rasterization specifically so props — car, aliens, market widgets — could composite against sand with an ordinary depth buffer. Raymarching removes that for free. Two options:

| Option | How | Cost |
|--------|-----|------|
| **A. Write `gl_FragDepth`** from `tHit`, rasterize props normally | Small change; `tHit` already exists | Disables early-Z on most GPUs — matters given §11 |
| **B. Raymarch props as SDFs** too | One pass, soft shadows onto sand for free | A recognisable car is hard as an SDF |

**Resolved: option A.** Measured headroom on dev hardware is large enough that losing early-Z is affordable, and "a recognisable car" is a hard requirement that SDF modelling would turn into a time sink. Props rasterize against a depth buffer written from `tHit`.

Two consequences to carry into Phase 5. Depth must be written in *all* march exit paths, including the budget-exhaustion fallback, or props will punch through the far beach. And early-Z loss is a multiplier on fill rate, so it is the first thing to re-measure if the Standard tier misses budget.

### 6.4 The Sand Agent interface

```
SandAgent {
  id, bounds
  enter(t) / exit(t)         // slideshow drives these
  update(dt, viewport)
  stamps(): Brush[]
  props():  Object3D[]
  shadow(): ShadowDesc[]
}
```

**Brush set is closed.** New projects pick from these; a sixth requires justification.

| Type | Behaviour | Used by |
|------|-----------|---------|
| `press` | Depression plus displaced rim | Text, footprints, cat, resume plate |
| `track` | Swept segment with tread | Car |
| `erupt` | Crater with ejecta ring | Aliens |
| `drag` | Furrow with leading pile-up | Reserved |
| `none` | Shadow only, no height | Hovering market props |

The rim on `press` matters: pressed sand pushes *up* at the edge. Without it, footprints look stamped into clay.

---

## 7. Water

Built and working. The waterline is the beach's own reset — no UI, no explanation.

### 7.1 Shared model

**The wave function is a single shared GLSL chunk included by both the simulation and the renderer.** With separate copies, the waterline you *see* and the waterline that *wets the sand* drift apart, and you get foam that erases nothing over dark patches with no water on them. They are now incapable of disagreeing.

The beach is a ramp — zero at the shoreline, rising toward the viewer, dropping away seaward. A small change in water level therefore sweeps the waterline a long way.

### 7.2 Swell

Three offset sines travelling shoreward plus lateral variation so crests are not dead straight. **Amplitude tapers to zero as still-water depth approaches zero.** This is not cosmetic: without the shoaling taper the swell keeps oscillating over dry sand and spawns standing bands of water up the beach that blink in and out. Phase is accumulated on the CPU so wave speed can drift between sets without the whole train jumping.

### 7.3 Wave scheduler

Waves are **discrete events, not a cycle.** Each draws its own arrival time, reach, build character and drain from a hash of its index — varied and unpredictable, but deterministic and stateless. Overlapping swashes combine by `max`, which is what a waterline does.

Build time and reach are **deliberately correlated**: a wave with a long rise also gets a gentler easing curve, so slow waves swell in while quick ones snap up. That coupling is what makes the sequence read as intentional rather than randomised.

Generated sequence at defaults:

```
 wave   arrives   gap    reach    build   drain
   0      2.8s     -     0.59m    2.9s    18.0s
   1     12.1s    9.4s   0.59m    7.0s    11.1s
   2     23.0s   10.9s   0.91m    7.3s    18.7s
   3     36.9s   13.9s   0.52m    7.6s    10.9s
   4     51.9s   15.0s   0.90m    5.5s     8.3s
   5     63.8s   11.9s   0.39m    4.9s    12.9s
```

Build times are 1.4× the raw draw — the `UPRUSH` constant in the scheduler. At 1.0 an isolated wave ran up in about 2.2s, which read as snapping rather than swelling; at 1.4 it is about 3.4s. The cost is more overlap: a longer build means more waves are still draining when the next arrives, so fewer of them are cleanly separated.

**Critical: the wave scheduler's swash level varies only with time, not position, so it is computed once per frame on the CPU and passed as two uniforms.** Evaluating that randomisation per march step would cost thousands of hashes per pixel for a value constant across the frame. It also guarantees sim and renderer receive identical state.

**But a scalar swash arrives as a dead-straight line** across the whole beach, every wave identical along its length. The reach is therefore modulated laterally by `swashLateral` — a smooth two-sine function of world X, not a hash, so it costs one extra `sin` per march step and the scheduler stays on the CPU. It lives in the shared wave chunk, so the sand gets wet exactly where the water looks like it is. Measured effect on how far the waterline wanders, in world units: 0.081 at `swashLateral` 0 (the baked ripples alone), 0.123 at 0.45, 0.193 at the shipped 0.7. Below about 0.25 the effect is lost in the ripple noise floor; at 1.0 the modulation reaches zero and beyond it inverts the swash.

One consequence for layout: at 0.7 the reach varies up to 1.7×, so the water gets to z≈1.76 rather than z≈1.0. The swash zone is that much wider than the nominal figure suggests.

### 7.4 Draining film

A level comparison alone has no memory, so when the level drops the sheet stops existing everywhere at once. A stranded film persists above the retreating body on a much slower decay curve. Too thin to march as geometry, so it is shaded as a surface overlay on sand: glossy, faintly mirroring the sky, with foam flecks that strand and fade.

The film keeps sand wet in the simulation, so the dark band extends to the film's reach — while **only the body of water scrubs marks away.** Uprush occupies ~14% of a wave, backwash the rest, roughly the real ratio.

Coverage at a point 0.6m up the beach: 38% of each cycle from the body alone, 67% including film.

### 7.5 Wet sand

Wet sand is much darker because water fills the gaps between grains and stops them scattering — that is the actual reason a receding wave leaves a dark band. Plus a tighter specular sheen, suppressed grain sparkle, and reduced micro-relief.

### 7.6 Consequence for layout

The swash zone is a place where **nothing persists.** That is the compositional argument for placing stations further up the beach, and it comes free.

---

## 8. The About page

Full fidelity. The only page where the simulation runs.

**8.1 Hero.** Title carved in sand. Presses in on load, holds, erodes. Scrolling away accelerates decay; scrolling back re-presses. **Carved text is display type only** — body copy is real DOM text on a legible plate. Sand-carved paragraphs would be unreadable and an accessibility failure.

**8.2 Timeline — the footprint trail.** Milestones running toward the horizon, recent ones near and crisp, older ones receding and half-eroded. Uses `press`, already built. Erosion doing double duty as a time metaphor only works because the sand is real. Hover or scrub presses a footprint deeper and surfaces its label. Keyboard-navigable as a list.

**8.3 Work slideshow.** **One stage, agents swap.** Advancing calls `exit()` on the current agent and `enter()` on the next; the outgoing agent's marks erode naturally while the incoming one starts writing, which gives a transition for free and guarantees only one agent is ever active.

| Project | Agent behaviour | Brush |
|---------|-----------------|-------|
| **Car** | Drives a procedural path over dunes, leaving tracks that persist and erode. Deeper on turns, spray on hard corners. | `track` |
| **Protein prediction** | Creatures erupt at staggered intervals with ejecta rings. Between eruptions, subtle heaving below. Folded chains surface briefly. | `erupt` |
| **Kalshi / HFT** | Tickers and a market panel hover, casting soft shadows that track their bob. Price line runs continuously. A cat sits nearby, pressing in, ears tracking the line. | `none` + `press` |
| **Project 4 / 5** | TBD | TBD |

Each slide carries a short DOM caption linking to `/work/:slug`. The sand effect is atmosphere; the caption is information.

The cat is load-bearing. The market station is otherwise hovering props and a price line, which is every fintech landing page.

**8.4 Resume plate.** Sits on the sand as a physical sheet — pressed slightly in, contact shadow, corner lifting in the wind. Reuses `press`. Two actions: **Read in full** (→ `/resume`) and **Download PDF** (plain anchor, works with JS off).

---

## 9. Focus pages

Same scene, focus pulled. Single centred column on a `--foam` plate, 65–75 character measure, real vertical rhythm, nav solid, no ambient motion.

- **`/work/:slug`** — title, dates, stack, writeup, images, repo and demo links, prev/next.
- **`/work`** — plain list for scanning. No sand effects.
- **`/resume`** — full resume as real HTML plus PDF download. **Not an iframed PDF** — unreadable on mobile, invisible to search.
- **`/contact`** — short.

Focus mode turns off: sand simulation, agent updates, wave scheduler, camera, post chain, and the RAF loop itself.

---

## 10. The focus pull

**Entering:** camera pushes toward the target, depth of field ramps, saturation and luminance drop, text plate rises, nav fills in. ~600ms, eased, interruptible.

**Then the scene freezes.** Render the blurred scene once to a texture, composite as static background, **stop the render loop entirely.** Focus pages cost approximately zero GPU after the first frame. Re-render only on resize.

**Leaving:** restart the loop, reverse. The sand field still holds whatever state it had — marks left before navigating away are still there, further eroded. That continuity is the payoff for one persistent context and something a page reload could never give.

**Deep links** skip the animation entirely.

---

## 11. Performance

**Measured: ~120fps on dev hardware at *maximum* settings** — 150 march steps, full window, continuous churn — vsync-capped throughout. Frame time is therefore under 8.3ms even at worst case, and utilisation at default settings is well under half.

Dev hardware is not the constraint at any quality level. Cinematic can be the desktop default rather than an opt-in, and there is room for the props pass, bloom, and a higher-resolution sand field once the clipmap lands. Exact GPU time is unmeasured and not worth chasing at this margin; `EXT_disjoint_timer_query_webgl2` is there if it ever matters.

Per-pixel cost as built: up to 96 march steps × 2 texture fetches, 8 bisection samples on hit, an 18-step shadow march, 4 AO taps, plus normals.

**Dev hardware is not the target.** G3 aims at a three-year-old laptop on integrated graphics, plausibly 4–6× slower, which would put it at 30–40fps on the High tier. That is the case the tier system exists for, and it remains unmeasured.

**One open measurement task: the low-end floor.** Anything with integrated graphics. Calibrates the Standard and Fallback tiers, which are currently guesswork. Not blocking — tiers can be tuned late.

### Quality tiers (provisional)

| Tier | Sand field | March steps | DPR cap | Post chain | |
|------|-----------|-------------|---------|-----------|--|
| Cinematic | 2048² | 128 | 1.5 | Full | ← desktop default |
| High | 1500² | 96 | 1.5 | Bloom + grain | |
| Standard | 768² | 48 | 1.0 | Grain only | |
| Fallback | — | — | — | Static, no WebGL | |

### Required behaviours

Built already: `IntersectionObserver` + `visibilitychange` pause, context-loss handling, shader-compile error trap with a downgrade path, `prefers-reduced-motion`, tier auto-detection.

**Tier auto-detection**, as built: sustained sub-45fps while focused for 4s drops a tier, moving field size, march steps and DPR together. Reallocating the field discards the sand, which is acceptable at most twice a session on a machine already dropping frames. Two things it sits alongside — a **60fps render cap**, because an unpaced loop on a 120Hz panel spends twice the GPU on a background scene, and a **12fps throttle when the window is visible but unfocused**, which `visibilitychange` does not cover and which is where a second window or an editor in front costs the most.

Cinematic's DPR cap is 1.5, not the 2.0 this table carried through v0.3. The ~120fps above was measured on the prototype, which capped DPR at 1.4 — 2.0 is four times the fragments of 1.0 in the most expensive shader here and was never measured at all.

Still to build: one-agent-at-a-time enforcement, freeze-and-stop in focus mode.

---

## 12. Accessibility

- **All content in the DOM.** Every writeup, timeline entry and resume line is real text, readable with the canvas removed.
- **`prefers-reduced-motion`** renders About in focus-mode styling: static sand, no waves, no camera motion, slideshow becomes a list. Nearly free because focus mode already exists.
- **No-WebGL fallback** serves a static image and the same DOM.
- **Keyboard navigable** end to end, visible focus throughout.
- **Focus management on route change** — move focus to the page heading, announce via live region.
- **Contrast** checked against the live scene, not a flat swatch.

---

## 13. Build phases

**Phase 1 — Prove the primitive. ✅ Done.** Sand field, ping-pong sim, slumping and infill, `press` brush with rim, wave system. The gate is passed: pressing into the sand feels right.

**Phase 2 — The beach. ◐ Both gaps closed, exit condition unjudged.** Done: raymarched terrain, low sun, ripples, sky, sea, waves, wetness, and the engine ported out of the prototype into `src/gl` and `src/sand`.
- **Scroll-driven camera.** Built. Scrolling down retreats up the dry beach, z 2.0 → 7.0, with ~10° of azimuth swept across the travel. `endZ` is bounded by the ramp rather than by taste: `beachY` clamps at 0.9, so above ~7.7 the eye is over flat ground and the near foreground becomes a shelf.
- **Camera-following clipmap.** Built. The patch follows the camera's look-at point, snapped to whole texels — unsnapped, bilinear resampling blurs every mark a little more each frame until a footprint dissolves from the camera merely moving past it. The baked layer is locked to the world and wraps, so ripples stay put on the ground while the interactive layer travels.
- **Still open: the exit condition itself** — whether scrolling an empty beach is pleasant on its own. Not answerable in headless, for the appearance reason in §14.

**Phase 3 — Two modes.** Routing, nav, focus pull, freeze-and-stop, focus pages with placeholder text. **Deliberately before content** — retrofitting a mode system after five projects exist is far more expensive than building it into an empty shell.

**Phase 4 — Text in sand.** Text-to-mask pipeline, hero carve and erode, footprint timeline. Per-brush fill delay (§6.2).

**Phase 5 — Agent system.** Formalise the interface, slideshow enter/exit, blob shadows, car as reference implementation. **Requires the §6.3 fork resolved.**

**Phase 6 — Remaining projects.**

**Phase 7 — Content and hardening.**

---

## 14. Verification

Shaders are validated before shipping, not eyeballed. The gate:

1. **`glslangValidator`** compiles all four shaders as ESSL 3.00. This catches reserved-word collisions — `patch`, `sample`, `half`, `input`, `output`, `buffer`, `shared`, `filter`, `this` are all reserved and all easy to reach for.
2. **Reserved-word scan** over comment-stripped source, as defence in depth.
3. **Typecheck and build** — `tsc --noEmit` then `vite build`. Replaces v0.3's `node --check` on extracted inline JavaScript, which was a prototype-era step: the engine is TypeScript now.
4. **Scene smoke test** (`npm run smoke`) — headless Chrome loads the page and asserts no runtime errors, no failed requests, no GL error, and that a frame with real tonal range came out. Then, on the field itself: a press carves a depression *with a rim*, the render cap actually limits the loop, scrolling dollies the camera without burying it in the ramp, and a mark stays put in the world while the patch travels under it.
5. **Simulation unit tests** (`npm run test:sim`) — the shipped field driven at fixed timesteps, reading heights back through a float probe. This is how the fill-in curve in §6.2 and the catch-up numbers in §9/§10 were measured. Also covers the pure-CPU catch-up planner.
6. **Context persistence** (`npm run check:context`) — two throwaway routes proving one WebGL context and its sand survive navigation, with a full page load as the control. Guards the assumption §10 rests on.

Three lessons worth keeping. **Brace-balance and uniform-name checks are not verification** — the `patch` collision passed both and failed in the browser.

**Software rendering cannot test WALL-CLOCK behaviour**, which is the sharper form of the v0.3 lesson: the fill-in test read as a flat line because only ~1s of simulated time elapsed in 25 real seconds. Stepping the field a *counted* number of times is immune — the unit harness runs 500+ steps under SwiftShader and reproduces the §6.2 curve exactly. It is measuring against the clock that breaks, not the software renderer as such.

**Software rendering cannot test appearance either.** Under SwiftShader the value noise collapses to a constant, so the baked ripples vanish — in the prototype exactly as in the engine. Nothing about the look can be judged from a headless screenshot; that check can only answer "did a frame come out".

---

## 15. Open questions

1. **Display typeface.** Blocks Phase 3. Now the only hard blocker on the critical path.
2. **Low-end frame time.** (§11) Calibrates the Standard tier. Not blocking — the tiers can be tuned late.
4. **Nav items** — About / Work / Resume / Contact, or does Work fold into About?
5. **Projects 4 and 5.** May test whether the closed brush set holds.
6. **Timeline content** — how many milestones, and what kind? Affects footprint spacing.
7. **Slideshow auto-advance or manual?** Auto shows more work; manual respects attention.
8. **Car path seeded per visit or fixed?**
9. **Mobile focus-pull** — worth it on a phone, or navigate conventionally?

*Resolved since v0.3: props fork → `gl_FragDepth` (§6.3); dev-hardware frame time (§11). Resolved since v0.2: erosion feel (§6.2 — it is a delay plus slump rate, not a single decay constant); wave behaviour (§7).*

---

## 16. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Low-end hardware misses budget | Medium | Dev hardware measures ~121fps capped. Integrated-graphics floor still unmeasured; tier table is calibrated on guesswork until then |
| Focus pages feel like a downgrade rather than a mode | High | They must be genuinely well-set typography, not the beach with a blur. Budget real design time in Phase 3 |
| Beautiful but nobody finds the work | Medium | Nav bar mitigates. DOM panels are primary |
| Effects read as gimmick | Medium | One effect per slide. Restraint elsewhere |
| Scope creep via new brush types | Medium | Brush set is closed |
| Bounded sand patch ships by accident | Medium | Phase 2 clipmap. Currently visible as an edge where interaction stops |
| Transition intrudes on repeat visits | Low | Under 600ms, interruptible, skipped on deep link |

This is a portfolio. If a visitor remembers the beach and not the work, it failed regardless of how good the sand looks.
