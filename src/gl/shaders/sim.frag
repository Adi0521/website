#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outC;
uniform sampler2D uPrev, uStatic;
uniform vec2  uTexel, uA, uB;
// clipmap: the interactive patch travels with the camera. uOrigin is its world
// centre; uShift is how far the patch moved since the last step, in uv, so this
// texel can find whatever sand used to be at its world position.
uniform vec2  uOrigin, uShift;
uniform float uAspect, uPressure, uRadius, uDepth, uRim;
uniform float uDt, uDecay, uSmooth, uReset;
uniform float uSlump, uRepose, uInfill, uDelay;
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

  // brush footprint first: freshly pressed sand must not slump the same frame
  vec2 p = vUv*vec2(uAspect,1.0);
  vec2 a = uA*vec2(uAspect,1.0);
  vec2 b = uB*vec2(uAspect,1.0);
  float d = sdSeg(p,a,b)/max(uRadius,1e-4);
  float core = exp(-d*d*2.2);
  float ring = exp(-pow((d-1.18)*3.0, 2.0));
  float stampAmt = uPressure*(core + ring);

  // age resets under the brush, so the mark holds briefly before it fills
  age = min((age + uDt)*(1.0 - clamp(stampAmt*3.0, 0.0, 1.0)), 30.0);
  float ramp = uDelay < 0.02 ? 1.0 : smoothstep(uDelay*0.55, uDelay*1.45, age);

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
  vec2 wxz  = uOrigin + vec2((vUv.x-0.5)*2.0*uDX, (vUv.y-0.5)*2.0*uDZ);
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

  outC = vec4(clamp(h,-1.0,1.0), clamp(dst,0.0,1.0), clamp(wet,0.0,1.0), age);
}