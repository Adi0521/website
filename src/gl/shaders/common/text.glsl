// The name as a sand structure (PRD §8.1), ported from prototype/hero-name.html.
//
// The mask is a coverage bitmap rasterized from the real DOM <h1>, extruded
// through uTextTh into a slab standing on the beach and marched like any other
// solid. That buys real thickness, real side walls, and letters that take
// exactly the same light as the ground they stand on — rather than a flat
// sticker trying to imitate sand.
//
// ── Why this shape of solution, and not a distance field ───────────────────
//
// An earlier attempt built the title as an SDF — analytic logs, lashings, bark
// displacement — and every problem it had came from the same place: a displaced
// distance field lies about distance, so the marcher's steps have to be tuned
// against the displacement, and when the tuning is off rays tunnel through the
// geometry. Holes, speckled edges, and a cast shadow full of static, none of
// which any amount of parameter sweeping fixed.
//
// Nothing here sphere-traces. The slab is entered through an analytic ray-box
// test, scanned at a FIXED number of steps, and refined by bisection — so there
// is no Lipschitz constraint to satisfy and no step size to get wrong. Detail
// comes from the mip chain rather than from displacement, which means it
// prefilters instead of aliasing: distant letters soften, and uTextErode rides
// on top of the mip level to sand the fine detail off, which is what a
// weathered sculpture actually looks like.
//
// The shadow is the same idea. It is ONE plane intersection and a handful of
// mip-filtered taps, not a second march — the penumbra widens by choosing a
// coarser mip with distance, so it is prefiltered by construction and cannot
// speckle however coarse it gets.

uniform sampler2D uText;
uniform float uTextOn;
/** 1 to march the letters as a solid; 0 leaves only their shadow. */
uniform float uTextSolid;
/** Quad centre in world space, and its basis: right, up, normal. */
uniform vec3  uTextC, uTextR, uTextU, uTextN;
/** Half width and half height of the quad, plus half thickness of the slab. */
uniform float uTextHW, uTextHH, uTextTh;
/** Mask width in texels, for deriving mip levels. */
uniform float uTextPx;
/** Coverage above this counts as solid. */
uniform float uTextCut;
/** Extra mip levels on the solid. Higher wears the letters smoother. */
uniform float uTextErode;
/** Shadow penumbra rate and strength. */
uniform float uTextSoft, uTextStr;

/**
 * Opaque black field with padding, so clamping past the edge reads as zero and
 * no border colour is needed.
 */
float textTap(vec2 uv, float lod){
  if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  return textureLod(uText, uv, lod).r;
}

/**
 * Does the ray from `p` along `dir` pass through the letters?
 *
 * One plane intersection plus a texture fetch, and no second march. A general
 * plane rather than a horizontal one, so the name can stand upright and face
 * the viewer while still casting a correct shadow.
 */
float textPlane(vec3 p, vec3 dir, float soft){
  float dn = dot(dir, uTextN);
  if(abs(dn) < 1e-4) return 0.0;
  float t = dot(uTextC - p, uTextN)/dn;
  if(t <= 0.0) return 0.0;
  vec3 d = p + dir*t - uTextC;
  vec2 q = vec2(dot(d, uTextR)/uTextHW, dot(d, uTextU)/uTextHH);
  // canvas row 0 is the top of the text and maps to v = 0, so v flips
  vec2 uv = vec2(q.x*0.5 + 0.5, 0.5 - q.y*0.5);
  // Penumbra widens with distance from the caster, which is what keeps a
  // standing object from looking pasted onto the ground — and it widens by
  // reading a COARSER MIP, so the softening is prefiltered rather than sampled.
  // That is the whole reason this cannot produce the speckle a marched shadow
  // does: there is no sampling pattern to alias.
  float pen = t*soft;
  float lod = clamp(log2(max(pen,1e-5)/(2.0*uTextHW)*uTextPx), 0.0, 7.0);
  vec2 e = vec2(pen/(2.0*uTextHW), pen/(2.0*uTextHH))*0.6;
  float a = textTap(uv, lod)*0.44;
  a += textTap(uv+vec2( e.x,0.0), lod)*0.14;
  a += textTap(uv+vec2(-e.x,0.0), lod)*0.14;
  a += textTap(uv+vec2(0.0, e.y), lod)*0.14;
  a += textTap(uv+vec2(0.0,-e.y), lod)*0.14;
  return clamp(a, 0.0, 1.0);
}

float textShadow(vec3 p, vec3 L){
  if(uTextOn < 0.5 || L.y < 0.02) return 0.0;
  return textPlane(p, L, uTextSoft)*uTextStr;
}

/**
 * Sky occlusion straight overhead. Only meaningful when the quad is tilted
 * enough to actually sit over the sand — a vertical card occludes little sky.
 */
float textAO(vec3 p){
  if(uTextOn < 0.5 || abs(uTextN.y) < 0.16) return 0.0;
  return textPlane(p, vec3(0.0,1.0,0.0), uTextSoft*2.2);
}

float maskAt(vec2 uv, float lod){
  if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  return textureLod(uText, uv, lod).r;
}

vec2 slabUV(vec3 lp){
  // canvas row 0 is the top of the text, so v runs opposite to U
  return vec2(lp.x/uTextHW*0.5 + 0.5, 0.5 - lp.y/uTextHH*0.5);
}

/**
 * The letters as a solid slab. Returns the nearest hit in front of `maxT`.
 *
 * Fixed-step scan then bisection, deliberately. A distance field would need its
 * steps tuned against whatever detail was displacing it; a coverage mask has no
 * distance information at all, so there is nothing to tune — the ray enters the
 * box analytically and the scan resolution is a constant.
 */
bool textSolid(vec3 ro, vec3 rd, float maxT, out float tOut, out vec3 nOut){
  tOut = 0.0; nOut = vec3(0.0,1.0,0.0);
  if(uTextOn < 0.5 || uTextSolid < 0.5) return false;

  vec3 rel = ro - uTextC;
  vec3 o  = vec3(dot(rel,uTextR), dot(rel,uTextU), dot(rel,uTextN));
  vec3 dv = vec3(dot(rd,uTextR),  dot(rd,uTextU),  dot(rd,uTextN));
  vec3 e  = vec3(uTextHW, uTextHH, uTextTh);

  vec3 dd = dv;
  if(abs(dd.x) < 1e-6) dd.x = 1e-6;
  if(abs(dd.y) < 1e-6) dd.y = 1e-6;
  if(abs(dd.z) < 1e-6) dd.z = 1e-6;
  vec3 ka = (-e - o)/dd, kb = (e - o)/dd;
  vec3 kmn = min(ka,kb), kmx = max(ka,kb);
  float tn = max(max(kmn.x,kmn.y),kmn.z);
  float tf = min(min(kmx.x,kmx.y),kmx.z);
  if(tf <= max(tn,0.0)) return false;
  float t0 = max(tn,0.0), t1 = min(tf,maxT);
  if(t0 >= t1) return false;

  // Mip level from the screen footprint, so distant letters stop aliasing.
  // uTextErode rides on top: higher levels sand the fine detail off, which is
  // what a weathered sculpture actually looks like.
  float wpp = t0/(uFov*uRes.y);
  float lod = clamp(log2(max(wpp/(2.0*uTextHW/uTextPx), 1e-4)), 0.0, 6.0) + uTextErode;

  float span = t1 - t0, prevT = t0;
  const int NS = 16;
  for(int i=0;i<=NS;i++){
    float t = t0 + span*float(i)/float(NS);
    if(maskAt(slabUV(o + dv*t), lod) > uTextCut){
      float a = prevT, b = t;
      for(int j=0;j<6;j++){
        float mid = 0.5*(a+b);
        if(maskAt(slabUV(o + dv*mid), lod) > uTextCut) b = mid; else a = mid;
      }
      tOut = b;
      vec3 hp = o + dv*b;
      vec2 huv = slabUV(hp);
      if(i == 0 && abs(abs(hp.z) - e.z) < 2e-3){
        nOut = uTextN*(-sign(dv.z));            // entered through a flat face
      } else {
        // Side wall: the surface normal follows the mask gradient, and v runs
        // opposite to U so its sign flips back here.
        float ep = 1.5/uTextPx;
        float gx = maskAt(huv+vec2(ep,0.0), lod) - maskAt(huv-vec2(ep,0.0), lod);
        float gy = maskAt(huv+vec2(0.0,ep), lod) - maskAt(huv-vec2(0.0,ep), lod);
        vec3 sn = -gx*uTextR + gy*uTextU;
        float sl = length(sn);
        nOut = sl > 1e-5 ? sn/sl : uTextN*(-sign(dv.z));
      }
      return true;
    }
    prevT = t;
  }
  return false;
}
