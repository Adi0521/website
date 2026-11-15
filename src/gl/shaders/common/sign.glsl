// The signposts along the timeline (§8.2): the "Timeline" sign where the trail
// begins, and one per milestone beside its footprints. Weathered boards on
// single posts, the words brushed on in white paint.
//
// Each is two plain boxes, intersected ANALYTICALLY — no marching at all, so
// there is nothing to tunnel through (the lesson of the wood name; see
// text.glsl). All the wood is shading: grain, checks, grime and paint bend the
// albedo, never the surface the ray hits. The chipped outline is the one
// exception, and it is a refused hit, not a displaced surface.
//
// The cast shadow is a short soft-shadow march against the boxes' EXACT
// distance field. Exact matters: an undisplaced box SDF never overestimates,
// so the march cannot skip the caster and the penumbra cannot speckle.
//
// Every board's lettering lives in one atlas (uSignTex); uSignUV is each
// board's rectangle in it.

#define MAX_SIGNS 8
uniform int uSignCount;
uniform sampler2D uSignTex;
/** Foot of each post on the sand, and each sign's frame: right, up, facing. */
uniform vec3  uSignC[MAX_SIGNS], uSignR[MAX_SIGNS], uSignU[MAX_SIGNS], uSignN[MAX_SIGNS];
/** Board: half width, half height, half thickness, centre height. */
uniform vec4  uSignBoard[MAX_SIGNS];
/** Post: half width, bottom, top (heights along up). */
uniform vec3  uSignPost[MAX_SIGNS];
/** The board's rectangle in the atlas: u0, v0, u1, v1. */
uniform vec4  uSignUV[MAX_SIGNS];
/** Board width in atlas texels, for the mip level. */
uniform float uSignPx[MAX_SIGNS];

// ── The scroll on each milestone sign ──────────────────────────────────────
//
// A small page on a rod nailed across the board's top corner (the trail-side
// one), hanging just off the board's end so it never covers the painted
// lettering. Rolled, it is a little horizontal roll under the rod; clicked, it
// unrolls DOWNWARD, the roll dropping as paper comes off it — and then the
// camera glides in to read it (about/mount.ts). Three analytic pieces: the
// rod, the sheet (a plane from rod to roll) and the roll (a capped cylinder).
/** side (+1 local right, -1 left, 0 = none), half width, unrolled length, rod height. */
uniform vec4  uScroll[MAX_SIGNS];
/** 0 rolled .. 1 open. */
uniform float uScrollOpen[MAX_SIGNS];
/** The page's text rectangle in the atlas. */
uniform vec4  uScrollUV[MAX_SIGNS];

const float SCROLL_ROD = 0.0035;
/** Page width in atlas texels. Must match SCROLL_W in about/sign.ts. */
const float SCROLL_PX = 512.0;

struct ScrollShape { float s, hw, len, yt, xc, z0, rr, yr, open; };

ScrollShape scrollShape(int i){
  vec4 q = uScroll[i];
  ScrollShape k;
  k.s = q.x; k.hw = q.y; k.len = q.z; k.yt = q.w;
  k.open = uScrollOpen[i];
  // Just off the board's end, a hair in front of its face (the rod is nailed
  // onto the front).
  k.xc = k.s*(uSignBoard[i].x + 0.008 + k.hw);
  k.z0 = uSignBoard[i].z + 0.006;
  // Fatter while rolled, thinner as the paper comes off it.
  k.rr = mix(0.010, 0.006, k.open);
  k.yr = k.yt - SCROLL_ROD - k.rr - k.len*k.open;
  return k;
}

/** iq's capped cylinder: xyz normal, w distance (-1 for a miss). `rd` unit. */
vec4 capCyl(vec3 ro, vec3 rd, vec3 a, vec3 b, float ra){
  vec3 ba = b - a, oc = ro - a;
  float baba = dot(ba,ba), bard = dot(ba,rd), baoc = dot(ba,oc);
  float k2 = baba - bard*bard;
  float k1 = baba*dot(oc,rd) - baoc*bard;
  float k0 = baba*dot(oc,oc) - baoc*baoc - ra*ra*baba;
  float h = k1*k1 - k2*k0;
  if(h < 0.0) return vec4(-1.0);
  h = sqrt(h);
  float t = (-k1 - h)/k2;
  float y = baoc + t*bard;
  if(y > 0.0 && y < baba) return vec4((oc + t*rd - ba*y/baba)/ra, t);
  t = (((y < 0.0) ? 0.0 : baba) - baoc)/bard;
  if(abs(k1 + k2*t) < h) return vec4(ba*sign(y)/sqrt(baba), t);
  return vec4(-1.0);
}

vec3 signLocal(int i, vec3 p){
  vec3 r = p - uSignC[i];
  return vec3(dot(r,uSignR[i]), dot(r,uSignU[i]), dot(r,uSignN[i]));
}
vec3 signDir(int i, vec3 d){ return vec3(dot(d,uSignR[i]), dot(d,uSignU[i]), dot(d,uSignN[i])); }
vec3 signWorldDir(int i, vec3 l){ return l.x*uSignR[i] + l.y*uSignU[i] + l.z*uSignN[i]; }

void signBoxes(int i, out vec3 bc, out vec3 be, out vec3 pc, out vec3 pe){
  vec4 b = uSignBoard[i]; vec3 q = uSignPost[i];
  bc = vec3(0.0, b.w, 0.0);
  be = b.xyz;
  // The post stands behind the board, touching its back.
  pc = vec3(0.0, 0.5*(q.y + q.z), -(b.z + q.x));
  pe = vec3(q.x, 0.5*(q.z - q.y), q.x);
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

/**
 * Is this point of board `i`'s outline broken away? Weathered boards are
 * chipped along their edges and rounded off at the corners. Tested on the
 * board's local xy, so a chip goes through the full thickness. Seeded per
 * sign, so no two boards are chipped alike.
 */
bool signChipped(int i, vec2 xy){
  vec4 b = uSignBoard[i];
  float s = float(i)*17.3;
  vec2 q = vec2(b.x - abs(xy.x), b.y - abs(xy.y - b.w));
  float sx = (xy.y > b.w ? 3.1 : 8.7) + s;
  float sy = (xy.x > 0.0 ? 5.3 : 11.9) + s;
  float biteTB = 0.002 + 0.006*vn2(vec2(xy.x*70.0, sx)) + 0.016*smoothstep(0.72, 0.92, vn2(vec2(xy.x*9.0, sx + 2.0)));
  float biteLR = 0.002 + 0.006*vn2(vec2(xy.y*70.0, sy)) + 0.012*smoothstep(0.70, 0.92, vn2(vec2(xy.y*14.0, sy + 2.0)));
  // Corners worn round, unevenly.
  float r = 0.012 + 0.014*vn2(sign(xy)*3.7 + s);
  vec2 c = max(vec2(r) - q, 0.0);
  return q.y < biteTB || q.x < biteLR || length(c) > r;
}

/**
 * Nearest sign along the ray, if it is nearer than maxT.
 * part: 0 board, 1 post. idx: which sign. Normal is in WORLD space.
 */
bool signHit(vec3 ro, vec3 rd, float maxT, out float tOut, out vec3 nOut, out float part, out int idx){
  tOut = maxT; nOut = vec3(0.0,1.0,0.0); part = 0.0; idx = 0;
  bool any = false;
  for(int i=0;i<MAX_SIGNS;i++){
    if(i >= uSignCount) break;
    vec3 o = signLocal(i, ro), d = signDir(i, rd);
    vec3 bc, be, pc, pe; signBoxes(i, bc, be, pc, pe);
    float tb, tp; vec3 nb, np;
    bool hb = signBox(o, d, bc, be, tb, nb);
    if(hb && signChipped(i, (o + d*tb).xy)) hb = false;
    bool hp = signBox(o, d, pc, pe, tp, np);
    if(hb && tb < tOut){ tOut = tb; nOut = signWorldDir(i, nb); part = 0.0; idx = i; any = true; }
    if(hp && tp < tOut){ tOut = tp; nOut = signWorldDir(i, np); part = 1.0; idx = i; any = true; }

    if(uScroll[i].x == 0.0) continue;
    ScrollShape k = scrollShape(i);
    // part 2: the page. A plane from the rod down to the roll, two-sided.
    if(abs(d.z) > 1e-5){
      float ts = (k.z0 - o.z)/d.z;
      vec3 h = o + d*ts;
      if(ts > 0.0 && ts < tOut && abs(h.x - k.xc) < k.hw && h.y < k.yt && h.y > k.yr){
        tOut = ts; nOut = signWorldDir(i, vec3(0.0, 0.0, -sign(d.z))); part = 2.0; idx = i; any = true;
      }
    }
    // part 3: the roll.
    vec4 cr = capCyl(o, d, vec3(k.xc - k.hw - 0.002, k.yr, k.z0), vec3(k.xc + k.hw + 0.002, k.yr, k.z0), k.rr);
    if(cr.w > 0.0 && cr.w < tOut){ tOut = cr.w; nOut = signWorldDir(i, cr.xyz); part = 3.0; idx = i; any = true; }
    // part 4: the rod, nailed across the board's corner.
    vec4 cd = capCyl(o, d, vec3(k.s*(uSignBoard[i].x - 0.02), k.yt, k.z0), vec3(k.xc + k.s*(k.hw + 0.006), k.yt, k.z0), SCROLL_ROD);
    if(cd.w > 0.0 && cd.w < tOut){ tOut = cd.w; nOut = signWorldDir(i, cd.xyz); part = 4.0; idx = i; any = true; }
  }
  return any;
}

float signBoxSD(vec3 p, vec3 c, vec3 e){
  vec3 q = abs(p - c) - e;
  return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0);
}
float xCylSD(vec3 p, vec2 axisYZ, float x0, float x1, float r){
  vec2 d = vec2(length(p.yz - axisYZ) - r, abs(p.x - 0.5*(x0 + x1)) - 0.5*(x1 - x0));
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}
float signSD(int i, vec3 lp){
  vec3 bc, be, pc, pe; signBoxes(i, bc, be, pc, pe);
  float d = min(signBoxSD(lp, bc, be), signBoxSD(lp, pc, pe));
  if(uScroll[i].x != 0.0){
    ScrollShape k = scrollShape(i);
    d = min(d, xCylSD(lp, vec2(k.yr, k.z0), k.xc - k.hw, k.xc + k.hw, k.rr));
    float hl = 0.5*(k.yt - k.yr);
    d = min(d, signBoxSD(lp, vec3(k.xc, k.yt - hl, k.z0), vec3(k.hw, hl, 0.001)));
  }
  return d;
}

/** 0 lit, 1 fully shadowed by sign `i`. */
float signShadowOne(int i, vec3 p, vec3 L){
  vec3 o = signLocal(i, p), d = signDir(i, L);
  vec4 b = uSignBoard[i]; vec3 q = uSignPost[i];
  // Cheap reject: the ray never comes near this sign's bounding sphere,
  // which is every sand pixel but the strip its shadow lies on.
  vec3 cen = vec3(0.0, 0.5*q.z, 0.0);
  // Wide enough for an unrolled scroll off either end of the board.
  float xr = b.x + (uScroll[i].x != 0.0 ? 0.03 + 2.0*uScroll[i].y : 0.0);
  float rad = length(vec3(xr, 0.5*q.z - q.y, b.z + 2.0*q.x)) + 0.08;
  float tc = max(dot(cen - o, d), 0.0);
  if(length(o + d*tc - cen) > rad) return 0.0;
  float res = 1.0, t = 0.015;
  for(int k=0;k<28;k++){
    float h = signSD(i, o + d*t);
    res = min(res, 9.0*h/t);
    if(res < 0.002) break;
    t += clamp(h, 0.008, 0.3);
    if(t > tc + rad) break;
  }
  return 1.0 - smoothstep(0.0, 1.0, clamp(res, 0.0, 1.0));
}

/** 0 lit, 1 fully shadowed by any sign — for the sand. */
float signShadow(vec3 p, vec3 L){
  if(L.y < 0.02) return 0.0;
  float shade = 0.0;
  for(int i=0;i<MAX_SIGNS;i++){
    if(i >= uSignCount) break;
    shade = max(shade, signShadowOne(i, p, L));
  }
  return shade;
}

/**
 * Sky a post hides from the sand right at its foot — a contact darkening,
 * so it reads as driven in rather than hovering.
 */
float signFoot(vec3 p){
  float f = 0.0;
  for(int i=0;i<MAX_SIGNS;i++){
    if(i >= uSignCount) break;
    vec3 lp = signLocal(i, p);
    vec3 bc, be, pc, pe; signBoxes(i, bc, be, pc, pe);
    vec2 q = abs(lp.xz - pc.xz) - pe.xz;
    float d = length(max(q,0.0)) + min(max(q.x,q.y),0.0);
    f = max(f, 1.0 - smoothstep(0.0, 0.07, d));
  }
  return f;
}

/** Paint coverage on board `i`'s front face, 0..1. */
float signLetters(int i, vec3 lp, float t){
  vec4 b = uSignBoard[i];
  vec2 uv = vec2(lp.x/b.x*0.5 + 0.5, 0.5 - (lp.y - b.w)/b.y*0.5);
  if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  vec4 r = uSignUV[i];
  float wpp = t/(uFov*uRes.y);
  // Capped: the atlas cells are padded, but not by enough for the top mips.
  float lod = clamp(log2(max(wpp/(2.0*b.x/uSignPx[i]), 1e-4)), 0.0, 4.0);
  return textureLod(uSignTex, mix(r.xy, r.zw, uv), lod).r;
}

/**
 * Silvered, weathered timber: grey where the sun has bleached it, brown left
 * only down in the grain, split along the grain, grimy at the edges and damp
 * at the foot. The words are brushed on in chalky white house paint that has
 * faded and flaked off along the grain. Rusty nails hold the board to the post.
 *
 * Returns albedo; `paint` is how much paint is on this point.
 */
vec3 signAlbedo(int i, vec3 lp, vec3 nl, float part, float t, out float paint){
  paint = 0.0;
  vec4 b = uSignBoard[i];
  float s = float(i)*3.7;
  // Grain runs along the board's length and up the post.
  float along  = (part < 0.5 ? lp.x : lp.y) + s;
  float across = part < 0.5 ? lp.y + lp.z*0.7 : lp.x + lp.z;
  float fade = 1.0/(1.0 + t*0.5);
  float warp = vn2(vec2(along*3.0, across*11.0))*2.0;
  float streak = vn2(vec2(along*5.0 + warp, across*170.0 + warp*3.0));
  float fine   = vn2(vec2(along*22.0, across*520.0));
  float blotch = vn2(lp.xy*7.0 + part*13.0 + s);
  // Dark enough that the white paint stands off it under a low, bright sun.
  vec3 silver = vec3(0.27,0.27,0.26);
  vec3 brown  = vec3(0.21,0.16,0.11);
  vec3 a = mix(silver, brown, 0.10 + 0.55*blotch*streak);
  a *= 0.70 + 0.46*mix(0.5, streak, fade) + 0.14*mix(0.5, fine, fade);

  // Checks: thin dark splits running with the grain.
  float ck = vn2(vec2(along*2.2 + part*5.0, across*55.0));
  float check = (1.0 - smoothstep(0.0, 0.035, abs(ck - 0.5)))
              * smoothstep(0.45, 0.75, vn2(vec2(along*6.0, across*9.0 + 1.7)));
  a *= 1.0 - 0.65*check*fade;

  if(part < 0.5){
    // Grime toward the edges, and a water stain wicking up from the bottom.
    float ex = b.x - abs(lp.x), ey = b.y - abs(lp.y - b.w);
    float edge = 1.0 - smoothstep(0.0, 0.03, min(ex, ey));
    float low = 1.0 - smoothstep(-b.y, b.y*0.4, lp.y - b.w);
    a *= 1.0 - 0.25*edge - 0.22*low*(0.5 + 0.5*vn2(lp.xy*25.0 + s));

    // Two planks: a dark seam along the middle of the BACK only. On the front
    // it runs straight through the words, and from a distance reads as a
    // strikethrough.
    float seam = 1.0 - smoothstep(0.0025, 0.0055, abs(lp.y - b.w));
    a *= 1.0 - 0.55*seam*step(0.5, -nl.z);

    if(nl.z > 0.5){
      // The brushed words. Paint lifts first along the raised grain, then in
      // flakes, so the strokes break up the way old paint on wood does.
      float m = signLetters(i, lp, t);
      float flake = vn2(vec2(along*45.0, across*110.0))*0.6 + vn2(lp.xy*150.0 + s)*0.4;
      float keep = smoothstep(0.30, 0.46, flake + 0.22*(1.0 - streak));
      paint = m*mix(0.55, 1.0, keep)*0.95;
      vec3 chalk = vec3(0.86,0.83,0.76)*(0.88 + 0.12*vn2(lp.xy*60.0));
      a = mix(a, chalk, paint);

      // Two nails into the post, near the top and bottom edges so they keep
      // out of the lettering, each bleeding a rust streak down the board.
      for(int k=0;k<2;k++){
        vec2 nail = vec2(0.0, b.w + (k == 0 ? 1.0 : -1.0)*(b.y - 0.011));
        vec2 dn = lp.xy - nail;
        float run = clamp(-dn.y/0.05, 0.0, 1.0);
        float rust = (1.0 - smoothstep(0.002, 0.006 + 0.004*run, abs(dn.x + 0.002*sin(dn.y*300.0))))
                   * step(dn.y, 0.0)*(1.0 - run)*(0.5 + 0.5*vn2(lp.xy*200.0));
        a = mix(a, a*vec3(0.78,0.52,0.34), rust*0.8);
        float head = 1.0 - smoothstep(0.0035, 0.005, length(dn));
        a = mix(a, vec3(0.16,0.10,0.07), head);
      }
    }
  } else {
    // The post is darker and damp where it goes into the sand.
    a *= mix(0.55, 1.0, smoothstep(0.0, 0.12, lp.y));
  }
  return a;
}

/**
 * The scroll: aged parchment, darker and foxed toward its edges, the milestone
 * written on it in brown ink. The writing is fixed to the PAPER, so unrolling
 * reveals it from the top down. The roll's ends show the spiral of paper; the
 * rod is dark wood. part: 2 page, 3 roll, 4 rod. `nl` is sign-local.
 */
vec3 scrollAlbedo(int i, vec3 lp, vec3 nl, float part, float t){
  ScrollShape k = scrollShape(i);
  if(part > 3.5){
    float g = vn2(vec2(lp.x*300.0 + float(i), lp.y*40.0));
    return vec3(0.20,0.14,0.09)*(0.8 + 0.4*g);
  }
  float s = float(i)*5.1;
  // Toned down: under this sun lighter paper glares white.
  vec3 parch = vec3(0.74,0.66,0.50)*(0.86 + 0.14*vn2(lp.xy*90.0 + s));
  // Foxing: small brown age spots.
  float fox = smoothstep(0.80, 0.92, vn2(lp.xy*260.0 + s));
  parch = mix(parch, vec3(0.55,0.38,0.22), fox*0.5);
  if(part > 2.5){
    // The roll. On its ends, the spiral of rolled paper.
    if(abs(nl.x) > 0.5){
      vec2 q = lp.yz - vec2(k.yr, k.z0);
      float r = length(q)/k.rr;
      float ring = 0.5 + 0.5*sin(r*9.0*6.2832 + atan(q.y, q.x));
      return parch*mix(0.55, 0.95, ring)*(0.75 + 0.25*r);
    }
    return parch*0.88;
  }
  // The page.
  float u = (lp.x - (k.xc - k.hw))/(2.0*k.hw);
  float v = (k.yt - lp.y)/k.len;
  // Darker toward the side edges, the way handled paper ages.
  float edge = 1.0 - smoothstep(0.0, 0.10, min(u, 1.0 - u));
  parch *= 1.0 - 0.25*edge;
  if(nl.z > 0.0){
    vec4 r = uScrollUV[i];
    float wpp = t/(uFov*uRes.y);
    float lod = clamp(log2(max(wpp/(2.0*k.hw/SCROLL_PX), 1e-4)), 0.0, 4.0);
    float ink = textureLod(uSignTex, mix(r.xy, r.zw, vec2(u, v)), lod).r;
    // Near-black iron-gall brown: anything lighter goes orange in this sun.
    parch = mix(parch, vec3(0.07,0.035,0.02), ink*0.97);
  }
  return parch;
}
