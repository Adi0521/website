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
 * Expected shape of the fill-in curve at defaults (see PRD §6.2):
 *     pressed  -0.60   +1s  -0.57   +3s  -0.19   +8s  -0.01
 * The rim dropping on the same schedule as the hole is the diagnostic that
 * slumping is working rather than decay.
 */
console.log("TODO: port from the prototype harness once src/sand/field.ts lands.");
console.log("Reference implementation: prototype/sand-phase1.html");
