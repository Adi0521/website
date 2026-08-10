#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outC;
uniform float uAspect, uRipAmp, uRipScale, uRipAngle, uDuneAmp;
#include "common/noise.glsl";
void main(){
  vec2 p = vUv*vec2(uAspect,1.0);
  float ca = cos(uRipAngle), sa = sin(uRipAngle);
  vec2 q = vec2(p.x*ca - p.y*sa, p.x*sa + p.y*ca);

  float w1 = fbm(q*3.0)*2.0 - 1.0;
  float w2 = fbm(q*7.4 + 5.7)*2.0 - 1.0;
  float r  = sin(q.y*uRipScale + w1*3.2 + w2*0.9);
  r = pow(r*0.5+0.5, 1.7);
  float clumping = 0.5 + 0.5*fbm(q*1.15 + 3.3);
  float rip = (r - 0.42)*clumping*uRipAmp;

  float dune = (fbm(p*0.85 + 7.7) - 0.5)*uDuneAmp;
  float grain = vnoise(p*520.0);
  outC = vec4(rip + dune, grain, 0.0, 1.0);
}