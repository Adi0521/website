#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outC;
uniform sampler2D uPrev, uStatic;
// text-to-mask (PRD §8.1). a rasterized word is not a swept segment, so it
// arrives as its own footprint source rather than as a sixth brush kind — the
// set in §6.4 stays closed. placed in WORLD space, because the patch travels
// and a rect held in uv would let the title swim across the beach.
uniform sampler2D uMask;
uniform vec4  uMaskRect;   // world centre xz, world half-extent xz
uniform float uMaskPress, uMaskDepth, uMaskRim, uMaskDelay;
uniform vec2  uTexel, uA, uB;
// clipmap: the interactive patch travels with the camera. uOrigin is its world
// centre; uShift is how far the patch moved since the last step, in uv, so this
// texel can find whatever sand used to be at its world position.
uniform vec2  uOrigin, uShift;
uniform float uAspect, uPressure, uRadius, uDepth, uRim;
uniform float uDt, uDecay, uSmooth, uReset;
uniform float uSlump, uRepose, uInfill, uDelay, uBrushDelay;
uniform float uDX, uDZ, uHtw, uWaveErase, uDryRate;
#include "common/wave.glsl";

float sdSeg(vec2 p, vec2 a, vec2 b){
  vec2 pa = p-a, ba = b-a;
  float h = clamp(dot(pa,ba)/max(dot(ba,ba),1e-9), 0.0, 1.0);
  return length(pa - ba*h);
}
// material exchanged with one neighbour once the local slope passes repose.
// antisymmetric in its arguments, so a pair of texels always trades the same
// amount in opposite directions and no sand is created or destroyed.
float xfer(float hC, float hN, float thr){
  float dh = hC - hN;
  return -sign(dh)*max(abs(dh) - thr, 0.0);
}
// coverage of the text mask at a world position, 0 outside its rect. the rect
// test is what keeps the title local: without it CLAMP_TO_EDGE would smear the
// mask's border row along the entire beach.
float maskAt(vec2 wxz){
  if(uMaskPress <= 0.0) return 0.0;
  vec2 m = (wxz - uMaskRect.xy)/(2.0*uMaskRect.zw) + 0.5;
  if(any(lessThan(m, vec2(0.0))) || any(greaterThan(m, vec2(1.0)))) return 0.0;
  // textureLod, not texture. the rect test above returns per texel, so this
  // fetch is inside NON-UNIFORM control flow, and an implicit-LOD fetch there
  // has undefined derivatives by spec. it happens to work because the mask has
  // no mipmaps and the lod is therefore always 0 — which is exactly the kind of
  // undefined-but-fine that holds until it meets an untested driver, and §11's
  // low-end tier is still unmeasured. stating the lod costs nothing.
  return textureLod(uMask, m, 0.0).r;
}
void main(){
  // where this texel's world position sat in the previous field. the shift is
  // always a whole number of texels — the cpu snaps the origin to the texel
  // grid — so this resamples exactly and marks do not soften as the camera
  // travels. off the end of the previous patch is ground newly scrolled into
  // reach, and it starts clean.
  vec2 uv0 = vUv + uShift;
  bool fresh = any(lessThan(uv0, vec2(0.0))) || any(greaterThan(uv0, vec2(1.0)));
  if(uReset > 0.5 || fresh){ outC = vec4(0.0); return; }

  vec4 c = texture(uPrev, uv0);
  float h0 = c.r, dst = c.g, wet = c.b, age = c.a;

  // this texel's world position. hoisted above the stamp because the mask is
  // placed in world space; the wave section below reuses it.
  vec2 wxz  = uOrigin + vec2((vUv.x-0.5)*2.0*uDX, (vUv.y-0.5)*2.0*uDZ);

  // brush footprint first: freshly pressed sand must not slump the same frame
  vec2 p = vUv*vec2(uAspect,1.0);
  vec2 a = uA*vec2(uAspect,1.0);
  vec2 b = uB*vec2(uAspect,1.0);
  float d = sdSeg(p,a,b)/max(uRadius,1e-4);
  float core = exp(-d*d*2.2);
  float ring = exp(-pow((d-1.18)*3.0, 2.0));

  // the mask's own core and rim, thresholded out of ONE sample. the mask was
  // blurred when it was rasterized, so its edge gradient is already the
  // falloff a rim needs — reading two bands out of it costs no extra taps.
  // the rim band sits BELOW the core band, i.e. just outside the glyph
  // outline, because pressed sand pushes up at the edge and not inside the
  // letter (§6.4). a hard-edged mask instead carves a cliff, and slumping
  // tears it straight back down into a ridge of noise.
  float mv    = maskAt(wxz);
  float mCore = smoothstep(0.55, 0.88, mv);
  float mRing = smoothstep(0.06, 0.34, mv)*(1.0 - smoothstep(0.34, 0.62, mv));

  float stampAmt = uPressure*(core + ring) + uMaskPress*(mCore + mRing);

  // age resets under the brush, so the mark holds briefly before it fills
  age = min((age + uDt)*(1.0 - clamp(stampAmt*3.0, 0.0, 1.0)), 30.0);

  // per-brush fill delay, resolved PER TEXEL and scoped to the source's own
  // footprint.
  //
  // It was a uniform, which quietly made it global: `ramp` gates transport for
  // every texel, so the instant a long-delay brush went active — a timeline
  // footprint, say, at ten times an ordinary mark — the WHOLE field stopped
  // eroding for that step, including a stroke someone was drawing on the other
  // side of the beach. Invisible with one brush and one delay; a flicker
  // between two erosion rates the moment §6.2's per-brush delay is actually
  // used for what it is for.
  //
  // So uDelay is the field's ordinary rate and uBrushDelay is this brush's,
  // blended by how much of this texel the brush actually covers.
  float cov  = clamp(core + ring, 0.0, 1.0);
  float mcov = clamp(mCore + mRing, 0.0, 1.0);
  float delay = mix(mix(uDelay, uBrushDelay, cov), uMaskDelay, mcov);
  float ramp = delay < 0.02 ? 1.0 : smoothstep(delay*0.55, delay*1.45, age);

  float hL = texture(uPrev, uv0 - vec2(uTexel.x,0.0)).r;
  float hR = texture(uPrev, uv0 + vec2(uTexel.x,0.0)).r;
  float hU = texture(uPrev, uv0 + vec2(0.0,uTexel.y)).r;
  float hD = texture(uPrev, uv0 - vec2(0.0,uTexel.y)).r;
  float hA = texture(uPrev, uv0 + vec2( uTexel.x, uTexel.y)).r;
  float hB = texture(uPrev, uv0 + vec2(-uTexel.x, uTexel.y)).r;
  float hE = texture(uPrev, uv0 + vec2( uTexel.x,-uTexel.y)).r;
  float hF = texture(uPrev, uv0 + vec2(-uTexel.x,-uTexel.y)).r;

  float h = h0;

  // wind smoothing: fine detail softens before gross shape
  h = mix(h, (hL+hR+hU+hD)*0.25, clamp(uSmooth*uDt*ramp, 0.0, 0.9));

  // slumping — sand past the angle of repose slides downhill, so a footprint
  // fills from its own rim rather than fading uniformly in place
  float tC = uRepose, tD = uRepose*1.41421;
  float flow = xfer(h0,hL,tC) + xfer(h0,hR,tC) + xfer(h0,hU,tC) + xfer(h0,hD,tC)
             + (xfer(h0,hA,tD) + xfer(h0,hB,tD) + xfer(h0,hE,tD) + xfer(h0,hF,tD))*0.70711;
  h += (flow/6.82843)*clamp(uSlump*uDt, 0.0, 0.22)*ramp;

  // wind delivers loose grain: it settles in hollows and scours mounds slower
  h += max(-h, 0.0)*clamp(uInfill*uDt,      0.0, 0.5)*ramp;
  h -= max( h, 0.0)*clamp(uInfill*0.45*uDt, 0.0, 0.5)*ramp;

  // very slow drift to rest, keeps long sessions bounded
  h   *= exp(-uDecay*uDt);
  dst *= exp(-(uDecay*2.4 + 0.35)*uDt);

  // ---- waves. water in reach smooths the sand flat and leaves it wet, which
  // ---- is the beach's own reset: no UI, no explanation needed.
  // the baked layer is locked to the world, not to the patch: it wraps with
  // MIRRORED_REPEAT so the beach keeps going, and the ripples stay put on the
  // ground instead of sliding along with the camera.
  vec2 suv  = wxz/vec2(2.0*uDX, 2.0*uDZ) + 0.5;
  float terr = (h + texture(uStatic, suv).r)*uHtw + beachY(wxz.y);
  float cover = 1.0 - smoothstep(-0.006, 0.022, terr - waterY(wxz));
  float film  = 1.0 - smoothstep(-0.004, 0.016, terr - filmY(wxz));
  float k2 = cover*clamp(uWaveErase*uDt, 0.0, 1.0);
  h   = mix(h, 0.0, k2);
  dst = mix(dst, dst*0.12, k2);
  // the stranded film keeps the sand wet long after the body has pulled back
  wet = max(wet*exp(-uDryRate*uDt), max(cover, film*0.9));

  // stamp: target-based, so holding still converges to a depth not a canyon
  float k = clamp(uPressure*uDt*30.0, 0.0, 1.0);
  h = mix(h, min(h, -uDepth*core),      k*core);
  h = mix(h, max(h,  uDepth*uRim*ring), k*ring*(1.0-core));
  dst = max(dst, min(1.0, uPressure*(core + ring*0.7)));

  // the mask stamps in the same pass, with its own depth. sequential rather
  // than combined because each source converges to its OWN target — a word
  // carved deep and a pointer hovering lightly over it must not average into
  // one depth. both are target-based mixes, so applying them in turn is still
  // idempotent under a held press.
  float km = clamp(uMaskPress*uDt*30.0, 0.0, 1.0);
  h = mix(h, min(h, -uMaskDepth*mCore),            km*mCore);
  h = mix(h, max(h,  uMaskDepth*uMaskRim*mRing),   km*mRing*(1.0-mCore));
  dst = max(dst, min(1.0, uMaskPress*(mCore + mRing*0.7)));

  outC = vec4(clamp(h,-1.0,1.0), clamp(dst,0.0,1.0), clamp(wet,0.0,1.0), age);
}