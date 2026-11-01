/**
 * パストレーシングのシェーダ（GLSL ES 3.00 の文字列）。1 回の描画で画素ごとに uSpp 本の経路を追い、
 * 前の回までの和に足して返す。出力の 0 番は全サンプルの和、1 番は偶数番のサンプルだけの和で、
 * 2 つの半分の差から誤差を見積もる
 */
import { BRDF_GLSL } from '../../lib/brdf';
import { MAX_MATS, MAX_QUADS, MAX_SPHERES } from './scene';

/** 積分のやり方（uInteg） */
export const INTEG = { BRDF: 0, NEE: 1, MIS: 2, WHITTED: 3 } as const;

export const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const TRACE_FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uPrevA;
uniform sampler2D uPrevB;
uniform int uReset;
uniform vec4 uTile;
uniform uint uBase;
uniform int uSpp;
uniform int uSeed;
uniform vec3 uEye, uRight, uUp, uFwd;
uniform vec2 uLens;
uniform int uInteg, uMinB, uMaxB, uRR;
uniform vec4 uQuad[${MAX_QUADS * 4}];
uniform vec4 uSph[${MAX_SPHERES * 2}];
uniform vec4 uMat[${MAX_MATS * 3}];
/* 光源: 位置と面積（半径）、四角の辺 2 本、向きと材質の番号 */
uniform vec4 uLit[4];
uniform vec3 uLitE;
uniform int uLitK;
uniform int uNQ, uNS;
layout(location = 0) out vec4 outA;
layout(location = 1) out vec4 outB;
${BRDF_GLSL}

uint rngS;
/* PCG（RXS-M-XS） */
float rnd() {
  rngS = rngS * 747796405U + 2891336453U;
  uint w = ((rngS >> ((rngS >> 28U) + 4U)) ^ rngS) * 277803737U;
  w = (w >> 22U) ^ w;
  return float(w >> 8U) * (1.0 / 16777216.0);
}
uint hashu(uint x) {
  x ^= x >> 16; x *= 0x7feb352dU; x ^= x >> 15; x *= 0x846ca68bU; x ^= x >> 16;
  return x;
}

/* いちばん近い交点。t・法線（光線に向ける）・材質・表か裏か */
float hT; vec3 hN; int hM; bool hFront;
bool hitScene(vec3 o, vec3 d) {
  hT = 1e6;
  bool found = false;
  for (int i = 0; i < uNQ; i++) {
    int k = i * 4;
    vec4 N = uQuad[k + 3];
    float den = dot(N.xyz, d);
    if (abs(den) < 1e-7) continue;
    float t = (N.w - dot(N.xyz, o)) / den;
    if (t <= 1e-4 || t >= hT) continue;
    vec3 q = o + d * t - uQuad[k].xyz;
    float a = dot(q, uQuad[k + 1].xyz), b = dot(q, uQuad[k + 2].xyz);
    if (a < 0.0 || a > 1.0 || b < 0.0 || b > 1.0) continue;
    hT = t;
    hFront = den < 0.0;
    hN = hFront ? N.xyz : -N.xyz;
    hM = int(uQuad[k].w);
    found = true;
  }
  for (int i = 0; i < uNS; i++) {
    vec4 S = uSph[i * 2];
    vec3 oc = o - S.xyz;
    float b = dot(oc, d), c = dot(oc, oc) - S.w * S.w, h = b * b - c;
    if (h < 0.0) continue;
    h = sqrt(h);
    float t = -b - h;
    if (t <= 1e-4) t = -b + h;
    if (t <= 1e-4 || t >= hT) continue;
    hT = t;
    vec3 n = (oc + d * t) / S.w;
    hFront = dot(n, d) < 0.0;
    hN = hFront ? n : -n;
    hM = int(uSph[i * 2 + 1].x);
    found = true;
  }
  return found;
}

/* 影の光線。光源そのものは遮るものに数えない */
bool occluded(vec3 o, vec3 d, float tMax) {
  int lm = int(uLit[3].w);
  for (int i = 0; i < uNQ; i++) {
    int k = i * 4;
    if (int(uQuad[k].w) == lm) continue;
    vec4 N = uQuad[k + 3];
    float den = dot(N.xyz, d);
    if (abs(den) < 1e-7) continue;
    float t = (N.w - dot(N.xyz, o)) / den;
    if (t <= 1e-4 || t >= tMax) continue;
    vec3 q = o + d * t - uQuad[k].xyz;
    float a = dot(q, uQuad[k + 1].xyz), b = dot(q, uQuad[k + 2].xyz);
    if (a < 0.0 || a > 1.0 || b < 0.0 || b > 1.0) continue;
    return true;
  }
  for (int i = 0; i < uNS; i++) {
    if (int(uSph[i * 2 + 1].x) == lm) continue;
    vec4 S = uSph[i * 2];
    vec3 oc = o - S.xyz;
    float b = dot(oc, d), c = dot(oc, oc) - S.w * S.w, h = b * b - c;
    if (h < 0.0) continue;
    h = sqrt(h);
    float t = -b - h;
    if (t <= 1e-4) t = -b + h;
    if (t > 1e-4 && t < tMax) return true;
  }
  return false;
}

/* 法線 n を z とする正規直交の基底（Duff ら 2017） */
void basis(vec3 n, out vec3 t, out vec3 b) {
  float s = n.z >= 0.0 ? 1.0 : -1.0, a = -1.0 / (s + n.z), c = n.x * n.y * a;
  t = vec3(1.0 + s * n.x * n.x * a, s * c, -s * n.x);
  b = vec3(c, s + n.y * n.y * a, -n.y);
}

/* 点 o から見た球の光源の円錐の中の一様な確率密度 */
float conePdf(vec3 o) {
  vec3 w = uLit[0].xyz - o;
  float sin2 = uLit[0].w * uLit[0].w / dot(w, w);
  float cosM = sqrt(max(0.0, 1.0 - sin2));
  return 1.0 / (2.0 * PI * max(1.0 - cosM, 1e-7));
}

/* BRDF のサンプリングで光源に当たったときの、光源のサンプリングの確率密度（立体角） */
float hitLightPdf(vec3 o, vec3 d, vec3 n) {
  if (uLitK == 1) return conePdf(o);
  return hT * hT / (uLit[0].w * max(dot(n, -d), 1e-6));
}

/* 光源へ向かう方向を選ぶ。w: 方向、dist: 影の光線の長さ、Le: 届く放射輝度、pl: 確率密度。delta は 1 点だけを見るとき */
bool sampleLight(vec3 o, vec3 n, out vec3 w, out float dist, out vec3 Le, out float pl, out bool delta) {
  bool wh = uInteg == 3;
  Le = uLitE;
  delta = wh;
  if (uLitK == 0) {
    vec2 u = wh ? vec2(0.5) : vec2(rnd(), rnd());
    vec3 lp = uLit[0].xyz + uLit[1].xyz * u.x + uLit[2].xyz * u.y;
    w = lp - o;
    float r2 = dot(w, w), r = sqrt(r2);
    w /= r;
    float cosL = dot(-w, uLit[3].xyz);
    if (cosL <= 0.0) return false;
    dist = r - 1e-3;
    pl = r2 / (uLit[0].w * cosL);
  } else if (uLitK == 1) {
    vec3 c = uLit[0].xyz - o;
    float d2 = dot(c, c), d = sqrt(d2), ra = uLit[0].w;
    if (d <= ra) return false;
    vec3 a = c / d;
    if (wh) {
      w = a;
      dist = d - ra - 1e-3;
      pl = d2 / (PI * ra * ra);
    } else {
      float cosM = sqrt(max(0.0, 1.0 - ra * ra / d2));
      float cosT = 1.0 - rnd() * (1.0 - cosM), sinT = sqrt(max(0.0, 1.0 - cosT * cosT)), ph = 2.0 * PI * rnd();
      vec3 tx, ty;
      basis(a, tx, ty);
      w = normalize(tx * sinT * cos(ph) + ty * sinT * sin(ph) + a * cosT);
      dist = d * cosT - sqrt(max(0.0, ra * ra - d2 * sinT * sinT)) - 1e-3;
      pl = 1.0 / (2.0 * PI * max(1.0 - cosM, 1e-7));
    }
  } else if (uLitK == 2) {
    w = uLit[0].xyz - o;
    float r2 = dot(w, w), r = sqrt(r2);
    w /= r;
    dist = r - 1e-3;
    Le = uLitE / r2;
    pl = 1.0;
    delta = true;
  } else {
    if (wh) {
      /* 一様な環境光（影の光線は飛ばさない） */
      w = n;
      pl = 1.0 / PI;
      dist = 1e-3;
      return true;
    } else {
      float z = 1.0 - 2.0 * rnd(), s = sqrt(max(0.0, 1.0 - z * z)), ph = 2.0 * PI * rnd();
      w = vec3(s * cos(ph), s * sin(ph), z);
      pl = 1.0 / (4.0 * PI);
    }
    dist = 1e6;
  }
  return true;
}

vec3 pathRadiance(vec3 o, vec3 d) {
  vec3 L = vec3(0.0), T = vec3(1.0);
  float pdfPrev = 0.0;
  bool deltaPrev = true;
  for (int b = 0; b <= uMaxB; b++) {
    if (!hitScene(o, d)) {
      if (uLitK == 3 && b >= uMinB) {
        float w = 1.0;
        if (!deltaPrev) {
          if (uInteg == 1 || uInteg == 3) w = 0.0;
          else if (uInteg == 2) w = pdfPrev / (pdfPrev + 1.0 / (4.0 * PI));
        }
        L += T * uLitE * w;
      }
      break;
    }
    vec3 p = o + d * hT, n = hN;
    int k = hM * 3;
    vec4 m0 = uMat[k], m1 = uMat[k + 1], m2 = uMat[k + 2];
    int kind = int(m2.z);
    if (kind == 2) {
      if (hFront && b >= uMinB) {
        float w = 1.0;
        if (!deltaPrev) {
          if (uInteg == 1 || uInteg == 3) w = 0.0;
          else if (uInteg == 2) w = pdfPrev / (pdfPrev + hitLightPdf(o, d, n));
        }
        L += T * m1.rgb * w;
      }
      break;
    }
    if (b == uMaxB) break;
    if (kind == 1) {
      float eta = hFront ? 1.0 / m2.y : m2.y, c = dot(-d, n);
      if (rnd() < fDielectric(c, eta)) {
        d = reflect(d, n);
        o = p + n * 2e-4;
      } else {
        d = refract(d, n, eta);
        o = p - n * 2e-4;
        T *= m0.rgb;
      }
      deltaPrev = true;
      continue;
    }
    /* ウィッテッド式では粗い金属も鏡にする */
    Surf s = Surf(m0.rgb, m0.a, uInteg == 3 ? 0.0 : m1.a, m2.x);
    vec3 tx, ty;
    basis(n, tx, ty);
    vec3 V = vec3(dot(-d, tx), dot(-d, ty), dot(-d, n));
    o = p + n * 2e-4;
    if (uInteg != 0 && b + 1 >= uMinB) {
      vec3 w, Le;
      float dist, pl;
      bool delta;
      if (sampleLight(o, n, w, dist, Le, pl, delta)) {
        float cosS = dot(w, n);
        if (cosS > 0.0 && !occluded(o, w, dist)) {
          vec3 Lz = vec3(dot(w, tx), dot(w, ty), cosS);
          float mw = uInteg == 2 && !delta ? pl / (pl + surfPdf(s, V, Lz)) : 1.0;
          L += T * surfEval(s, V, Lz) * cosS * Le * mw / pl;
        }
      }
    }
    /* 次の方向 */
    float ps = surfPSpec(s, V.z);
    bool spec = rnd() < ps;
    vec2 u2 = vec2(rnd(), rnd());
    vec3 Lz;
    if (spec && s.a < DELTA_ALPHA) {
      Lz = vec3(-V.x, -V.y, V.z);
      T *= fSchlick(surfF0(s), V.z) / ps;
      deltaPrev = true;
      pdfPrev = 0.0;
    } else {
      if (uInteg == 3) break;
      Lz = spec ? reflect(-V, sampleVndf(V, s.a, u2)) : sampleCos(u2);
      if (Lz.z <= 0.0) break;
      float pdf = surfPdf(s, V, Lz);
      if (pdf <= 0.0) break;
      T *= surfEval(s, V, Lz) * Lz.z / pdf;
      deltaPrev = false;
      pdfPrev = pdf;
    }
    d = normalize(tx * Lz.x + ty * Lz.y + n * Lz.z);
    /* ロシアンルーレット */
    if (uRR == 1 && b >= 2) {
      float q = clamp(max(T.r, max(T.g, T.b)), 0.05, 1.0);
      if (rnd() >= q) break;
      T /= q;
    }
  }
  return L;
}

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec4 pa = uReset == 1 ? vec4(0.0) : texelFetch(uPrevA, px, 0);
  vec4 pb = uReset == 1 ? vec4(0.0) : texelFetch(uPrevB, px, 0);
  uint seed = hashu(uint(px.x) * 1973U + uint(px.y) * 9277U + uint(uSeed) * 26699U);
  vec4 sA = vec4(0.0), sB = vec4(0.0);
  vec2 lc = gl_FragCoord.xy - uTile.xy;
  for (int k = 0; k < uSpp; k++) {
    uint n = uBase + uint(k);
    rngS = hashu(seed + n);
    vec2 j = vec2(rnd(), rnd());
    vec2 uv = (floor(lc) + j) / uTile.zw * 2.0 - 1.0;
    vec3 dir = normalize(uFwd + uRight * uv.x + uUp * uv.y);
    vec3 o = uEye;
    if (uLens.x > 0.0) {
      vec2 u = vec2(rnd(), rnd());
      float r = uLens.x * sqrt(u.x), ph = 2.0 * PI * u.y;
      vec3 F = uEye + dir * (uLens.y / dot(dir, uFwd));
      o = uEye + (normalize(uRight) * cos(ph) + normalize(uUp) * sin(ph)) * r;
      dir = normalize(F - o);
    }
    vec3 c = pathRadiance(o, dir);
    if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
    sA += vec4(c, 1.0);
    if ((n & 1U) == 0U) sB += vec4(c, 1.0);
  }
  outA = pa + sA;
  outB = pb + sB;
}
`;

/** 表示: 平均を出し、明るい所の圧縮・sRGB の階調にする */
export const DISPLAY_FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uAcc;
out vec4 outColor;
vec3 tone(vec3 x) {
  return mix(x, 0.8 + 0.2 * (1.0 - exp(-(x - 0.8) / 0.2)), step(0.8, x));
}
vec3 srgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec4 a = texelFetch(uAcc, ivec2(gl_FragCoord.xy), 0);
  vec3 c = a.a > 0.0 ? a.rgb / a.a : vec3(0.0);
  outColor = vec4(srgb(tone(c)), 1.0);
}
`;

/** 2 つの半分の差の 2 乗（r）と輝度（g）を 4 画素おきに書き出す */
export const DIFF_FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uA;
uniform sampler2D uB;
uniform vec4 uTile;
uniform int uStep;
out vec4 outColor;
void main() {
  ivec2 p = ivec2(uTile.xy) + ivec2(gl_FragCoord.xy) * uStep;
  vec4 a = texelFetch(uA, p, 0), e = texelFetch(uB, p, 0);
  vec3 o = a.rgb - e.rgb;
  float ne = max(e.a, 1.0), no = max(a.a - e.a, 1.0);
  vec3 d = e.rgb / ne - o / no;
  outColor = vec4(dot(d, d) / 3.0, dot(a.rgb / max(a.a, 1.0), vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
}
`;
