/**
 * ローリングシャッターの描画のシェーダ（GLSL ES 3.00）。画素ごとに読み出す行 s を決め、その行の露光の間
 * [t0 + s·Tr, t0 + s·Tr + Te] を uK 個の時刻に分けて、それぞれの時刻の題材を描いて平均する。
 * 走査のスロー再生では、まだ読み出していない行（s > uCut）に今の様子を暗く描く
 */
import { BIKE, CAR, G, GOLF, GOLF_BALL0, HELI, MOTO, MOTO_W, type Mover, PROP_R, TRAIN } from './motion';
import { GOLF_SHIRT, SKIN } from './scenes/swing';

/** 題材の番号（uS） */
export const SUBJECT_ID = { prop: 0, train: 1, car: 2, golf: 3, moto: 4, heli: 5 } as const;

const f = (v: number): string => {
  const s = Number(v.toFixed(6)).toString();
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
};
const v2 = (p: readonly number[]): string => `vec2(${f(p[0])}, ${f(p[1])})`;
const v4 = (p: readonly number[]): string => `vec4(${p.map(f).join(', ')})`;
/** CSS の色を、GLSL の線形の RGB にする */
const col = (hex: string): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `lin(vec3(${f(((n >> 16) & 255) / 255)}, ${f(((n >> 8) & 255) / 255)}, ${f((n & 255) / 255)}))`;
};

/** 一定の速さで横に動く車体と車輪 */
function mover(name: string, M: Mover, body: string, wheel: string): string {
  return `vec3 ${name}(vec2 m, float t, vec3 c, float x0, float v){
  float xb = m.x - x0 - v*t;${M.period > 0 ? `\n  xb = mod(xb, ${f(M.period)});` : ''}
  vec2 p = vec2(xb, m.y);
  float a = v*t/${f(M.wr)};
${M.wheels.map((x) => `  c = wheel(c, ${wheel}, p - vec2(${f(x)}, ${f(M.wy)}), ${f(M.wr)}, a);`).join('\n')}
  return over(sprite(${body}, ${v4(M.body)}, p), c);
}`;
}

export const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec2 uR;
uniform int uS, uDir, uLive, uK;
uniform float uT0, uTr, uTe, uCut, uNow;
/* 画面の範囲 [m]（左下 x・y、幅、高さ）と、題材ごとの入力 */
uniform vec4 uView, uP;
uniform sampler2D uTex0, uTex1, uTex2, uTex3, uTex4, uTex5;
const float PI = 3.14159265;
float PX;
vec3 lin(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
/* 符号付きの距離 d [m] から、画素の覆う割合 */
float fill(float d) { return clamp(0.5 - d / PX, 0.0, 1.0); }
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c*p.x - s*p.y, s*p.x + c*p.y); }
/* 線分 a–b までの距離と、線分の上の位置 (0〜1) */
vec2 seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0); return vec2(length(pa - ba*h), h); }
/* 前乗算のアルファの絵を重ねる */
vec3 over(vec4 s, vec3 d) { return lin(s.rgb) + (1.0 - s.a) * d; }
/* 絵（範囲 r: 左下 x・y、幅、高さ）の点 p の色。範囲の外は透明 */
vec4 sprite(sampler2D T, vec4 r, vec2 p) {
  vec2 u = vec2((p.x - r.x) / r.z, (r.y + r.w - p.y) / r.w);
  if (u.x < 0.0 || u.x > 1.0 || u.y < 0.0 || u.y > 1.0) return vec4(0.0);
  return texture(T, u);
}
/* 車輪の絵を、中心からの位置 q で角 a だけ回して重ねる（前へ進むと時計回り） */
vec3 wheel(vec3 c, sampler2D W, vec2 q, float r, float a) {
  if (max(abs(q.x), abs(q.y)) >= r * 1.05) return c;
  q = rot(q, a);
  return over(texture(W, vec2(0.5 + q.x / (2.1*r), 0.5 - q.y / (2.1*r))), c);
}

/* ---------- プロペラ（画面の高さを 2 とした単位） ---------- */
vec3 propeller(vec2 q, float t) {
  vec3 c = lin(mix(vec3(0.86, 0.9, 0.93), vec3(0.46, 0.62, 0.8), clamp(q.y*0.45 + 0.5, 0.0, 1.0)));
  c = mix(c, lin(vec3(0.38, 0.4, 0.43)), fill(max(abs(q.x) - 0.045, q.y)));
  float r = length(q);
  float sec = 2.0*PI / uP.y;
  float th = atan(q.y, q.x) - 2.0*PI*uP.x*t;
  float d = mod(th + 0.5*sec, sec) - 0.5*sec;
  float al = r*cos(d), pe = abs(r*sin(d));
  float L = ${f(PROP_R)};
  float hw = mix(0.085, 0.04, clamp(al/L, 0.0, 1.0));
  float sd = max(max(pe - hw, al - L), -al);
  vec3 bc = mix(lin(vec3(0.13, 0.14, 0.16)), lin(vec3(0.96, 0.78, 0.12)), smoothstep(L - 0.16 - PX, L - 0.16 + PX, al));
  c = mix(c, bc, fill(sd));
  c = mix(c, lin(vec3(0.25, 0.26, 0.28)), fill(r - 0.11));
  return mix(c, lin(vec3(0.62, 0.64, 0.67)), fill(r - 0.035));
}

/* ---------- 電車・自動車・自転車 ---------- */
${mover('train', TRAIN, 'uTex1', 'uTex2')}
${mover('car', CAR, 'uTex1', 'uTex2')}
${mover('bike', BIKE, 'uTex4', 'uTex5')}

/* ---------- ゴルフ ---------- */
float logi(float x) { return 1.0 / (1.0 + exp(-x)); }
vec2 golfAng(float tau) {
  float pa = -PI/2.0 + 2.4*tanh(tau/0.2);
  return vec2(pa, pa - 1.7*logi(-(tau + 0.035)/0.03) + 1.1*logi((tau - 0.06)/0.05));
}
/* 肩から手への腕（袖と肌）を重ねる */
vec3 arm(vec3 c, vec2 m, vec2 s, vec2 h, vec3 sleeve, float cut) {
  vec2 d = seg(m, s, h);
  float a = fill(d.x - mix(0.055, 0.038, d.y));
  vec3 k = d.y < cut ? sleeve : ${col(SKIN)};
  return mix(c, k * (0.82 + 0.18*(1.0 - d.y)), a);
}
vec3 club(vec3 c, vec2 m, vec2 H, vec2 dir) {
  vec2 E = H + ${f(GOLF.lc)}*dir;
  vec2 d = seg(m, H + 0.17*dir, E - 0.02*dir);
  c = mix(c, lin(vec3(0.62, 0.64, 0.67)) * (0.75 + 0.25*smoothstep(0.0055, 0.0, d.x)), fill(d.x - 0.0055));
  d = seg(m, H - 0.03*dir, H + 0.2*dir);
  c = mix(c, lin(vec3(0.07, 0.07, 0.08)), fill(d.x - 0.014));
  vec2 n = vec2(-dir.y, dir.x);
  vec2 q = vec2(dot(m - E, dir) - 0.012, dot(m - E, n) - 0.02);
  float e = (length(q / vec2(0.035, 0.068)) - 1.0) * 0.035;
  return mix(c, mix(lin(vec3(0.09, 0.09, 0.1)), lin(vec3(0.42, 0.44, 0.47)), smoothstep(0.0, 0.03, q.x)), fill(e));
}
vec3 ball(vec3 c, vec2 m, vec2 p, float r) {
  float d = length(m - p) - r;
  vec3 w = lin(vec3(0.97)) * (0.7 + 0.3*clamp(dot(normalize(m - p + 1e-6), vec2(-0.5, 0.7)), 0.0, 1.0));
  return mix(c, w, fill(d));
}
vec3 golf(vec2 m, float t, vec3 bg) {
  float tau = t * uP.x;
  vec2 A = golfAng(tau);
  vec2 H = ${v2(GOLF.pivot)} + ${f(GOLF.la)}*vec2(cos(A.x), sin(A.x));
  vec2 dir = vec2(cos(A.y), sin(A.y));
  vec3 c = bg;
  bool behind = tau < -0.12;
  if (behind) c = club(c, m, H, dir);
  c = over(texture(uTex1, (m - uView.xy) / uView.zw * vec2(1.0, -1.0) + vec2(0.0, 1.0)), c);
  if (!behind) c = club(c, m, H, dir);
  vec3 shirt = ${col(GOLF_SHIRT)};
  c = arm(c, m, ${v2(GOLF.shoulders[0])}, H, shirt, 0.42);
  c = arm(c, m, ${v2(GOLF.shoulders[1])}, H, shirt, 0.42);
  c = mix(c, lin(vec3(0.95)), fill(length(m - H - 0.01*dir) - 0.042));
  vec2 B = ${v2(GOLF_BALL0)};
  if (t > 0.0) B += uP.y * t * vec2(${f(Math.cos(GOLF.launch))}, ${f(Math.sin(GOLF.launch))});
  return ball(c, m, B, ${f(GOLF.ball)});
}

/* ---------- モトクロス ---------- */
vec3 moto(vec2 m, float t, vec3 bg) {
  vec2 pos = ${v2(MOTO.lip)} + vec2(${f(MOTO.vx)}*t, ${f(MOTO.vy)}*t - ${f(G / 2)}*t*t);
  vec2 p = rot(m - pos, -(${f(MOTO.pitch0)} + ${f(MOTO_W)}*t));
  float s = ${f(MOTO.spin)}*t;
  vec3 c = wheel(bg, uTex2, p - vec2(${f(MOTO.hubs[0])}, 0.0), ${f(MOTO.wr)}, s);
  c = wheel(c, uTex2, p - vec2(${f(MOTO.hubs[1])}, 0.0), ${f(MOTO.wr)}, s);
  return over(sprite(uTex1, ${v4(MOTO.body)}, p), c);
}

/* ---------- ヘリコプター ---------- */
/* 主ローター: 画面の点を水平な円盤の上の点 (X, Z) に戻し、羽の上かを見る。Z > 0 が奥（画面の上） */
vec4 rotor(vec2 m, float t) {
  vec2 d = m - ${v2(HELI.mast)};
  vec2 P = vec2(d.x, d.y / ${f(HELI.squash)});
  float r = length(P);
  if (r > ${f(HELI.R + 0.1)} || r < 0.15) return vec4(0.0);
  float sec = 2.0*PI / ${f(HELI.blades)};
  float th = atan(P.y, P.x) - 2.0*PI*uP.x*t;
  float k = floor((th + 0.5*sec) / sec);
  float dd = th - k*sec;
  float al = r*cos(dd), pe = abs(r*sin(dd));
  float sd = max(max(pe - ${f(HELI.chord / 2)}, al - ${f(HELI.R)}), 0.3 - al);
  float ax = k*sec + 2.0*PI*uP.x*t;
  float w = PX / mix(1.0, ${f(HELI.squash)}, abs(cos(ax)));
  float a = clamp(0.5 - sd / w, 0.0, 1.0);
  vec3 bc = al > ${f(HELI.R - 0.35)} ? lin(vec3(0.95, 0.8, 0.2)) : lin(vec3(0.17, 0.18, 0.2));
  return vec4(bc, a);
}
vec3 tailRotor(vec3 c, vec2 m, float t) {
  vec2 q = m - ${v2(HELI.tail)};
  float r = length(q);
  if (r > ${f(HELI.Rt + 0.05)}) return c;
  float sec = 2.0*PI / ${f(HELI.tailBlades)};
  float th = atan(q.y, q.x) + 2.0*PI*uP.x*${f(HELI.tailRatio)}*t;
  float dd = mod(th + 0.5*sec, sec) - 0.5*sec;
  float al = r*cos(dd), pe = abs(r*sin(dd));
  float sd = max(max(pe - mix(0.07, 0.05, al / ${f(HELI.Rt)}), al - ${f(HELI.Rt)}), -al);
  float band = step(0.5, fract(al / ${f(HELI.Rt)} * 2.5));
  vec3 bc = mix(lin(vec3(0.85, 0.17, 0.13)), lin(vec3(0.95)), band);
  c = mix(c, bc, fill(sd));
  return mix(c, lin(vec3(0.24, 0.25, 0.27)), fill(r - 0.07));
}
vec3 heli(vec2 m, float t, vec3 bg) {
  vec4 rt = rotor(m, t);
  bool far = m.y > ${f(HELI.mast[1])};
  vec3 c = far ? mix(bg, rt.rgb, rt.a) : bg;
  c = over(sprite(uTex1, ${v4(HELI.body)}, m), c);
  c = tailRotor(c, m, t);
  if (!far) c = mix(c, rt.rgb, rt.a);
  vec2 h = (m - ${v2(HELI.mast)}) / vec2(0.32, 0.09);
  return mix(c, lin(vec3(0.2, 0.21, 0.23)), fill((length(h) - 1.0) * 0.09));
}

vec3 scene(vec2 q, vec2 m, float t, vec3 bg) {
  if (uS == 0) return propeller(q, t);
  if (uS == 1) return train(m, t, bg, uP.y, uP.x);
  if (uS == 2) return bike(m, t, car(m, t, bg, uP.y, uP.x), uP.w, uP.z);
  if (uS == 3) return golf(m, t, bg);
  if (uS == 4) return moto(m, t, bg);
  return heli(m, t, bg);
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 q = (fc - 0.5*uR) / uR.y * 2.0;
  vec2 m = uView.xy + fc / uR * uView.zw;
  PX = uS == 0 ? 2.0 / uR.y : uView.w / uR.y;
  vec2 tu = vec2(fc.x / uR.x, 1.0 - fc.y / uR.y);
  vec3 bg = uS == 0 ? vec3(0.0) : lin(texture(uTex0, tu).rgb);
  vec4 fg = uS == 1 ? texture(uTex3, tu) : vec4(0.0);
  float s = uDir == 0 ? 1.0 - fc.y / uR.y : fc.x / uR.x;
  vec3 c;
  if (uLive == 1 || s > uCut) {
    c = scene(q, m, uNow, bg);
    if (uLive == 0) c *= 0.12;
  } else {
    float a = uT0 + s*uTr;
    float j = hash(fc);
    vec3 acc = vec3(0.0);
    int K = uTe > 0.0 ? uK : 1;
    for (int k = 0; k < 64; k++) {
      if (k >= K) break;
      acc += scene(q, m, a + uTe * (float(k) + j) / float(K), bg);
    }
    c = acc / float(K);
  }
  c = over(fg, c);
  outColor = vec4(pow(clamp(c, 0.0, 1.0), vec3(1.0/2.2)), 1.0);
  if (uLive == 0 && uCut < 1.0) {
    float dp = uDir == 0 ? abs((1.0 - uCut)*uR.y - fc.y) : abs(uCut*uR.x - fc.x);
    outColor.rgb = mix(outColor.rgb, vec3(1.0), clamp(1.6 - dp, 0.0, 1.0));
  }
}
`;
