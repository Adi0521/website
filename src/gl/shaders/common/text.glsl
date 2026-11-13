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
/** World units the letter edges wander by, and the surface texture strength. */
uniform float uTextCrumble, uTextTexture;

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
 * Is local point `lp` inside the letters?
 *
 * The crumble is a DOMAIN WARP of the mask lookup, not a displacement of a
 * distance field — so it moves the edges without giving the marcher anything
 * to tunnel through. The fixed-step scan below only ever asks "inside or
 * not", and a warped lookup answers that just as cleanly as a straight one.
 *
 * Depth (lp.z) feeds the warp too, so the side walls are not a clean
 * extrusion: they wander as they go back, like a chipped edge on stone.
 * The warp fades with mip level so distant letters do not shimmer.
 */
/**
 * The two constraints separately: x is the (crumbled) letter coverage, y how
 * far inside the slab's depth the point is. Solid is where BOTH clear the cut.
 * Kept apart so the normal can be taken from whichever one the ray actually
 * hit — see textSolid.
 */
vec2 solidParts(vec3 lp, float lod){
  float amp = uTextCrumble/(1.0 + max(lod - uTextErode, 0.0)*0.8);
  vec2 q = lp.xy*22.0 + vec2(lp.z*15.0, -lp.z*11.0);
  vec2 w = vec2(vn2(q), vn2(q + vec2(17.3, 5.1))) - 0.5;
  w += (vec2(vn2(q*2.7 + 3.1), vn2(q*2.7 + 9.7)) - 0.5)*0.45;
  float m = maskAt(slabUV(lp + vec3(w*amp*2.0, 0.0)), lod);
  // The faces wander a little in depth, so they are not ruled flat.
  float th = uTextTh*(0.85 + 0.30*vn2(lp.xy*9.0 + 2.3));
  float zin = 1.0 - smoothstep(th - 0.004, th + 0.004, abs(lp.z));
  return vec2(m, zin);
}

float solidAt(vec3 lp, float lod){
  vec2 s = solidParts(lp, lod);
  return min(s.x, s.y);
}

bool textSolid(vec3 ro, vec3 rd, float maxT, out float tOut, out vec3 nOut){
  tOut = 0.0; nOut = vec3(0.0,1.0,0.0);
  if(uTextOn < 0.5 || uTextSolid < 0.5) return false;

  vec3 rel = ro - uTextC;
  vec3 o  = vec3(dot(rel,uTextR), dot(rel,uTextU), dot(rel,uTextN));
  vec3 dv = vec3(dot(rd,uTextR),  dot(rd,uTextU),  dot(rd,uTextN));
  vec3 e  = vec3(uTextHW, uTextHH, uTextTh*1.2 + 0.01);

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
  const int NS = 20;
  for(int i=0;i<=NS;i++){
    float t = t0 + span*float(i)/float(NS);
    if(solidAt(o + dv*t, lod) > uTextCut){
      float a = prevT, b = t;
      for(int j=0;j<6;j++){
        float mid = 0.5*(a+b);
        if(solidAt(o + dv*mid, lod) > uTextCut) b = mid; else a = mid;
      }
      tOut = b;
      vec3 hp = o + dv*b;
      // Which constraint stopped the ray decides the normal. A face hit gets
      // the exact face normal; differencing the depth step instead jitters
      // pixel to pixel with where the bisection landed, and reads as static.
      // The surface texture is added afterwards by textBump, as shading.
      vec2 sp = solidParts(hp, lod);
      if(sp.y < sp.x){
        nOut = uTextN*sign(hp.z);                // front or back face
      } else {
        // Side wall: outward gradient of the (warped) letter coverage, in
        // local world units. v runs opposite to U, which the slab-local y
        // already accounts for.
        float ex = 1.5*2.0*uTextHW/uTextPx;
        float gx = solidParts(hp+vec3(ex,0.0,0.0), lod).x - solidParts(hp-vec3(ex,0.0,0.0), lod).x;
        float gy = solidParts(hp+vec3(0.0,ex,0.0), lod).x - solidParts(hp-vec3(0.0,ex,0.0), lod).x;
        vec3 sn = -gx*uTextR - gy*uTextU;
        float sl = length(sn);
        nOut = sl > 1e-5 ? sn/sl : uTextN*(-sign(dv.z));
      }
      return true;
    }
    prevT = t;
  }
  return false;
}

// ── Surface texture ────────────────────────────────────────────────────────
//
// All of it is SHADING: a scalar relief evaluated at the hit and turned into a
// bent normal and an albedo. None of it moves the surface the marcher sees, so
// the silhouette and the cast shadow stay exactly what solidAt says they are.

vec3 textLocal(vec3 p){
  vec3 rel = p - uTextC;
  return vec3(dot(rel,uTextR), dot(rel,uTextU), dot(rel,uTextN));
}

/**
 * Triplanar 2D noise over the slab-local frame, weighted by the local normal,
 * so a face and a side wall each get noise laid flat on them. A single plane
 * (or a fixed diagonal one) streaks: it is constant along one direction of
 * whichever surface it is not aligned with.
 */
float textTri(vec3 lp, vec3 w, float f, float seed){
  return vn2(lp.xy*f + seed)*w.z + vn2(lp.zy*f + seed + 3.1)*w.x + vn2(lp.xz*f + seed + 7.7)*w.y;
}

/**
 * Relief of the letter surface, in arbitrary units around 0.
 *   x: total relief (bumps the normal)
 *   y: pit mask, 0..1 (darkens the albedo — pits hold shadow and damp)
 * `nl` is the slab-local normal, for the triplanar weights.
 */
vec2 textRelief(vec3 lp, float worldY, vec3 nl){
  vec3 w = abs(nl); w = w*w; w /= max(w.x + w.y + w.z, 1e-4);
  // strata: near-horizontal bands, warped, in WORLD height so they lie level
  float warp = textTri(lp, w, 6.0, 0.0)*0.020 + textTri(lp, w, 19.0, 2.0)*0.006;
  float strata = sin((worldY + warp)*150.0)*0.5 + sin((worldY + warp*1.7)*390.0)*0.2;
  // broad lumps, then pitting in clusters rather than evenly sprinkled dots
  float lump = textTri(lp, w, 11.0, 5.0)*2.0 - 1.0;
  float pn = textTri(lp, w, 38.0, 1.3)*0.6 + textTri(lp, w, 90.0, 8.2)*0.4;
  float cluster = smoothstep(0.35, 0.7, textTri(lp, w, 7.0, 4.4));
  float pit = smoothstep(0.58, 0.78, pn)*cluster;
  float grit = textTri(lp, w, 420.0, 6.6) - 0.5;
  // Rocky sand: packed and wind-cut layers, lumpy, pitted where grains have
  // weathered out, and gritty all over.
  float r = strata*0.40 + lump*1.2 - pit*0.9 + grit*0.35;
  return vec2(r, pit);
}

/** Bends `N` by the relief's gradient. Fades with distance so it cannot alias. */
vec3 textBump(vec3 p, vec3 N, float t){
  vec3 lp = textLocal(p);
  vec3 nl = vec3(dot(N,uTextR), dot(N,uTextU), dot(N,uTextN));
  float h = 0.0035;
  float r0 = textRelief(lp, p.y, nl).x;
  vec3 g = vec3(
    textRelief(lp + vec3(h,0.0,0.0), p.y + h*uTextR.y, nl).x - r0,
    textRelief(lp + vec3(0.0,h,0.0), p.y + h*uTextU.y, nl).x - r0,
    textRelief(lp + vec3(0.0,0.0,h), p.y + h*uTextN.y, nl).x - r0)/h;
  vec3 gw = g.x*uTextR + g.y*uTextU + g.z*uTextN;
  gw -= N*dot(gw, N);
  float k = 0.0045*uTextTexture/(1.0 + t*0.6);
  return normalize(N - gw*k);
}

/**
 * Foam where the water meets the letters. A blurred mip of the mask says
 * "letters are near this xy", the slab-local depth says "and this point is
 * close in front of or behind them" — together that is a collar round the
 * base, without the waves needing to know the letters exist.
 */
float textCollar(vec3 p){
  if(uTextOn < 0.5) return 0.0;
  vec3 lp = textLocal(p);
  float d = abs(lp.z) - uTextTh;
  if(d > 0.09) return 0.0;
  float lod = clamp(log2(0.03/(2.0*uTextHW/uTextPx)), 0.0, 8.0);
  float m = maskAt(slabUV(lp), lod);
  return smoothstep(0.08, 0.35, m)*(1.0 - smoothstep(0.0, 0.08, max(d, 0.0)));
}
