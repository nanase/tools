/**
 * 月を描くシェーダー。地形のテクスチャは表側（経度 −100°〜+100°、全緯度、8 px/度）で、
 * 行 0 が北緯 90°。標高は 10 m 刻みの値を R（上位）・G（下位）の 2 バイトに分けた PNG
 */

/** テクスチャの範囲と解像度 */
export const LON0 = -100,
  PPD = 8,
  TW = 1600,
  TH = 1440;

const COMMON = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
const float RM = 1737.4;
`;

export const VERT = /* glsl */ `#version 300 es
layout(location = 0) in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

/**
 * 前処理: 標高から、東・北向きの傾き（無次元）と、東・西の地平線の高度角 [°] を求めて RGBA16F に書く。
 * 地平線は大円に沿って 2〜400 km を 40 歩たどり、月の丸みも入れる
 */
export const PREP_FRAG = `${COMMON}
uniform sampler2D uH;
out vec4 o;
const ivec2 SZ = ivec2(${TW}, ${TH});
float hAt(ivec2 c) {
  c = clamp(c, ivec2(0), SZ - 1);
  vec3 t = texelFetch(uH, c, 0).rgb * 255.0;
  return (round(t.r) * 256.0 + round(t.g)) * 0.01 - 10.0;
}
float hLL(float lat, float lon) {
  vec2 p = vec2((lon - (${LON0}.0)) * ${PPD}.0 - 0.5, (90.0 - lat) * ${PPD}.0 - 0.5);
  vec2 f = floor(p), w = p - f;
  ivec2 i = ivec2(f);
  return mix(mix(hAt(i), hAt(i + ivec2(1, 0)), w.x), mix(hAt(i + ivec2(0, 1)), hAt(i + ivec2(1, 1)), w.x), w.y);
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float lon = radians(${LON0}.0 + (float(c.x) + 0.5) / ${PPD}.0), lat = radians(90.0 - (float(c.y) + 0.5) / ${PPD}.0);
  float h0 = hAt(c);
  float dl = radians(1.0 / ${PPD}.0) * RM;
  float gx = (hAt(c + ivec2(1, 0)) - hAt(c - ivec2(1, 0))) / (2.0 * dl * max(cos(lat), 0.02));
  float gy = (hAt(c - ivec2(0, 1)) - hAt(c + ivec2(0, 1))) / (2.0 * dl);
  vec3 P = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
  vec3 e = vec3(-sin(lon), cos(lon), 0.0);
  float hz[2];
  for (int k = 0; k < 2; k++) {
    vec3 d = k == 0 ? e : -e;
    float best = -90.0, dist = 2.0;
    for (int s = 0; s < 40; s++) {
      float a = dist / RM;
      vec3 Q = cos(a) * P + sin(a) * d;
      float hq = hLL(degrees(asin(clamp(Q.z, -1.0, 1.0))), degrees(atan(Q.y, Q.x)));
      vec3 dv = (RM + hq) * Q - (RM + h0) * P;
      best = max(best, degrees(asin(clamp(dot(dv, P) / length(dv), -1.0, 1.0))));
      dist *= 1.145;
    }
    hz[k] = best;
  }
  o = vec4(gx, gy, hz[0], hz[1]);
}
`;

/**
 * 月の円盤: 画素ごとに視線と球の交点を求め、月面の経緯度で色と地形を読む。
 * 明るさは McEwen の lunar-Lambert、落ちる影は地平線の高度角と太陽の高度（視直径 0.53° でぼかす）、
 * 地球照は地球の満ち欠けに比例、月食は Mallama (2022) の 3 色の減光表で本影・半影の色と暗さを付ける
 */
export const MOON_FRAG = `${COMMON}
uniform sampler2D uC;
uniform sampler2D uT;
uniform vec3 uR, uU, uF, uS, uO;
/** 円盤の中心 [px]（ビューポートの左下から）、半径 [px] */
uniform vec3 uDisk;
uniform float uL, uGain, uEs, uSat;
uniform int uEcl;
uniform vec3 uMc, uAx;
uniform mat3 uB2F;
/** 本影・半影の半径 [°] */
uniform vec2 uSh;
uniform vec4 uMal[51];
out vec4 o;
vec3 att(float th) {
  float pu = ${0.429};
  float pos = th > uSh.x ? pu * (uSh.y - th) / (uSh.y - uSh.x) : pu + (1.0 - pu) * (uSh.x - th) / uSh.x;
  pos = clamp(pos, 0.0, 1.0);
  vec4 m = uMal[0];
  for (int i = 1; i < 51; i++) {
    vec4 n = uMal[i];
    if (pos <= n.x) { m = mix(m, n, (pos - m.x) / max(n.x - m.x, 1e-6)); break; }
    m = n;
  }
  /* m.yzw は B・V・R の減光 [等]。R・G・B の順に返す */
  return pow(vec3(10.0), -0.4 * m.wzy);
}
void main() {
  vec2 q = (gl_FragCoord.xy - uDisk.xy) / uDisk.z;
  float r2 = dot(q, q);
  float cov = clamp((1.0 - sqrt(r2)) * uDisk.z + 0.5, 0.0, 1.0);
  if (cov <= 0.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float z = sqrt(max(0.0, 1.0 - r2));
  vec3 P = normalize(q.x * uR + q.y * uU - z * uF);
  float lat = asin(clamp(P.z, -1.0, 1.0)), lon = atan(P.y, P.x);
  vec2 uv = vec2((degrees(lon) - (${LON0}.0)) / ${(TW / PPD).toFixed(1)}, (90.0 - degrees(lat)) / 180.0);
  vec4 T = texture(uT, uv);
  vec3 e = vec3(-sin(lon), cos(lon), 0.0);
  vec3 n = vec3(-sin(lat) * cos(lon), -sin(lat) * sin(lon), cos(lat));
  vec3 N = normalize(P - T.x * e - T.y * n);
  float mu0 = dot(N, uS), mu = max(dot(N, uO), 1e-3);
  float refl = mu0 > 0.0 ? 2.0 * uL * mu0 / (mu0 + mu) + (1.0 - uL) * mu0 : 0.0;
  float es = degrees(asin(clamp(dot(P, uS), -1.0, 1.0)));
  float hz = dot(uS, e) >= 0.0 ? T.z : T.w;
  float lit = clamp((es - hz) / 0.53 + 0.5, 0.0, 1.0);
  vec3 alb = texture(uC, uv).rgb;
  alb = mix(vec3(dot(alb, vec3(1.0 / 3.0))), alb, uSat);
  vec3 direct = alb * refl * lit;
  if (uEcl == 1) {
    vec3 Pg = uMc + RM * (uB2F * P);
    direct *= att(degrees(acos(clamp(dot(normalize(Pg), uAx), -1.0, 1.0))));
  }
  vec3 c = (direct + alb * uEs * max(dot(N, uO), 0.0)) * uGain;
  c = c / (1.0 + 0.25 * c);
  c = mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  o = vec4(c * cov, 1.0);
}
`;
