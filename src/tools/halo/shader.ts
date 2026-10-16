/**
 * ハロのページのシェーダ: 光線の追跡（頂点シェーダで 1 点 = 1 光線）、空と雲の照らされ方の表（大気の単散乱）、
 * 表示（投影し直して合成）。座標は z が天頂、光源（太陽か月）は方位 0（+x）
 */
import { MAX_POP } from './scene';

/** 追跡: 結晶 1 個（錐面つきの六角柱、平面 20 枚まで）を通し、確率 p2 で 2 個目の結晶にも通す */
export const TRACE_VERT = `#version 300 es
precision highp float;
precision highp int;
uniform uint uSeed;
uniform int uNPop;
/* 姿勢・傾き [rad]・回転 [rad]・回折の径 [µm] */
uniform vec4 uPopA[${MAX_POP}];
/* 選ぶ確率の累積・外接球の半径・底面までの距離・側面までの距離 */
uniform vec4 uPopB[${MAX_POP}];
/* 錐面までの距離・錐面の有無（平面の数） */
uniform vec4 uPopC[${MAX_POP}];
uniform float uElev;
uniform float uSrcR;
uniform float uP2;
uniform vec3 uNorm;
flat out vec3 vCol;

const float PI = 3.14159265358979;
const float ST = 0.8829476, CT = 0.4694716;
const vec3 NRM[20] = vec3[20](vec3(0.0, 0.0, 1.0), vec3(0.0, 0.0, -1.0),
  vec3(1.0, 0.0, 0.0), vec3(0.5, 0.8660254, 0.0), vec3(-0.5, 0.8660254, 0.0), vec3(-1.0, 0.0, 0.0), vec3(-0.5, -0.8660254, 0.0), vec3(0.5, -0.8660254, 0.0),
  vec3(ST, 0.0, CT), vec3(0.5 * ST, 0.8660254 * ST, CT), vec3(-0.5 * ST, 0.8660254 * ST, CT), vec3(-ST, 0.0, CT), vec3(-0.5 * ST, -0.8660254 * ST, CT), vec3(0.5 * ST, -0.8660254 * ST, CT),
  vec3(ST, 0.0, -CT), vec3(0.5 * ST, 0.8660254 * ST, -CT), vec3(-0.5 * ST, 0.8660254 * ST, -CT), vec3(-ST, 0.0, -CT), vec3(-0.5 * ST, -0.8660254 * ST, -CT), vec3(0.5 * ST, -0.8660254 * ST, -CT));

uint st;
uint pcg() {
  st = st * 747796405u + 2891336453u;
  uint w = ((st >> ((st >> 28u) + 4u)) ^ st) * 277803737u;
  return (w >> 22u) ^ w;
}
float rnd() { return float(pcg() >> 8u) * (1.0 / 16777216.0); }
float gauss() { return sqrt(-2.0 * log(1.0 - rnd())) * cos(2.0 * PI * rnd()); }

mat3 rz(float t) { float c = cos(t), s = sin(t); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
mat3 ry(float t) { float c = cos(t), s = sin(t); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rx(float t) { float c = cos(t), s = sin(t); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }

/* 姿勢（結晶 → 世界）: 0 ランダム、1 板、2 柱、3 Parry、4 Lowitz */
mat3 orient(vec4 a) {
  int o = int(a.x + 0.5);
  float tw = 2.0 * PI;
  if (o == 0) {
    float u1 = rnd(), u2 = tw * rnd(), u3 = tw * rnd(), p = sqrt(1.0 - u1), q = sqrt(u1);
    float x = p * sin(u2), y = p * cos(u2), z = q * sin(u3), w = q * cos(u3);
    return transpose(mat3(1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y - z * w), 2.0 * (x * z + y * w),
      2.0 * (x * y + z * w), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z - x * w),
      2.0 * (x * z - y * w), 2.0 * (y * z + x * w), 1.0 - 2.0 * (x * x + y * y)));
  }
  if (o == 1) {
    float th = min(a.y * sqrt(-2.0 * log(1.0 - rnd())), 0.5 * PI);
    return rz(tw * rnd()) * rx(th) * rz(tw * rnd());
  }
  if (o == 2 || o == 3) {
    float el = a.y * gauss(), psi = o == 3 ? a.z * gauss() : tw * rnd();
    return rz(tw * rnd()) * ry(-el) * ry(0.5 * PI) * rz(psi);
  }
  float al = a.z > 1.5 ? tw * rnd() : a.z * gauss(), th = a.y * sqrt(-2.0 * log(1.0 - rnd())), ph = tw * rnd();
  return rz(tw * rnd()) * (rz(ph) * rx(th) * rz(-ph)) * ry(al);
}

float fresnel(float ci, float eta) {
  float s2 = eta * eta * (1.0 - ci * ci);
  if (s2 >= 1.0) return 1.0;
  float ct = sqrt(1.0 - s2), rs = (eta * ci - ct) / (eta * ci + ct), rp = (eta * ct - ci) / (eta * ct + ci);
  return 0.5 * (rs * rs + rp * rp);
}

int pick() {
  float q = rnd();
  int k = 0;
  for (int i = 0; i < ${MAX_POP} - 1; i++) if (i < uNPop - 1 && uPopB[i].x < q) k = i + 1;
  return k;
}

/* 母集団 k の結晶 1 個に、進む向き dw（世界の座標）の光を通す。当たって出れば dw を出ていく向きにして true */
bool through(int k, inout vec3 dw, float n) {
  vec4 B = uPopB[k], C = uPopC[k];
  int np = C.y > 0.5 ? 20 : 8;
  float H[20];
  H[0] = B.z;
  H[1] = B.z;
  for (int i = 2; i < 8; i++) H[i] = B.w;
  for (int i = 8; i < 20; i++) H[i] = C.x;
  mat3 M = orient(uPopA[k]);
  vec3 d = transpose(M) * dw;
  float rb = B.y;
  vec3 ax = abs(d.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 u = normalize(cross(ax, d)), v = cross(d, u);
  float rr = rb * sqrt(rnd()), pp = 2.0 * PI * rnd();
  vec3 p = rr * cos(pp) * u + rr * sin(pp) * v - 2.0 * rb * d;
  float t0 = -1e30, t1 = 1e30;
  int f0 = -1;
  bool miss = false;
  for (int i = 0; i < 20; i++) {
    if (i < np) {
      float dn = dot(NRM[i], d), num = H[i] - dot(NRM[i], p);
      if (dn < 0.0) {
        float t = num / dn;
        if (t > t0) { t0 = t; f0 = i; }
      } else if (dn > 0.0) t1 = min(t1, num / dn);
      else if (num < 0.0) miss = true;
    }
  }
  if (miss || f0 < 0 || t0 >= t1) return false;
  p += t0 * d;
  vec3 N = NRM[f0];
  float ci = -dot(N, d), eta = 1.0 / n;
  if (rnd() < fresnel(ci, eta)) {
    dw = M * (d + 2.0 * ci * N);
    return true;
  }
  float ct = sqrt(1.0 - eta * eta * (1.0 - ci * ci));
  d = eta * d + (eta * ci - ct) * N;
  int cur = f0;
  bool done = false, ok = false;
  for (int b = 0; b < 17; b++) {
    if (done) break;
    float tm = 1e30;
    int fm = -1;
    for (int i = 0; i < 20; i++) {
      if (i < np && i != cur) {
        float dn = dot(NRM[i], d);
        if (dn > 0.0) {
          float t = (H[i] - dot(NRM[i], p)) / dn;
          if (t < tm) { tm = t; fm = i; }
        }
      }
    }
    if (fm < 0) {
      done = true;
    } else {
      p += tm * d;
      cur = fm;
      N = NRM[fm];
      ci = dot(N, d);
      if (rnd() >= fresnel(ci, n)) {
        float c2 = sqrt(1.0 - n * n * (1.0 - ci * ci));
        dw = M * (n * d + (c2 - n * ci) * N);
        ok = true;
        done = true;
      } else d -= 2.0 * ci * N;
    }
  }
  return ok;
}

/* CIE 1931 の等色関数（Wyman ほか 2013 の近似）→ 線形 sRGB */
float g1(float x, float m, float s1, float s2) { float t = (x - m) / (x < m ? s1 : s2); return exp(-0.5 * t * t); }
vec3 wlRgb(float nm) {
  vec3 c = vec3(1.056 * g1(nm, 599.8, 37.9, 31.0) + 0.362 * g1(nm, 442.0, 16.0, 26.7) - 0.065 * g1(nm, 501.1, 20.4, 26.2),
    0.821 * g1(nm, 568.8, 46.9, 40.5) + 0.286 * g1(nm, 530.9, 16.3, 31.1),
    1.217 * g1(nm, 437.0, 11.8, 36.0) + 0.681 * g1(nm, 459.0, 26.0, 13.8));
  return mat3(3.2406, -0.9689, 0.0557, -1.5372, 1.8758, -0.204, -0.4986, 0.0415, 1.057) * c;
}

void main() {
  st = uint(gl_VertexID) * 2654435761u + uSeed * 2246822519u;
  pcg();
  pcg();
  gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  vCol = vec3(0.0);
  float nm = 380.0 + 400.0 * rnd(), l2 = nm * nm * 1e-6, n = 1.299589 + 0.0037589 / l2 - 0.00009708 / (l2 * l2);
  float r = uSrcR * sqrt(rnd()), ph = 2.0 * PI * rnd();
  vec3 src = vec3(cos(uElev), 0.0, sin(uElev)), tu = vec3(-sin(uElev), 0.0, cos(uElev));
  vec3 d = -normalize(src + r * cos(ph) * tu + r * sin(ph) * vec3(0.0, 1.0, 0.0));
  int k = pick();
  if (!through(k, d, n)) return;
  float dia = uPopA[k].w;
  if (uP2 > 0.0 && rnd() < uP2) {
    int k2 = pick();
    if (!through(k2, d, n)) return;
    dia = uPopA[k2].w;
  }
  vec3 s = -d;
  if (dia > 0.0) {
    float sg = 3.2 * nm * 1e-3 / dia / 2.3548;
    vec3 a2 = abs(s.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 e1 = normalize(cross(a2, s)), e2 = cross(s, e1);
    s = normalize(s + sg * gauss() * e1 + sg * gauss() * e2);
  }
  float kk = inversesqrt(1.0 + abs(s.z));
  vec2 uv = s.xy * kk;
  gl_Position = vec4(((uv.x * 0.5 + 0.5) * 0.5 + (s.z >= 0.0 ? 0.0 : 0.5)) * 2.0 - 1.0, uv.y, 0.0, 1.0);
  vCol = wlRgb(nm) * uNorm;
}`;

export const TRACE_FRAG = `#version 300 es
precision highp float;
flat in vec3 vCol;
out vec4 o;
void main() { o = vec4(vCol, 1.0); }`;

export const FULL_VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

/** 大気（Hillaire 2020 の定数）の単散乱。距離は km、係数は 1/km */
const ATMOS = `
const float PI = 3.14159265358979;
const float RE = 6360.0, RT = 6420.0;
const vec3 BR = vec3(5.802e-3, 13.558e-3, 33.1e-3);
const float HR = 8.0;
const float BMS = 3.996e-3, BME = 4.44e-3, HM = 1.2, GM = 0.8;
const vec3 BO = vec3(0.650e-3, 1.881e-3, 0.085e-3);
uniform float uAod;

/* 高さ h [km] の密度: Rayleigh・Mie・オゾン（25 km を頂点にした三角形） */
vec3 dens(float h) { return vec3(exp(-h / HR), exp(-h / HM), max(0.0, 1.0 - abs(h - 25.0) / 15.0)); }
vec3 ext(vec3 dn) { return BR * dn.x + vec3(BME * uAod) * dn.y + BO * dn.z; }

/* 中心からの位置 p から向き d に進み、半径 r の球に当たるまでの距離（当たらなければ −1） */
float hitSphere(vec3 p, vec3 d, float r) {
  float b = dot(p, d), c = dot(p, p) - r * r, disc = b * b - c;
  if (disc < 0.0) return -1.0;
  float s = sqrt(disc), t0 = -b - s, t1 = -b + s;
  return t0 > 0.0 ? t0 : (t1 > 0.0 ? t1 : -1.0);
}
/*
 * p から光源の向き L へ大気の上端までの透過率。地面をかすめる光は大気差で約 1° 曲がり、影の縁が約 0.9° 延びる
 * （高さ 8 km の雲で）。これを、まっすぐな光線が地面の下 1〜6 km まで潜れるとして近似する（このツールで決めたこと）
 */
vec3 sunT(vec3 p, vec3 L) {
  float tc = -dot(p, L), hmin = tc > 0.0 ? length(p + tc * L) - RE : length(p) - RE;
  float sh = smoothstep(-6.0, -1.0, hmin);
  if (sh <= 0.0) return vec3(0.0);
  float tt = hitSphere(p, L, RT);
  if (tt <= 0.0) return vec3(sh);
  vec3 od = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float t = tt * (float(i) + 0.5) / 12.0;
    od += ext(dens(max(length(p + t * L) - RE, 0.0))) * (tt / 12.0);
  }
  return sh * exp(-od);
}
float phaseR(float c) { return 3.0 / (16.0 * PI) * (1.0 + c * c); }
float phaseM(float c) { float g2 = GM * GM; return 3.0 / (8.0 * PI) * (1.0 - g2) * (1.0 + c * c) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * GM * c, 1.5)); }
`;

/**
 * 空と雲の照らされ方の表（方位 0〜180° × 高度 −10〜90°。高度は地平線の近くを細かく）。
 * 出力 0: 晴れた空の放射輝度（光源の放射照度 = 1、雲の層より上は雲で減光）
 * 出力 1: 雲の層の点に届く光源の光 × そこから目までの透過率（RGB）と、雲が散らす割合 1 − exp(−τ/μ)（A）
 */
export const SKY_FRAG = `#version 300 es
precision highp float;
${ATMOS}
uniform float uElev;
uniform float uHc;
uniform float uTau;
in vec2 vUv;
layout(location = 0) out vec4 oSky;
layout(location = 1) out vec4 oIll;

void main() {
  /* 高度 = sign(x)·90°·x²（x = −1/3〜1）: 地平線の近くほど細かい */
  float x = vUv.y * 4.0 / 3.0 - 1.0 / 3.0;
  float az = vUv.x * PI, alt = sign(x) * x * x * 0.5 * PI;
  vec3 d = vec3(cos(alt) * cos(az), cos(alt) * sin(az), sin(alt));
  vec3 L = vec3(cos(uElev), 0.0, sin(uElev));
  vec3 o = vec3(0.0, 0.0, RE + 0.002);
  float tg = hitSphere(o, d, RE), tt = hitSphere(o, d, RT);
  float len = tg > 0.0 ? tg : tt;
  /* 雲の層（高さ uHc の球面）までの距離と、そこでの向きの余弦 */
  float tc = hitSphere(o, d, RE + uHc);
  bool cl = tc > 0.0 && (tg < 0.0 || tc < tg);
  vec3 pc = o + tc * d;
  float muc = cl ? max(dot(d, normalize(pc)), 0.02) : 1.0;
  float cosT = dot(d, L), pr = phaseR(cosT), pm = phaseM(cosT);
  vec3 sum = vec3(0.0), od = vec3(0.0), tv = vec3(1.0), tvc = vec3(1.0);
  const int N = 40;
  float prev = 0.0;
  bool passed = false;
  for (int i = 0; i < N; i++) {
    float f = (float(i) + 1.0) / float(N), t = len * f * f, ds = t - prev;
    float tm = prev + 0.5 * ds;
    prev = t;
    vec3 p = o + tm * d;
    vec3 dn = dens(length(p) - RE);
    od += ext(dn) * ds;
    float cloudT = 1.0;
    if (cl && tm > tc) {
      cloudT = exp(-uTau / muc);
      if (!passed) { passed = true; tvc = exp(-od); }
    }
    vec3 T = exp(-od) * cloudT;
    sum += T * sunT(p, L) * (BR * dn.x * pr + vec3(BMS * uAod) * dn.y * pm) * ds;
  }
  if (cl && !passed) tvc = exp(-od);
  oSky = vec4(sum, 1.0);
  oIll = cl ? vec4(sunT(pc, L) * tvc, 1.0 - exp(-uTau / muc)) : vec4(0.0);
}`;

/**
 * 表示: 画面の画素の見かけの向き → 大気差を戻した真の向き → 全天図と空の表を引いて合成する。
 * 投影 0 等立体角の魚眼、1 天頂が中心の全天（等立体角）、2 ふつうのカメラ（透視）
 */
export const SHOW_FRAG = `#version 300 es
precision highp float;
${ATMOS}
uniform highp sampler2D uMap;
uniform highp sampler2D uSky;
uniform highp sampler2D uIll;
uniform int uN;
/* 投影・画角 [rad]・視線の方位 [rad]・視線の高度 [rad] */
uniform vec4 uView;
uniform float uAspect;
uniform float uElev;
/* 大気差で浮いた光源の見かけの高度 [rad] */
uniform float uElevApp;
/* 光源の視半径 [rad]・光源の放射照度・地上での光源の透過率の輝度（使わない）・光源が月か */
uniform vec4 uSrc;
uniform vec3 uSrcCol;
uniform vec3 uSrcT;
/* 滑らかな結晶の割合・映像（0 写真風、1 ハロだけ）・露出・回折の広がり [rad] */
uniform vec4 uMode;
uniform float uScale;
uniform float uNight;
in vec2 vUv;
out vec4 o;

vec4 tex(ivec2 p) { return texelFetch(uMap, clamp(p, ivec2(0), ivec2(2 * uN - 1, uN - 1)), 0); }
vec3 halo(vec3 s) {
  float k = inversesqrt(1.0 + abs(s.z));
  vec2 uv = s.xy * k;
  vec2 f = vec2((uv.x * 0.5 + 0.5) * float(uN), (uv.y * 0.5 + 0.5) * float(uN)) - 0.5;
  ivec2 i = ivec2(floor(f));
  vec2 a = f - vec2(i);
  int off = s.z >= 0.0 ? 0 : uN;
  i = clamp(i, ivec2(0), ivec2(uN - 2));
  ivec2 b = ivec2(i.x + off, i.y);
  vec3 c = mix(mix(tex(b).rgb, tex(b + ivec2(1, 0)).rgb, a.x), mix(tex(b + ivec2(0, 1)).rgb, tex(b + ivec2(1, 1)).rgb, a.x), a.y);
  return c * uScale;
}
vec2 skyUv(vec3 s) {
  float az = abs(atan(s.y, s.x)) / PI, a = clamp(asin(clamp(s.z, -1.0, 1.0)) / (0.5 * PI), -1.0 / 9.0, 1.0);
  return vec2(az, (sign(a) * sqrt(abs(a)) + 1.0 / 3.0) * 0.75);
}
float hg(float c, float g) { return (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * c, 1.5)); }
/* 大気差（Bennett 1982）: 見かけの高度 [°] → 真の高度 [°]。−1° より下は −2° で 0 になるよう減らす */
float trueAlt(float a) {
  float b = max(a, -1.0), r = 1.0 / tan((b + 7.31 / (b + 4.4)) * PI / 180.0) / 60.0;
  return a - r * clamp(a + 2.0, 0.0, 1.0);
}

void main() {
  vec2 q = (vUv * 2.0 - 1.0) * vec2(1.0, uAspect);
  vec3 s;
  bool inside = true;
  int pj = int(uView.x + 0.5);
  if (pj == 1) {
    float R = length(q);
    inside = R <= 1.0;
    float th = 2.0 * asin(min(R, 1.0) / sqrt(2.0)), a = atan(-q.x, -q.y) + uView.z;
    s = vec3(sin(th) * cos(a), -sin(th) * sin(a), cos(th));
  } else {
    float al = uView.w, az = uView.z;
    vec3 f = vec3(cos(al) * cos(az), -cos(al) * sin(az), sin(al)), r = normalize(vec3(-sin(az), -cos(az), 0.0)), u = cross(r, f);
    float R = length(q), th, ph = atan(q.y, q.x);
    if (pj == 0) th = 2.0 * asin(clamp(R * sin(uView.y / 4.0), 0.0, 1.0));
    else th = atan(R * tan(uView.y / 2.0));
    s = cos(th) * f + sin(th) * (cos(ph) * r + sin(ph) * u);
  }
  if (!inside) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  /* 見かけの向き → 真の向き（全天図は真の向きで引く。空・雲・光源の円盤は見かけの向きどうしで比べる） */
  float aApp = asin(clamp(s.z, -1.0, 1.0)) * 180.0 / PI, aTrue = trueAlt(aApp) * PI / 180.0;
  vec2 hz = normalize(s.xy + 1e-9);
  vec3 sv = vec3(hz * cos(aTrue), sin(aTrue));
  vec3 L = vec3(cos(uElevApp), 0.0, sin(uElevApp));
  float cosT = clamp(dot(s, L), -1.0, 1.0), th = acos(cosT);
  float E = uSrc.y;
  vec3 col;
  bool only = uMode.y > 0.5;
  if (aApp < 0.0) {
    /* 地面: 空の明るさの 1 割ほどで照らされ、地平線の近くはかすむ */
    vec3 zen = texture(uSky, vec2(0.5, 1.0)).rgb;
    vec3 hzc = texture(uSky, skyUv(vec3(hz, 0.02))).rgb;
    col = only ? vec3(0.0) : E * (0.03 * zen + max(sin(uElev), 0.0) * 0.012 * uSrcT + 0.5 * hzc * exp(aApp / 0.6));
  } else {
    vec2 uv = skyUv(s);
    vec4 il = texture(uIll, uv);
    vec3 sky = texture(uSky, uv).rgb;
    float fs = uMode.x, sd = uMode.w;
    float diff = 0.5 * exp(-th * th / (2.0 * sd * sd)) / (2.0 * PI * sd * sd);
    vec3 h = halo(sv);
    if (only) col = E * il.rgb * il.a * 0.5 * h;
    else col = E * (sky + il.rgb * il.a * (0.5 * ((1.0 - fs) * hg(cosT, 0.62) + fs * h) + diff)) + uNight;
    /* 光源の円盤（雲で弱まる） */
    if (th < uSrc.x && !only) col += E * uSrcT * (1.0 - texture(uIll, skyUv(L)).a) / (PI * uSrc.x * uSrc.x);
  }
  col *= uSrcCol * uMode.z;
  float m = min(col.r, min(col.g, col.b));
  if (m < 0.0) {
    float y = max(0.0, dot(col, vec3(0.2126, 0.7152, 0.0722)));
    col = y + (y / (y - m)) * (col - y);
  }
  vec3 v = 1.0 - exp(-max(col, 0.0));
  o = vec4(mix(12.92 * v, 1.055 * pow(v, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, v)), 1.0);
}`;
