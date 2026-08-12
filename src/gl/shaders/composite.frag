#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outC;

uniform sampler2D uScene;
uniform vec2  uTexel;
uniform float uFocus;    // 0 = the beach, 1 = fully pulled
uniform float uMaxLod;
uniform float uBlur;     // mip levels of defocus at full pull
uniform float uDim;      // luminance multiplier at full pull. 1 = untouched
uniform float uDesat;    // 0 = keep the beach's colour, 1 = fully compressed

// the signature colour: shadowed sand is lit by the sky dome and goes cool.
// focus mode compresses the whole palette toward it rather than introducing
// anything new, because §3 rules out a second visual system for focus pages.
const vec3 SAND_SHADOW = vec3(0.361, 0.478, 0.600);

void main(){
  // blur by walking down the mip chain rather than by taking a wide tap
  // pattern: a gaussian wide enough to read as defocus at this scale would be
  // dozens of samples a pixel, and this is a background behind body text.
  float lod = uFocus * min(uMaxLod, uBlur);

  // four taps around the centre, offset by roughly one texel of the mip being
  // sampled. one trilinear fetch alone shows the mip grid as soft squares once
  // lod climbs past about 3.
  vec2 o = uTexel * exp2(lod) * 0.75;
  vec3 c  = textureLod(uScene, vUv, lod).rgb * 0.40;
  c += textureLod(uScene, vUv + vec2( o.x, 0.0), lod).rgb * 0.15;
  c += textureLod(uScene, vUv + vec2(-o.x, 0.0), lod).rgb * 0.15;
  c += textureLod(uScene, vUv + vec2(0.0,  o.y), lod).rgb * 0.15;
  c += textureLod(uScene, vUv + vec2(0.0, -o.y), lod).rgb * 0.15;

  // §5 specified desaturating toward --sand-shadow and dropping to ~30%
  // luminance. Shipped at zero: with an opaque --foam plate carrying the text,
  // the grade was not buying legibility, and a dark wash over the scene read as
  // a scrim laid on top of the beach rather than as the beach out of focus.
  // Defocus and the camera push carry the transition instead. Both knobs are
  // live, so this is a setting rather than a deletion.
  float lum   = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3  toned = mix(vec3(lum), SAND_SHADOW * (0.55 + 0.90 * lum), 0.45);
  vec3  graded = mix(c, toned, uDesat) * mix(1.0, uDim, uFocus);

  outC = vec4(mix(c, graded, uFocus), 1.0);
}
