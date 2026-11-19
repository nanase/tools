/**
 * 反復のパス（ITER_FRAG）は画素ごとの発散の速さ ν を R32F に書き、配色のパス（COLOR_FRAG）がそれを色にする。
 * uMode 0 は摂動法（基準の軌道 uRef との差 d を単精度で追い、|z| < |d| か軌道の終わりで d = z として初めへ戻す）、
 * 1 はそのままの単精度（べきが整数でないとき）、2 はジュリア集合
 */
export const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0., 1.); }`;

export const ITER_FRAG = `#version 300 es
precision highp float; precision highp int;
uniform highp sampler2D uRef;
uniform int uRefLen, uMax, uP, uMode, uInt;
uniform float uPf, uPre, uPost, uConj, uSpan, uBail;
uniform vec2 uRes, uOff, uCen, uJc;
out vec4 o;
/* |X + x| − |X| を桁落ちなしで */
float dabs(float X, float x) {
  if (X >= 0.) return (X + x >= 0.) ? x : -(2. * X + x);
  return (X + x > 0.) ? (2. * X + x) : -x;
}
vec2 cm(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 Zat(int m) { return texelFetch(uRef, ivec2(m & 4095, m >> 12), 0).xy; }
/* 差の 1 歩: (P + D)^p − P^p = D Σ (P + D)^k P^(p−1−k) */
vec2 pstep(vec2 Z, vec2 d) {
  float A = Z.x, a = d.x, B = Z.y, b = d.y;
  if (uPre > 0.) {
    a = mix(a, dabs(A, a), uPre); A = mix(A, abs(A), uPre);
    b = mix(b, dabs(B, b), uPre); B = mix(B, abs(B), uPre);
  }
  B *= uConj; b *= uConj;
  vec2 P = vec2(A, B), D = vec2(a, b), U = P + D, s = vec2(1, 0), pj = vec2(1, 0);
  for (int j = 1; j < 8; j++) { if (j >= uP) break; pj = cm(pj, P); s = cm(U, s) + pj; }
  vec2 W = cm(pj, P), w = cm(D, s);
  if (uPost > 0.) w.x = mix(w.x, dabs(W.x, w.x), uPost);
  return w;
}
vec2 fstep(vec2 z, vec2 c) {
  vec2 u = vec2(mix(z.x, abs(z.x), uPre), mix(z.y, abs(z.y), uPre) * uConj), w;
  if (uInt == 1) { w = u; for (int j = 1; j < 8; j++) { if (j >= uP) break; w = cm(w, u); } }
  else { float r = length(u), t = atan(u.y, u.x); w = r > 0. ? pow(r, uPf) * vec2(cos(uPf * t), sin(uPf * t)) : vec2(0); }
  w.x = mix(w.x, abs(w.x), uPost);
  return w + c;
}
void main() {
  /* 画面の下向きを虚軸の正にする */
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / (0.5 * min(uRes.x, uRes.y));
  uv.y = -uv.y;
  int n = 0; float r2 = 0., B2 = uBail * uBail;
  if (uMode == 0) {
    vec2 dc = uOff + uv * uSpan, d = vec2(0), z; int m = 0;
    for (n = 0; n < uMax; n++) {
      d = pstep(Zat(m), d) + dc; m++;
      z = Zat(m) + d; r2 = dot(z, z);
      if (r2 > B2) break;
      if (r2 < dot(d, d) || m >= uRefLen - 1) { d = z; m = 0; }
    }
  } else {
    vec2 z, c;
    if (uMode == 1) { z = vec2(0); c = uCen + uv * uSpan; } else { z = uCen + uv * uSpan; c = uJc; }
    for (n = 0; n < uMax; n++) { z = fstep(z, c); r2 = dot(z, z); if (r2 > B2) break; }
  }
  if (n >= uMax) { o = vec4(-1.); return; }
  o = vec4(max(float(n) + 1. - log(0.5 * log(r2) / log(uBail)) / log(uPf), 0.));
}`;

export const COLOR_FRAG = `#version 300 es
precision highp float; precision highp int;
uniform highp sampler2D uIt;
uniform vec3 uSt[8];
uniform int uN;
uniform float uDen, uOfs, uShade;
uniform vec2 uRes;
out vec4 o;
vec3 pal(float t) {
  t = fract(t) * float(uN); int i = int(floor(t)); float f = t - float(i); int j = i + 1; if (j >= uN) j = 0;
  return mix(uSt[i], uSt[j], f);
}
float h(ivec2 q, float v) { q = clamp(q, ivec2(0), ivec2(uRes) - 1); float w = texelFetch(uIt, q, 0).r; return w < 0. ? v : w; }
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy); float v = texelFetch(uIt, q, 0).r;
  if (v < 0.) { o = vec4(0, 0, 0, 1); return; }
  vec3 c = pal(log(v + 1.) * uDen + uOfs);
  if (uShade > 0.) {
    /* 隣の画素との log(ν + 1) の差を法線にして、左上から光を当てる */
    float gx = log(h(q + ivec2(1, 0), v) + 1.) - log(h(q - ivec2(1, 0), v) + 1.);
    float gy = log(h(q + ivec2(0, 1), v) + 1.) - log(h(q - ivec2(0, 1), v) + 1.);
    float l = clamp(dot(normalize(vec3(-gx, -gy, 0.02)), normalize(vec3(-0.6, 0.6, 0.55))), 0., 1.);
    c *= mix(1., 0.25 + l, uShade);
  }
  o = vec4(c, 1);
}`;
