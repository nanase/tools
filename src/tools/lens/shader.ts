/**
 * 描画のシェーダ（GLSL ES 3.00 の文字列）。1 回の描画で画素ごとに uSpp 本の光線を、センサーの点から
 * 射出瞳の面の点へ向けて出し、レンズの面を後ろから順に屈折させて（波長ごとの屈折率）物体側へ出し、
 * 被写体と交差させた放射輝度を足していく。前の回までの和に足して返し、表示のシェーダが平均を出す
 */
import { sceneGlsl } from './scene';

/** 瞳の範囲の表の行数（analysis.ts の pupilTable と同じ） */
export const NP = 24;

/** 標本の 7 次元の低食い違い列（Roberts の R7 列、2^32 倍の整数） */
const R7 = [3915259345, 3569120481, 3253582939, 2965941329, 2703729436, 2464699080, 2246800835];

export const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/** 面が ns 枚のレンズの光線追跡のシェーダ */
export function traceFrag(ns: number): string {
  return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
#define NS ${ns}
#define NP ${NP}
uniform sampler2D uPrev;
uniform int uReset;
/* 面: z・曲率・有効半径・絞り（1）。面の後ろの媒質: Sellmeier の B1〜B3 と倍率 k、C1〜C3 と足す値 */
uniform vec4 uS[NS];
uniform vec4 uB[NS];
uniform vec4 uC[NS];
/* 瞳の範囲の表: 中心の x・半幅 x・半幅 y */
uniform vec4 uP[NP];
uniform float uHmax;
/* センサーの z、射出瞳の面の z、正規化 1/(π r²)、回折の実効 F 値（0 は入れない） */
uniform vec4 uOpt;
/* 絞り: 外接円の半径・羽根の枚数・cos(π/n) */
uniform vec3 uStop;
/* センサーの上の描く範囲（表示の向き、mm）: 左下 x・y、幅・高さ */
uniform vec4 uView;
uniform vec2 uRes;
uniform uint uBase;
uniform int uSpp;
uniform vec3 uRight, uUp, uFwd, uEye;
/* 0: 処方どおり、1: 収差なしの薄いレンズ（像距離・物体距離（0 は無限遠）・半径・外接円の半径） */
uniform int uMode;
uniform vec4 uIdeal;
uniform float uChrom;
out vec4 outColor;
${sceneGlsl()}
const float LD = 0.5875618;
const float PI = 3.14159265;

/* 波長 [µm] から RGB への重み（平均が 1） */
vec3 wrgb(float l) {
  vec3 c = vec3(0.6, 0.545, 0.455), s = vec3(0.04, 0.035, 0.03), k = vec3(3.0107638, 3.4195801, 4.1271732);
  vec3 x = (vec3(l) - c) / s;
  return k * exp(-0.5 * x * x);
}

float nMed(int i, float l) {
  vec4 b = uB[i], c = uC[i];
  if (b.x == 0.0 && b.y == 0.0 && b.z == 0.0) return 1.0;
  float l2 = l * l;
  return b.w * sqrt(1.0 + b.x * l2 / (l2 - c.x) + b.y * l2 / (l2 - c.y) + b.z * l2 / (l2 - c.z)) + c.w;
}

bool inStop(vec2 p, vec3 s) {
  float rho = length(p);
  if (s.y < 3.0) return rho <= s.x;
  float w = 2.0 * PI / s.y;
  float a = atan(p.y, p.x) - 0.5 * PI;
  a = a - floor(a / w) * w - 0.5 * w;
  return rho * cos(a) <= s.x * s.z;
}

/* 頂点 zv・曲率 c の球面との交点（頂点の接平面へ進めてから、平面に続く根） */
bool hitS(inout vec3 o, vec3 d, float zv, float c) {
  float t0 = (zv - o.z) / d.z;
  vec2 p0 = o.xy + d.xy * t0;
  float B = c * dot(p0, d.xy) - d.z, C = c * dot(p0, p0);
  float disc = B * B - c * C;
  if (disc < 0.0) return false;
  float den = B + (B >= 0.0 ? 1.0 : -1.0) * sqrt(disc);
  if (den == 0.0) return false;
  o += d * (t0 - C / den);
  return true;
}

bool refr(inout vec3 d, vec3 o, float zv, float c, float n1, float n2) {
  if (n1 == n2) return true;
  vec3 nr = normalize(vec3(-c * o.x, -c * o.y, 1.0 - c * (o.z - zv)));
  float ci = dot(nr, d);
  if (ci < 0.0) { nr = -nr; ci = -ci; }
  float eta = n1 / n2, k = 1.0 - eta * eta * (1.0 - ci * ci);
  if (k < 0.0) return false;
  d = eta * d + (sqrt(k) - eta * ci) * nr;
  return true;
}

uint hashu(uint x) {
  x ^= x >> 16; x *= 0x7feb352dU; x ^= x >> 15; x *= 0x846ca68bU; x ^= x >> 16;
  return x;
}
float rq(uint n, uint a, float s) { return fract(s + float(n * a) * 2.3283064e-10); }

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec4 prev = uReset == 1 ? vec4(0.0) : texelFetch(uPrev, px, 0);
  uint seed = hashu(uint(px.x) * 1973U + uint(px.y) * 9277U + 26699U);
  float sd[7];
  for (int j = 0; j < 7; j++) sd[j] = float(hashu(seed + uint(j) * 0x9E3779B9U)) * 2.3283064e-10;
  vec3 sum = vec3(0.0);
  for (int k = 0; k < uSpp; k++) {
    uint n = uBase + uint(k);
    vec2 uj = vec2(rq(n, ${R7[0]}U, sd[0]), rq(n, ${R7[1]}U, sd[1]));
    vec2 up = vec2(rq(n, ${R7[2]}U, sd[2]), rq(n, ${R7[3]}U, sd[3]));
    float lam = 0.4 + 0.3 * rq(n, ${R7[4]}U, sd[4]);
    vec2 ud = vec2(rq(n, ${R7[5]}U, sd[5]), rq(n, ${R7[6]}U, sd[6]));
    vec2 p = uView.xy + (floor(gl_FragCoord.xy) + uj) / uRes * uView.zw;
    if (uOpt.w > 0.0) {
      /* 回折: 像の点を、エアリー円盤に近いガウス分布（σ = 0.42 λ N）でずらす */
      float sg = 0.42 * lam * 1e-3 * uOpt.w;
      p += sg * sqrt(-2.0 * log(1.0 - ud.x)) * vec2(cos(2.0 * PI * ud.y), sin(2.0 * PI * ud.y));
    }
    vec3 wc = wrgb(lam);
    float lc = uChrom > 0.5 ? lam : LD;
    vec3 o, d;
    float w;
    if (uMode == 0) {
      vec3 S = vec3(-p, uOpt.x);
      float h = length(S.xy);
      vec2 er = h > 1e-6 ? S.xy / h : vec2(1.0, 0.0);
      float fi = clamp(h / uHmax, 0.0, 1.0) * float(NP - 1);
      int i0 = int(floor(fi));
      vec3 tb = mix(uP[i0].xyz, uP[min(i0 + 1, NP - 1)].xyz, fi - float(i0));
      if (tb.y <= 0.0 || tb.z <= 0.0) continue;
      vec2 q2 = vec2(tb.x + tb.y * (2.0 * up.x - 1.0), tb.z * (2.0 * up.y - 1.0));
      vec3 Q = vec3(er * q2.x + vec2(-er.y, er.x) * q2.y, uOpt.y);
      d = normalize(Q - S);
      w = pow(abs(d.z), 4.0) * 4.0 * tb.y * tb.z * uOpt.z;
      o = S;
      bool ok = true;
      float n2 = 1.0;
      for (int i = NS - 1; i >= 0; i--) {
        vec4 s = uS[i];
        if (!hitS(o, d, s.x, s.y)) { ok = false; break; }
        if (s.w > 0.5 ? !inStop(o.xy, uStop) : dot(o.xy, o.xy) > s.z * s.z) { ok = false; break; }
        float n1 = i > 0 ? nMed(i - 1, lc) : 1.0;
        if (!refr(d, o, s.x, s.y, n2, n1)) { ok = false; break; }
        n2 = n1;
      }
      if (!ok) continue;
      /* レンズの座標（z がセンサーへ向かう）から撮影者の座標（z が前）へ */
      o = vec3(o.xy, uOpt.x - o.z);
      d = vec3(d.xy, -d.z);
    } else {
      vec2 a = (2.0 * up - 1.0) * uIdeal.w;
      if (!inStop(a, vec3(uIdeal.w, uStop.yz))) continue;
      vec3 L = vec3(a, uIdeal.x), S = vec3(-p, 0.0);
      vec3 di = normalize(L - S);
      w = pow(di.z, 4.0) * 4.0 * uIdeal.w * uIdeal.w / (PI * uIdeal.z * uIdeal.z);
      o = L;
      d = uIdeal.y > 0.0 ? normalize(vec3(p * uIdeal.y / uIdeal.x, uIdeal.x + uIdeal.y) - L) : normalize(vec3(p / uIdeal.x, 1.0));
    }
    vec3 ro = uEye + (uRight * o.x + uUp * o.y + uFwd * o.z) * 1e-3;
    vec3 rd = normalize(uRight * d.x + uUp * d.y + uFwd * d.z);
    sum += radiance(ro, rd) * wc * w;
  }
  outColor = prev + vec4(sum, float(uSpp));
}
`;
}

/** 表示: 平均を出し、露出・明るい所の圧縮・sRGB の階調にする */
export const DISPLAY_FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uAcc;
uniform vec2 uSrc;
uniform vec2 uDst;
uniform float uExp;
out vec4 outColor;
vec3 at(ivec2 p) {
  vec4 a = texelFetch(uAcc, clamp(p, ivec2(0), ivec2(uSrc) - 1), 0);
  return a.a > 0.0 ? a.rgb / a.a : vec3(0.0);
}
vec3 tone(vec3 x) {
  return mix(x, 0.8 + 0.2 * (1.0 - exp(-(x - 0.8) / 0.2)), step(0.8, x));
}
vec3 srgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec2 uv = gl_FragCoord.xy / uDst * uSrc - 0.5;
  ivec2 i = ivec2(floor(uv));
  vec2 f = fract(uv);
  vec3 c = mix(mix(at(i), at(i + ivec2(1, 0)), f.x), mix(at(i + ivec2(0, 1)), at(i + ivec2(1, 1)), f.x), f.y);
  outColor = vec4(srgb(tone(c * uExp)), 1.0);
}
`;
