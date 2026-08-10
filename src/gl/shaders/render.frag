#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outC;
uniform sampler2D uField, uStatic;
uniform vec2  uTexel, uRes;
uniform vec3  uRo, uUu, uVv, uWw;
uniform vec2  uCursorW;
uniform float uFov, uWpt, uRelief, uSparkle, uSky;
uniform float uSunEl, uSunAz, uDX, uDZ, uHtw, uFog, uSteps;
uniform float uCursorOn, uCursorR, uExposure, uFoam, uSat;
uniform int   uView;
#include "common/wave.glsl";

const vec3 SAND_LIT    = vec3(0.929,0.863,0.722);
const vec3 SAND_SHADOW = vec3(0.361,0.478,0.600);
const vec3 SUN_RIM     = vec3(1.000,0.914,0.690);
const vec3 SEA         = vec3(0.243,0.561,0.518);   // accent / cursor ring
const vec3 SEA_SHALLOW = vec3(0.196,0.596,0.690);   // turquoise over sand
const vec3 SEA_DEEP    = vec3(0.075,0.310,0.573);   // deep blue offshore
const vec3 FOAM        = vec3(0.968,0.984,0.976);

float hash21(vec2 p){
  p = fract(p*vec2(123.34,345.45));
  p += dot(p, p+34.345);
  return fract(p.x*p.y);
}
float vn2(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash21(i), hash21(i+vec2(1.0,0.0)), f.x),
             mix(hash21(i+vec2(0.0,1.0)), hash21(i+vec2(1.0,1.0)), f.x), f.y);
}
float fbm2(vec2 p){
  float s = 0.0, a = 0.5;
  for(int i=0;i<3;i++){ s += a*vn2(p); p = p*2.07 + 7.1; a *= 0.5; }
  return s;
}

vec2 w2uv(vec2 xz){ return vec2(xz.x/(2.0*uDX)+0.5, xz.y/(2.0*uDZ)+0.5); }

// the interactive field is a finite texture. sampling past its edge returns
// the nearest texel repeated forever, so a mark made at the boundary would
// extrude outward as an infinite stripe. fade its contribution out instead.
// the baked ripples use MIRRORED_REPEAT, so the beach itself keeps going.
float patchMask(vec2 xz){
  vec2 a = abs(vec2(xz.x/uDX, xz.y/uDZ));
  return (1.0-smoothstep(0.78,0.99,a.x))*(1.0-smoothstep(0.78,0.99,a.y));
}
float heightAt(vec2 xz){
  vec2 uv = w2uv(xz);
  return texture(uStatic, uv).r + texture(uField, uv).r*patchMask(xz);
}
float terrainY(vec2 xz){ return heightAt(xz)*uHtw + beachY(xz.y); }
float sceneY(vec2 xz){ return max(terrainY(xz), waterY(xz)); }

// soft shadow: march the heightfield toward the sun. with a grazing sun this
// is what makes a 2mm depression legible at all.
float sunShadow(vec2 xz, float y0, vec3 L){
  vec2 dir = normalize(L.xz);
  float slope = L.y/max(length(L.xz), 1e-4);
  float s = 1.0;
  for(int i=1;i<=18;i++){
    float fi = float(i);
    float t  = uWpt*1.8*fi*(1.0 + fi*0.10);
    float diff = terrainY(xz + dir*t) - (y0 + slope*t);
    if(diff > 0.0) s = min(s, 1.0 - clamp(diff/(t*0.55), 0.0, 1.0));
  }
  return clamp(s, 0.0, 1.0);
}

vec3 skyCol(vec3 rd, vec3 L){
  float up = clamp(rd.y, 0.0, 1.0);
  vec3 zenith  = vec3(0.169,0.298,0.463);
  vec3 horizon = vec3(0.847,0.784,0.678);
  vec3 c = mix(horizon, zenith, pow(up, 0.52));
  float sd = max(dot(rd, L), 0.0);
  c += SUN_RIM*pow(sd, 250.0)*1.30;
  c += SUN_RIM*pow(sd,   7.0)*0.24;
  c += SEA_DEEP*0.10*(1.0-up);
  return c;
}

void main(){
  vec2 pix = (gl_FragCoord.xy - 0.5*uRes)/uRes.y;
  vec3 ro = uRo;
  vec3 rd = normalize(pix.x*uUu + pix.y*uVv + uFov*uWw);
  vec3 L  = normalize(vec3(cos(uSunAz)*cos(uSunEl), sin(uSunEl), sin(uSunAz)*cos(uSunEl)));

  // ---- march sand and sea together -------------------------------------
  float t = 0.02, tHit = -1.0, tPrev = t;
  float descent = max(-rd.y, 0.0);
  int budget = int(uSteps);
  for(int i=0;i<150;i++){
    if(i >= budget) break;
    vec3 p = ro + rd*t;
    if(t > 18.0) break;
    if(p.y > 1.1 && rd.y > 0.0) break;           // ascending, above everything
    float d = p.y - sceneY(p.xz);
    if(d < 0.0){
      // crossed the surface. bisect for the true intersection, otherwise the
      // hit snaps to the marching step and the sand renders as flat slabs.
      float lo = tPrev, hi = t;
      for(int j=0;j<8;j++){
        float mid = 0.5*(lo+hi);
        vec3 pm = ro + rd*mid;
        if(pm.y - sceneY(pm.xz) < 0.0) hi = mid; else lo = mid;
      }
      tHit = hi;
      break;
    }
    tPrev = t;
    // step by how far the ray must travel to lose height d, not by d itself:
    // a grazing ray covers far more ground per unit of height it descends
    t += clamp(d/max(descent, 0.03)*0.8, 0.004 + t*0.004, 0.6);
  }
  if(tHit < 0.0 && rd.y < 0.0 && t < 18.0) tHit = t;

  vec3 col;
  if(tHit < 0.0){
    col = skyCol(rd, L);
  } else {
    vec3 p  = ro + rd*tHit;
    vec3 V  = normalize(ro - p);
    float tY = terrainY(p.xz);
    float wY = waterY(p.xz);
    float depth = wY - tY;

    if(depth > 0.0009){
      // ---------------------------------------------------------- water --
      float ex = 0.010 + tHit*0.010;
      float wl = waterY(p.xz - vec2(ex,0.0)), wr = waterY(p.xz + vec2(ex,0.0));
      float wu = waterY(p.xz + vec2(0.0,ex)), wd = waterY(p.xz - vec2(0.0,ex));
      vec3 WN = normalize(vec3(-(wr-wl)/(2.0*ex), 1.0, -(wu-wd)/(2.0*ex)));

      // sand seen through the water, extinguishing with depth
      vec3 bed  = SAND_LIT*0.78*exp(-depth*9.0);
      // the water column itself grades from turquoise where the sand shows
      // through to deep blue once it is thick enough to swallow the light
      vec3 column = mix(SEA_SHALLOW, SEA_DEEP, 1.0 - exp(-depth*2.6));
      vec3 body = mix(column, bed, exp(-depth*13.0));
      float fres = pow(1.0 - max(dot(WN,V), 0.0), 4.0);
      col = mix(body, skyCol(reflect(-V, WN), L), fres*0.38);

      vec3 Hw = normalize(L + V);
      col += SUN_RIM*pow(max(dot(WN,Hw), 0.0), 200.0)*1.5;

      // foam: a thin sheet where the sheet runs out, plus breakup on steep faces
      float slope = length(vec2(wr-wl, wu-wd))/(2.0*ex);
      float edge  = 1.0 - smoothstep(0.0, 0.024, depth);
      float crest = smoothstep(0.42, 1.05, slope);
      float fn    = fbm2(p.xz*9.0 + vec2(0.0, uTime*0.55));
      float foam  = clamp((edge*1.2 + crest*0.85)*(0.40 + 0.80*fn), 0.0, 1.0)*uFoam;
      col = mix(col, FOAM, foam);

    } else {
      // ----------------------------------------------------------- sand --
      vec2 uv = w2uv(p.xz);
      float msk = patchMask(p.xz);
      float dst = texture(uField, uv).g*msk;
      float wet = texture(uField, uv).b*msk;
      // sheet too thin to be worth marching as geometry, so it is shaded as an
      // overlay on the sand instead
      float filmAmt = smoothstep(0.0, 0.014, filmY(p.xz) - tY);
      wet = max(wet, filmAmt*0.92);

      // widen the sampling footprint with distance: one texel projects to well
      // under a pixel out near the horizon, which is what makes it shimmer
      float lod = 1.0 + tHit*1.5;
      float ew  = uWpt*lod;
      float hl = heightAt(p.xz - vec2(ew,0.0));
      float hr = heightAt(p.xz + vec2(ew,0.0));
      float hu = heightAt(p.xz + vec2(0.0,ew));
      float hd = heightAt(p.xz - vec2(0.0,ew));
      float h0 = heightAt(p.xz);
      float ws = 2.0*ew;
      vec3 N = normalize(vec3(-(hr-hl)*uHtw/ws, 1.0, -(hu-hd)*uHtw/ws));

      // sub-texel grain roughness, stronger where sand was recently moved
      vec2 mp = p.xz*430.0;
      float m0 = hash21(floor(mp));
      float mx = hash21(floor(mp+vec2(1.0,0.0)));
      float my = hash21(floor(mp+vec2(0.0,1.0)));
      float micro = (0.055 + 0.10*dst)*(1.0 - 0.7*wet)/(1.0 + tHit*2.2);
      N = normalize(N + vec3((mx-m0)*micro, 0.0, (my-m0)*micro));

      float sh = sunShadow(p.xz, p.y, L);

      float wide = heightAt(p.xz + vec2( 7.0*ew,0.0))
                 + heightAt(p.xz + vec2(-7.0*ew,0.0))
                 + heightAt(p.xz + vec2(0.0, 7.0*ew))
                 + heightAt(p.xz + vec2(0.0,-7.0*ew));
      float ao = clamp(1.0 - (wide*0.25 - h0)*2.6, 0.25, 1.0);

      float grain = texture(uStatic, uv).g;
      vec3 albedo = SAND_LIT*(0.93 + 0.14*grain);
      albedo = mix(albedo, albedo*vec3(0.80,0.76,0.72), dst*0.55);
      // wet sand is darker: water fills the gaps between grains and stops them
      // scattering, which is most of why a receding wave leaves a dark band
      albedo = mix(albedo, albedo*vec3(0.50,0.49,0.48), wet);

      // expose for the sand: normalising by sun elevation means dropping the sun
      // lengthens shadows instead of just dimming everything
      float ndl = max(dot(N,L), 0.0);
      vec3 direct  = SUN_RIM*ndl*sh*uExposure/max(sin(uSunEl), 0.10);
      vec3 ambient = SAND_SHADOW*(0.45 + 0.55*N.y)*ao*uSky;
      col = albedo*(direct + ambient);

      vec3 Hv = normalize(L + V);
      float nh = max(dot(N,Hv), 0.0);
      col += SUN_RIM*pow(nh, mix(52.0,14.0,dst))*mix(0.05,0.018,dst)*sh;
      col += SUN_RIM*pow(nh, 110.0)*wet*0.45*sh;          // sheen on wet sand
      float gs = hash21(floor(p.xz*880.0));
      col += SUN_RIM*pow(gs,22.0)*pow(nh,7.0)*sh*uSparkle*(1.0-wet)/(1.0 + tHit*1.6);
      col += SAND_SHADOW*0.12*(1.0-ao)*uSky;

      // draining film: glossy, faintly mirroring the sky, with foam flecks
      // that strand and fade rather than blinking out with the waterline
      if(filmAmt > 0.001){
        col = mix(col, skyCol(reflect(-V, N), L), filmAmt*0.15);
        col += SUN_RIM*pow(nh, 240.0)*filmAmt*0.85*sh;
        float fl = fbm2(p.xz*11.0 + vec2(0.0, uTime*0.35));
        col = mix(col, FOAM, filmAmt*smoothstep(0.60,0.96,fl)*0.40*uFoam);
      }

      float cd = length(p.xz - uCursorW);
      col += SEA*exp(-pow((cd-uCursorR)*26.0,2.0))*0.30*uCursorOn;

      if(uView == 1){ col = mix(vec3(0.05,0.09,0.16), SEA, h0*0.5+0.5); }
      else if(uView == 2){ col = N*0.5+0.5; }
      else if(uView == 3){ col = mix(vec3(0.04,0.07,0.11), SUN_RIM, dst); }
    }

    if(uView == 0) col = mix(col, skyCol(rd, L), 1.0 - exp(-tHit*uFog));
  }

  if(uView == 0){
    col = (col*(2.51*col+0.03))/(col*(2.43*col+0.59)+0.14);   // ACES
    float lum = dot(col, vec3(0.2126,0.7152,0.0722));
    col = clamp(mix(vec3(lum), col, uSat), 0.0, 1.0);
    vec2 dv = vUv-0.5;
    float asp = uRes.x/max(uRes.y,1.0);
    col *= mix(1.0, smoothstep(1.28,0.30,length(dv*vec2(asp,1.0))*1.14), 0.42);
    col += (hash21(gl_FragCoord.xy + fract(uTime*13.7)*97.0)-0.5)*0.022*(1.0-0.5*col);
  }
  outC = vec4(clamp(col,0.0,1.0), 1.0);
}