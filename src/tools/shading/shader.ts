/**
 * シェーダ。頂点と画素の両方で同じ shade() を使い、補間の違い（フラット・グーロー・フォン）を描き分ける。
 * uMode は全体のほか、項（D・F・G など）を 1 つずつ描くのに使う
 */
import { BRDF_GLSL } from '../../lib/brdf';
import { MIN_NOL, MIN_ROUGH } from './models';

export const MODE = {
  FULL: 0,
  SPEC: 1,
  DIFF: 2,
  AMB: 3,
  NL: 4,
  RV: 5,
  NH: 6,
  D: 7,
  F: 8,
  G: 9,
} as const;
export const INTERP = { PIXEL: 0, GOURAUD: 1, FLAT: 2 } as const;

const COMMON = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
${BRDF_GLSL}
uniform int uModel, uMode, uInterp, uKind;
uniform vec3 uDiff, uF0, uKs, uLight, uLi, uEye;
uniform float uA, uRough, uNP, uNB, uAmb;
uniform bool uNorm, uMs;
uniform sampler2DArray uLut;

vec4 lutAt(float layer, float mu) {
  return texture(uLut, vec3(clamp(mu, 0.0, 1.0), (uRough - ${MIN_ROUGH.toFixed(3)}) / ${(1 - MIN_ROUGH).toFixed(3)}, layer));
}

/* フレネルの半球平均から、多重散乱の色の係数を出す */
vec3 fresnelMs(float eAvg) {
  vec3 f = uF0 + (1.0 - uF0) / 21.0;
  return f * f * eAvg / (1.0 - f * (1.0 - eAvg));
}

vec3 fSpec(float nol, float nov, float noh, float voh, float rov) {
  if (uModel == 0) return vec3(0.0);
  if (uModel == 1) {
    float p = rov > 0.0 ? pow(rov, uNP) : 0.0;
    return uKs * (uNorm ? (uNP + 2.0) / (2.0 * PI) * p : p / (PI * max(nol, ${MIN_NOL})));
  }
  if (uModel == 2) {
    float p = pow(max(noh, 1e-6), uNB);
    return uKs * (uNorm ? (uNB + 8.0) / (8.0 * PI) * p : p / (PI * max(nol, ${MIN_NOL})));
  }
  vec3 f = fSchlick(uF0, voh) * dGGX(uA, noh) * g2Smith(uA, nov, nol) / (4.0 * nov * nol);
  if (uMs) {
    vec4 o = lutAt(2.0, nov), i = lutAt(2.0, nol);
    f += fresnelMs(o.b) * (1.0 - o.r - o.g) * (1.0 - i.r - i.g) / (PI * max(1.0 - o.b, 1e-4));
  }
  return f;
}

/* 一様な環境光のもとでの鏡面の反射率（視線の余弦 nov の関数） */
vec3 ambSpec(float nov) {
  if (uModel == 0) return vec3(0.0);
  if (uModel == 1) return uKs * lutAt(0.0, nov).r;
  if (uModel == 2) return uKs * lutAt(1.0, nov).r;
  vec4 t = lutAt(2.0, nov);
  vec3 f = uF0 * t.r + t.g;
  if (uMs) f += fresnelMs(t.b) * (1.0 - t.r - t.g);
  return f;
}

vec3 shade(vec3 P, vec3 N) {
  vec3 V = normalize(uEye - P), L = uLight, Li = uLi;
  if (uKind == 1) {
    vec3 d = uLight - P;
    float r2 = dot(d, d);
    L = d / sqrt(r2);
    Li = uLi * dot(uLight, uLight) / r2;
  }
  vec3 H = normalize(V + L);
  float nolS = dot(N, L), nol = max(nolS, 1e-3), nov = max(dot(N, V), 1e-3);
  float noh = clamp(dot(N, H), 0.0, 1.0), voh = clamp(dot(V, H), 0.0, 1.0);
  float rov = 2.0 * nolS * dot(N, V) - dot(L, V);
  float on = nolS > 0.0 && dot(N, V) > 0.0 ? 1.0 : 0.0;
  if (uMode == ${MODE.NL}) return vec3(max(nolS, 0.0));
  if (uMode == ${MODE.RV}) return vec3(rov > 0.0 ? pow(rov, uNP) * on : 0.0);
  if (uMode == ${MODE.NH}) return vec3(pow(max(noh, 1e-6), uNB) * on);
  if (uMode == ${MODE.D}) return vec3(dGGX(uA, noh) / dGGX(uA, 1.0) * on);
  if (uMode == ${MODE.F}) return fSchlick(uF0, voh);
  if (uMode == ${MODE.G}) return vec3(g2Smith(uA, nov, nol) * on);
  vec3 c = vec3(0.0);
  if (uMode == ${MODE.FULL} || uMode == ${MODE.DIFF}) c += uDiff * Li * max(nolS, 0.0);
  if (uMode == ${MODE.FULL} || uMode == ${MODE.SPEC}) c += fSpec(nol, nov, noh, voh, rov) * PI * Li * max(nolS, 0.0) * on;
  if (uMode == ${MODE.FULL} || uMode == ${MODE.AMB}) c += uAmb * (uDiff + ambSpec(nov));
  return c;
}
`;

export const VERT = `${COMMON}
uniform float uT, uK;
in vec3 aP, aN, aFP, aFN;
out vec3 vP;
out vec3 vN;
out vec3 vC;
flat out vec3 vF;
void main() {
  vec3 c = aP - uEye;
  float w = -c.z, n = 0.05, f = 400.0;
  gl_Position = vec4(c.x / uT, (c.y + uK * w) / uT, (f + n) / (n - f) * c.z + 2.0 * f * n / (n - f), w);
  vP = aP;
  vN = aN;
  vC = uInterp == ${INTERP.GOURAUD} ? shade(aP, aN) : vec3(0.0);
  vF = uInterp == ${INTERP.FLAT} ? shade(aFP, aFN) : vec3(0.0);
}
`;

export const FRAG = `${COMMON}
uniform int uTone;
in vec3 vP;
in vec3 vN;
in vec3 vC;
flat in vec3 vF;
out vec4 outC;

vec3 srgb(vec3 x) {
  x = clamp(x, 0.0, 1.0);
  return mix(12.92 * x, 1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, x));
}

/* 0.8 までは線形のまま、その上をなだらかに 1 へ寄せる（ハイライトの形を残す） */
vec3 shoulder(vec3 v) {
  return mix(v, 0.8 + 0.2 * (1.0 - exp(-(v - 0.8) / 0.2)), step(0.8, v));
}

void main() {
  vec3 c = uInterp == ${INTERP.FLAT} ? vF : uInterp == ${INTERP.GOURAUD} ? vC : shade(vP, normalize(vN));
  if (uTone == 1) c = shoulder(c);
  /* 床の地平線を黒へ落とす */
  if (uEye.y > 0.0) c *= clamp(normalize(uEye - vP).y * 80.0, 0.0, 1.0);
  outC = vec4(srgb(c), 1.0);
}
`;
