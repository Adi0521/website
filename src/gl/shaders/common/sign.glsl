// The timeline signpost (§8.2): a weathered wooden board on one post, standing
// in the sand where the footprint trail begins.
//
// Two plain boxes, intersected ANALYTICALLY — no marching at all, so there is
// nothing to tunnel through (the lesson of the wood name; see text.glsl). All
// the wood is shading: grain, plank seam and the carved lettering bend the
// albedo, never the surface the ray hits.
//
// The cast shadow is a short soft-shadow march against the boxes' EXACT
// distance field. Exact matters: an undisplaced box SDF never overestimates,
// so the march cannot skip the caster and the penumbra cannot speckle.

uniform float uSignOn;
uniform sampler2D uSignTex;
/** Foot of the post on the sand, and the sign's frame: right, up, facing. */
uniform vec3  uSignC, uSignR, uSignU, uSignN;
/** Board: half width, half height, half thickness, centre height. */
uniform vec4  uSignBoard;
/** Post: half width, bottom, top (heights along up). */
uniform vec3  uSignPost;
/** Lettering mask width in texels, for the mip level. */
uniform float uSignPx;

vec3 signLocal(vec3 p){
  vec3 r = p - uSignC;
  return vec3(dot(r,uSignR), dot(r,uSignU), dot(r,uSignN));
}
vec3 signDir(vec3 d){ return vec3(dot(d,uSignR), dot(d,uSignU), dot(d,uSignN)); }
vec3 signWorldDir(vec3 l){ return l.x*uSignR + l.y*uSignU + l.z*uSignN; }

void signBoxes(out vec3 bc, out vec3 be, out vec3 pc, out vec3 pe){
  bc = vec3(0.0, uSignBoard.w, 0.0);
  be = uSignBoard.xyz;
  // The post stands behind the board, touching its back.
  pc = vec3(0.0, 0.5*(uSignPost.y + uSignPost.z), -(uSignBoard.z + uSignPost.x));
  pe = vec3(uSignPost.x, 0.5*(uSignPost.z - uSignPost.y), uSignPost.x);
}

bool signBox(vec3 o, vec3 d, vec3 c, vec3 e, out float tn, out vec3 n){
  vec3 dd = d;
  if(abs(dd.x) < 1e-6) dd.x = 1e-6;
  if(abs(dd.y) < 1e-6) dd.y = 1e-6;
  if(abs(dd.z) < 1e-6) dd.z = 1e-6;
  vec3 ka = (c - e - o)/dd, kb = (c + e - o)/dd;
  vec3 kmn = min(ka,kb), kmx = max(ka,kb);
  tn = max(max(kmn.x,kmn.y),kmn.z);
  float tf = min(min(kmx.x,kmx.y),kmx.z);
  n = vec3(0.0);
  if(tn <= 0.0 || tf < tn) return false;
  if(tn == kmn.x)      n = vec3(-sign(dd.x),0.0,0.0);
  else if(tn == kmn.y) n = vec3(0.0,-sign(dd.y),0.0);
  else                 n = vec3(0.0,0.0,-sign(dd.z));
  return true;
}

/** part: 0 board, 1 post. Normal is in WORLD space. */
bool signHit(vec3 ro, vec3 rd, float maxT, out float tOut, out vec3 nOut, out float part){
  tOut = 0.0; nOut = vec3(0.0,1.0,0.0); part = 0.0;
  if(uSignOn < 0.5) return false;
  vec3 o = signLocal(ro), d = signDir(rd);
  vec3 bc, be, pc, pe; signBoxes(bc, be, pc, pe);
  float tb, tp; vec3 nb, np;
  bool hb = signBox(o, d, bc, be, tb, nb);
  bool hp = signBox(o, d, pc, pe, tp, np);
  if(hb && (!hp || tb < tp)){ tOut = tb; nOut = signWorldDir(nb); part = 0.0; }
  else if(hp){ tOut = tp; nOut = signWorldDir(np); part = 1.0; }
  else return false;
  return tOut < maxT;
}

float signBoxSD(vec3 p, vec3 c, vec3 e){
  vec3 q = abs(p - c) - e;
  return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0);
}
float signSD(vec3 lp){
  vec3 bc, be, pc, pe; signBoxes(bc, be, pc, pe);
  return min(signBoxSD(lp, bc, be), signBoxSD(lp, pc, pe));
}

/** 0 lit, 1 fully shadowed by the sign. */
float signShadow(vec3 p, vec3 L){
  if(uSignOn < 0.5 || L.y < 0.02) return 0.0;
  vec3 o = signLocal(p), d = signDir(L);
  // Cheap reject: the ray never comes near the sign's bounding sphere, which
  // is every sand pixel but the strip the shadow actually lies on.
  vec3 cen = vec3(0.0, 0.5*uSignPost.z, 0.0);
  float rad = length(vec3(uSignBoard.x, 0.5*uSignPost.z - uSignPost.y, uSignBoard.z + 2.0*uSignPost.x)) + 0.08;
  float tc = max(dot(cen - o, d), 0.0);
  if(length(o + d*tc - cen) > rad) return 0.0;
  float res = 1.0, t = 0.015;
  for(int i=0;i<28;i++){
    float h = signSD(o + d*t);
    res = min(res, 9.0*h/t);
    if(res < 0.002) break;
    t += clamp(h, 0.008, 0.3);
    if(t > tc + rad) break;
  }
  return 1.0 - smoothstep(0.0, 1.0, clamp(res, 0.0, 1.0));
}

/**
 * Sky the post hides from the sand right at its foot — a contact darkening,
 * so it reads as driven in rather than hovering.
 */
float signFoot(vec3 p){
  if(uSignOn < 0.5) return 0.0;
  vec3 lp = signLocal(p);
  vec3 bc, be, pc, pe; signBoxes(bc, be, pc, pe);
  vec2 q = abs(lp.xz - pc.xz) - pe.xz;
  float d = length(max(q,0.0)) + min(max(q.x,q.y),0.0);
  return 1.0 - smoothstep(0.0, 0.07, d);
}

/** Lettering coverage on the board's front face, 0..1. */
float signLetters(vec3 lp, float t){
  vec2 uv = vec2(lp.x/uSignBoard.x*0.5 + 0.5, 0.5 - (lp.y - uSignBoard.w)/uSignBoard.y*0.5);
  if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  float wpp = t/(uFov*uRes.y);
  float lod = clamp(log2(max(wpp/(2.0*uSignBoard.x/uSignPx), 1e-4)), 0.0, 6.0);
  return textureLod(uSignTex, uv, lod).r;
}

/**
 * Weathered driftwood-grey wood: grain streaks along the timber, a plank seam
 * across the board, and the word cut in and darkened. Returns albedo; `dark`
 * says how far into a cut the point is, for the caller's ambient.
 */
vec3 signAlbedo(vec3 lp, vec3 nl, float part, float t, out float cut){
  cut = 0.0;
  // Grain runs along the board's length and up the post.
  float along  = part < 0.5 ? lp.x : lp.y;
  float across = part < 0.5 ? lp.y + lp.z*0.7 : lp.x + lp.z;
  float warp = vn2(vec2(along*3.0, across*11.0))*2.0;
  float streak = vn2(vec2(along*5.0 + warp, across*170.0 + warp*3.0));
  float fine   = vn2(vec2(along*22.0, across*520.0));
  float blotch = vn2(lp.xy*7.0 + part*13.0);
  // Darker than the sand it stands in, or under this sun it reads as paper.
  vec3 bleached = vec3(0.40,0.36,0.31);
  vec3 brown    = vec3(0.30,0.21,0.14);
  vec3 a = mix(bleached, brown, 0.30 + 0.50*blotch);
  float fade = 1.0/(1.0 + t*0.5);
  a *= 0.70 + 0.50*mix(0.5, streak, fade) + 0.14*mix(0.5, fine, fade);

  if(part < 0.5){
    // Two planks: a dark seam along the middle of the BACK only. On the front
    // it runs straight through the word, and from a distance reads as a
    // strikethrough.
    float seam = 1.0 - smoothstep(0.0025, 0.0055, abs(lp.y - uSignBoard.w));
    a *= 1.0 - 0.55*seam*step(0.5, -nl.z);
    if(nl.z > 0.5){
      cut = signLetters(lp, t);
      // Cut into the wood: the groove is in its own shadow, with a little
      // of the raw, darker timber showing.
      a = mix(a, vec3(0.09,0.06,0.045), cut*0.92);
    }
  }
  return a;
}
