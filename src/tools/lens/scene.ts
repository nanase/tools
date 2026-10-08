/**
 * 被写体の 3D 空間（DOM に依存しない）。座標は m で、x が右（東）、y が上、z が前（北）。撮影者のセンサーは
 * 原点の上の高さ EYE にあり、向きだけを変える。ピントの距離の目安になるよう、解像チャートはセンサーから
 * 前へ 0.5〜16 m の面に置く。同じデータから、ブラウザの光線追跡（GLSL）とピント合わせの交差判定（TS）を作る
 */

export type V3 = [number, number, number];

/** センサーの中心の高さ [m] */
export const EYE = 1.2;

/** 解像チャート（ジーメンススター）の板: 中心・星の半径・距離の表記 */
export interface Board {
  c: V3;
  r: number;
  label: string;
}
const deg = Math.PI / 180;
export const BOARDS: Board[] = (
  [
    [0.5, -15, -7.5, '0.5'],
    [1, -9, -5.5, '1'],
    [2, -3, -3.8, '2'],
    [4, 3, -2.2, '4'],
    [8, 9, -1, '8'],
    [16, 15, 1, '16'],
  ] as const
).map(([d, az, el, label]) => ({
  c: [d * Math.tan(az * deg), EYE + d * Math.tan(el * deg), d],
  r: 0.036 * d,
  label,
}));
/** 板の範囲（星の半径を単位にした左右・上・下） */
export const BOARD_W = 1.3,
  BOARD_T = 1.3,
  BOARD_B = 2.05;

/** 縦の円柱（柱と、板・電飾の支柱）: x, z, 半径, 高さ, 色 */
export interface Cyl {
  x: number;
  z: number;
  r: number;
  h: number;
  col: V3;
  /** 白い横縞を付ける */
  band?: boolean;
}
const POLE: V3 = [0.09, 0.09, 0.1];
export const CYLS: Cyl[] = [
  { x: 7 * Math.tan(-12 * deg), z: 7, r: 0.2, h: 2.4, col: [0.62, 0.1, 0.07], band: true },
  { x: 13 * Math.tan(6 * deg), z: 13, r: 0.28, h: 3.0, col: [0.07, 0.2, 0.55], band: true },
  { x: 18 * Math.tan(-21 * deg), z: 18, r: 0.34, h: 3.4, col: [0.7, 0.52, 0.08], band: true },
  { x: 24 * Math.tan(21 * deg), z: 24, r: 0.4, h: 3.8, col: [0.1, 0.4, 0.16], band: true },
  ...BOARDS.map((b) => ({ x: b.c[0], z: b.c[2], r: b.r * 0.07, h: b.c[1] - b.r * BOARD_B, col: POLE })),
  { x: -13, z: 19, r: 0.06, h: 4.7, col: POLE },
  { x: 5, z: 19, r: 0.06, h: 4.7, col: POLE },
];

/** 奥の壁（暗い地に白い格子、1 m ごと） */
export const WALL = { z: 30, x0: -40, x1: 6, h: 6, grid: 1, line: 0.05 } as const;

/** 電飾の電球: 中心・半径・放射輝度（RGB） */
export interface Bulb {
  c: V3;
  r: number;
  e: V3;
}
/** 両端の高さ y0 から中央で sag だけ垂れる紐に、n 個を等間隔に吊るす */
function string(
  n: number,
  x0: number,
  x1: number,
  z: number,
  y0: number,
  sag: number,
  r: number,
  e: (i: number) => V3,
): Bulb[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 0.5) / n,
      x = x0 + (x1 - x0) * t;
    return { c: [x, y0 - sag * (1 - (2 * t - 1) ** 2), z] as V3, r, e: e(i) };
  });
}
const WARM: V3 = [26, 17, 8];
const COLORS: V3[] = [
  [24, 3, 2],
  [4, 18, 5],
  [3, 7, 26],
  [24, 14, 2],
  [20, 18, 16],
];
/** 電飾の紐（遠・中・手前）。描画は紐ごとに外接箱で先に判定する */
export const STRINGS: Bulb[][] = [
  string(26, -13, 5, 19, 4.6, 1.2, 0.045, () => WARM),
  string(14, -3.2, 2.6, 10, 2.7, 0.45, 0.025, (i) => COLORS[i % COLORS.length]),
  string(7, 0.08, 0.3, 0.85, 1.06, 0.012, 0.0035, () => [14, 9, 4.5]),
];

/** 遠景の山の稜線の仰角 [rad]（方位角 az [rad] の関数） */
export const ridge = (az: number): number =>
  0.018 + 0.012 * Math.sin(2.3 * az + 0.7) + 0.007 * Math.sin(5.9 * az + 2.1) + 0.003 * Math.sin(13 * az);

/* ---------- 空の天体（無限遠） ---------- */
/**
 * 空に置く天体: 方位・仰角 [°]（配置はこのツールで決めた。月は緑の柱の上、惑星はその右上に寄せる）、赤道半径 [km] と地球からの距離 [km] で決まる
 * 角半径、極の向きの回し [°]（北が上で 0、左回りが正）と、こちらから見た極の傾き（環の開き）[°]
 */
export interface SkyBody {
  id: 'moon' | 'jupiter' | 'saturn' | 'uranus';
  name: string;
  az: number;
  el: number;
  /** 赤道半径・距離 [km] */
  r: number;
  dist: number;
  rot: number;
  tilt: number;
}
/**
 * 大きさは NASA の Planetary Fact Sheet の値: 月は平均距離、惑星は地球に最も近づくとき（衝）の距離。
 * 全体を同じ向き（衝のころ、太陽を背にして満ちて見える）として、影は描かない
 */
export const SKY: SkyBody[] = [
  { id: 'moon', name: '月', az: 21, el: 8, r: 1737.4, dist: 384400, rot: 0, tilt: 0 },
  { id: 'uranus', name: '天王星', az: 23.5, el: 13, r: 25559, dist: 2580.6e6, rot: 30, tilt: 55 },
  { id: 'jupiter', name: '木星', az: 25.5, el: 10.5, r: 71492, dist: 588.5e6, rot: 0, tilt: 0 },
  { id: 'saturn', name: '土星', az: 29, el: 8.2, r: 60268, dist: 1205.5e6, rot: -6, tilt: 20 },
];
/** 天体の角半径 [rad] */
export const angRadius = (b: SkyBody): number => Math.asin(b.r / b.dist);

/** 天体の中心の向きと、空の上の右・上の単位ベクトル（極の向きで回したもの） */
export function bodyFrame(b: SkyBody): { c: V3; e1: V3; e2: V3 } {
  const a = b.az * deg,
    e = b.el * deg,
    q = b.rot * deg;
  const c: V3 = [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
  const r: V3 = [Math.cos(a), 0, -Math.sin(a)],
    u: V3 = [-Math.sin(a) * Math.sin(e), Math.cos(e), -Math.cos(a) * Math.sin(e)];
  const mix = (x: V3, y: V3, s: number, t: number): V3 => [
    x[0] * s + y[0] * t,
    x[1] * s + y[1] * t,
    x[2] * s + y[2] * t,
  ];
  return { c, e1: mix(r, u, Math.cos(q), Math.sin(q)), e2: mix(r, u, -Math.sin(q), Math.cos(q)) };
}

/** 木星の扁平率と、ガリレオ衛星（木星の赤道半径を単位にした空の上の位置・半径、幾何アルベド） */
const JUP = { flat: 0.06487, albedo: 0.538 } as const;
const GALILEAN = [
  /* イオ・エウロパ・ガニメデ・カリスト。軌道長半径は 421.8・671.1・1070.4・1882.7 千 km で、その内側に置く */
  { x: 4.4, y: 0.05, r: 1821.5, a: 0.62, col: [1, 0.92, 0.7] },
  { x: -7.6, y: -0.1, r: 1560.8, a: 0.68, col: [1, 0.97, 0.92] },
  { x: 12.3, y: 0.15, r: 2631.2, a: 0.44, col: [0.95, 0.93, 0.9] },
  { x: -22.8, y: -0.3, r: 2410.3, a: 0.19, col: [0.86, 0.82, 0.78] },
] as const;
/**
 * 土星の扁平率と環（土星の赤道半径を単位にした内・外の半径、土星の本体に対する明るさ、不透明度）。
 * 半径は C 環 74,658〜91,975 km、B 環〜117,507 km、カッシーニの間隙〜122,340 km、A 環〜136,780 km。
 * 明るさは反射率（C 0.12〜0.30、B・A 0.4〜0.6、間隙 0.2〜0.4）と、環の開き 20° での光学的厚さから
 */
const SAT = { flat: 0.09796 } as const;
const SAT_RINGS = [
  [74658, 91975, 0.14, 0.36],
  [91975, 117507, 0.99, 0.99],
  [117507, 122340, 0.08, 0.14],
  [122340, 136780, 0.83, 0.83],
] as const;
/** 天王星の扁平率と ε 環（半径 51,149 km、幅 20〜96 km の平均、アルベド 0.018 を本体の 0.488 と比べる） */
const URA = { flat: 0.02293, ring: 51149, width: 58, albedo: 0.018 / 0.488, op: 0.9 } as const;

/* ---------- 交差判定（ピント合わせ用） ---------- */
/** 光線（m）が最初に当たる物体までの距離。空（無限遠）なら Infinity */
export function intersect(o: V3, d: V3): number {
  let t = Infinity;
  if (d[1] < 0) t = Math.min(t, -o[1] / d[1]);
  if (d[2] > 1e-9) {
    const tw = (WALL.z - o[2]) / d[2],
      x = o[0] + d[0] * tw,
      y = o[1] + d[1] * tw;
    if (tw > 0 && x > WALL.x0 && x < WALL.x1 && y > 0 && y < WALL.h) t = Math.min(t, tw);
    for (const b of BOARDS) {
      const tb = (b.c[2] - o[2]) / d[2],
        u = (o[0] + d[0] * tb - b.c[0]) / b.r,
        v = (o[1] + d[1] * tb - b.c[1]) / b.r;
      if (tb > 0 && Math.abs(u) < BOARD_W && v < BOARD_T && v > -BOARD_B) t = Math.min(t, tb);
    }
  }
  for (const c of CYLS) {
    const tc = cyl(o, d, c);
    if (tc < t) t = tc;
  }
  for (const L of STRINGS)
    for (const b of L) {
      const ts = sphere(o, d, b.c, b.r);
      if (ts < t) t = ts;
    }
  return t;
}

function cyl(o: V3, d: V3, c: Cyl): number {
  const ox = o[0] - c.x,
    oz = o[2] - c.z;
  const a = d[0] * d[0] + d[2] * d[2],
    b = ox * d[0] + oz * d[2],
    cc = ox * ox + oz * oz - c.r * c.r;
  const disc = b * b - a * cc;
  if (a < 1e-12 || disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / a,
    y = o[1] + d[1] * t;
  return t > 0 && y > 0 && y < c.h ? t : Infinity;
}

function sphere(o: V3, d: V3, c: V3, r: number): number {
  const ox = o[0] - c[0],
    oy = o[1] - c[1],
    oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2],
    cc = ox * ox + oy * oy + oz * oz - r * r,
    disc = b * b - cc;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : Infinity;
}

/** 撮影者の向き（方位 pan・仰角 tilt [°]）の右・上・前の単位ベクトル */
export function basis(pan: number, tilt: number): { r: V3; u: V3; f: V3 } {
  const p = pan * deg,
    t = tilt * deg;
  return {
    r: [Math.cos(p), 0, -Math.sin(p)],
    u: [-Math.sin(p) * Math.sin(t), Math.cos(t), -Math.cos(p) * Math.sin(t)],
    f: [Math.sin(p) * Math.cos(t), Math.sin(t), Math.cos(p) * Math.cos(t)],
  };
}

/* ---------- GLSL ---------- */
const f = (x: number) => {
  const s = x.toPrecision(7);
  return /[.e]/.test(s) ? s : `${s}.`;
};
const v3 = (a: V3) => `vec3(${a.map(f).join(',')})`;
const v4 = (a: number[]) => `vec4(${a.map(f).join(',')})`;
/** 7 セグメントの数字（bit 0〜6 が a〜g）。10 は小数点 */
const SEG = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

/** 被写体の放射輝度 vec3 radiance(vec3 ro, vec3 rd)（m 単位の光線）を返す GLSL */
export function sceneGlsl(): string {
  const bulbs = STRINGS.flat();
  const boxes = STRINGS.map((L) => {
    const lo = [0, 1, 2].map((k) => Math.min(...L.map((b) => b.c[k] - b.r)) - 1e-3),
      hi = [0, 1, 2].map((k) => Math.max(...L.map((b) => b.c[k] + b.r)) + 1e-3);
    return [lo, hi];
  });
  let k = 0;
  const ranges = STRINGS.map((L) => {
    const a = k;
    k += L.length;
    return [a, k];
  });
  /* 板の表記: 1 枚あたり 3 文字（数字 0〜9、小数点 10、なし −1） */
  const lbl = BOARDS.flatMap((b) => {
    const cs = [...b.label].map((ch) => (ch === '.' ? 10 : Number(ch)));
    while (cs.length < 3) cs.push(-1);
    return cs;
  });
  const fr = SKY.map(bodyFrame);
  const byId = (id: SkyBody['id']) => SKY.findIndex((b) => b.id === id);
  const rUnit = (id: SkyBody['id']) => SKY[byId(id)].r;
  /** 環の開き B のときの、本体の楕円の縦の半軸（赤道半径を 1） */
  const minor = (flat: number, tilt: number) =>
    Math.sqrt(Math.sin(tilt * deg) ** 2 + ((1 - flat) * Math.cos(tilt * deg)) ** 2);
  const sat = SKY[byId('saturn')],
    ura = SKY[byId('uranus')];
  return `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

/* 空の天体: 中心の向き・右・上（極で回したもの）・角半径 */
const int NK = ${SKY.length};
const vec3 KC[NK] = vec3[NK](${fr.map((x) => v3(x.c)).join(',')});
const vec3 KE1[NK] = vec3[NK](${fr.map((x) => v3(x.e1)).join(',')});
const vec3 KE2[NK] = vec3[NK](${fr.map((x) => v3(x.e2)).join(',')});
const float KR[NK] = float[NK](${SKY.map((b) => f(angRadius(b))).join(',')});
const vec4 MARE[12] = vec4[12](
  vec4(-0.28, 0.48, 0.24, 0.2), vec4(0.18, 0.43, 0.14, 0.13), vec4(0.38, 0.18, 0.17, 0.14), vec4(0.72, 0.3, 0.09, 0.08),
  vec4(0.62, -0.12, 0.1, 0.15), vec4(0.4, -0.26, 0.08, 0.08), vec4(-0.6, 0.1, 0.22, 0.38), vec4(-0.2, -0.35, 0.15, 0.12),
  vec4(-0.55, -0.38, 0.09, 0.08), vec4(-0.05, 0.78, 0.45, 0.06), vec4(0.05, 0.22, 0.08, 0.07), vec4(-0.38, 0.1, 0.12, 0.1));
const vec4 GAL[4] = vec4[4](${GALILEAN.map((g) => v4([g.x, g.y, g.r / rUnit('jupiter'), g.a / JUP.albedo])).join(',')});
const vec3 GALC[4] = vec3[4](${GALILEAN.map((g) => v3([...g.col] as V3)).join(',')});
const vec4 SRING[4] = vec4[4](${SAT_RINGS.map(([a, b, l, o]) => v4([a / sat.r, b / sat.r, l, o])).join(',')});

/* 天体 i の面の座標（赤道半径を 1、右・上）。後ろ向きなら遠い値 */
vec2 bodyUV(vec3 d, int i) {
  float w = dot(d, KC[i]);
  if (w <= 0.0) return vec2(1e9);
  return vec2(dot(d, KE1[i]), dot(d, KE2[i])) / (w * KR[i]);
}

/* 満月: 明るい高地に、海（暗い楕円）と明るいクレーター（ティコ・コペルニクス）。模様は見た目の近似 */
vec3 moonAt(vec2 p) {
  float r2 = dot(p, p), mu = sqrt(max(1.0 - r2, 0.0));
  float dark = 0.0;
  for (int i = 0; i < 12; i++) {
    vec4 m = MARE[i];
    vec2 q = (p - m.xy) / m.zw;
    dark = max(dark, 1.0 - smoothstep(0.75, 1.15, length(q)));
  }
  float a = mix(1.0, 0.56, dark);
  a *= 0.93 + 0.07 * hash12(floor(p * 90.0));
  a += 0.5 * (1.0 - smoothstep(0.02, 0.035, length(p - vec2(-0.13, -0.72))));
  a += 0.3 * (1.0 - smoothstep(0.015, 0.028, length(p - vec2(-0.3, 0.16))));
  return vec3(0.62, 0.6, 0.56) * a * (0.88 + 0.12 * mu);
}

/* 木星: 帯と縞（緯度で決める）、大赤斑、周縁減光。周りにガリレオ衛星 */
vec3 jupiterAt(vec2 p, vec3 bg) {
  for (int i = 0; i < 4; i++) {
    vec4 g = GAL[i];
    vec2 q = (p - g.xy) / g.z;
    float r2 = dot(q, q);
    if (r2 < 1.0) return GALC[i] * g.w * 0.5 * (0.6 + 0.4 * sqrt(1.0 - r2));
  }
  vec2 q = vec2(p.x, p.y / ${f(1 - JUP.flat)});
  float r2 = dot(q, q);
  if (r2 >= 1.0) return bg;
  float mu = sqrt(1.0 - r2), lat = degrees(asin(clamp(q.y, -1.0, 1.0))), al = abs(lat);
  vec3 zone = vec3(0.96, 0.9, 0.78), belt = vec3(0.7, 0.5, 0.37), c = zone;
  if ((lat > 7.0 && lat < 18.0) || (lat < -7.0 && lat > -20.0)) c = belt;
  else if (lat > 24.0 && lat < 30.0) c = mix(zone, belt, 0.6);
  else if (lat < -26.0 && lat > -32.0) c = mix(zone, belt, 0.45);
  c = mix(c, vec3(0.62, 0.6, 0.58), smoothstep(45.0, 62.0, al));
  vec2 gr = (q - vec2(0.35, -0.375)) / vec2(0.11, 0.075);
  if (dot(gr, gr) < 1.0) c = vec3(0.86, 0.5, 0.36);
  return c * 0.5 * (0.35 + 0.65 * pow(mu, 0.5));
}

/* 土星: 本体（扁平）と環（C・B・カッシーニの間隙・A）。手前の環は本体の前、奥の環は本体の後ろ */
vec3 saturnAt(vec2 p, vec3 bg) {
  float b = ${f(minor(SAT.flat, sat.tilt))}, sb = ${f(Math.sin(sat.tilt * deg))};
  float r2 = p.x * p.x + (p.y / b) * (p.y / b);
  vec3 behind = bg;
  bool inG = r2 < 1.0;
  if (inG) {
    float mu = sqrt(1.0 - r2), y = p.y / b;
    vec3 c = vec3(0.92, 0.82, 0.6);
    if (abs(y + 0.05) < 0.12) c *= 1.05;
    else if (abs(y - 0.22) < 0.08 || abs(y + 0.3) < 0.07) c *= 0.88;
    c = mix(c, vec3(0.72, 0.7, 0.62), smoothstep(0.7, 0.9, y));
    behind = c * 0.42 * (0.4 + 0.6 * pow(mu, 0.6));
  }
  float rr = length(vec2(p.x, p.y / sb));
  for (int i = 0; i < 4; i++) {
    vec4 s = SRING[i];
    if (rr >= s.x && rr < s.y) {
      if (inG && p.y > 0.0) return behind;
      return vec3(0.93, 0.87, 0.75) * 0.42 * s.z + (1.0 - s.w) * behind;
    }
  }
  return behind;
}

/* 天王星: 青緑の本体と ε 環。環は実際の幅（約 ${URA.width} km）と明るさのまま、画素より細い幅を広げた帯に光の量を保って薄める */
vec3 uranusAt(vec2 p, vec3 bg) {
  float b = ${f(minor(URA.flat, ura.tilt))}, sb = ${f(Math.sin(ura.tilt * deg))};
  float r2 = p.x * p.x + (p.y / b) * (p.y / b);
  vec3 behind = bg;
  bool inG = r2 < 1.0;
  if (inG) behind = vec3(0.63, 0.86, 0.9) * 0.36 * (0.5 + 0.5 * sqrt(1.0 - r2));
  float rr = length(vec2(p.x, p.y / sb)), we = 0.02;
  if (abs(rr - ${f(URA.ring / ura.r)}) < we && !(inG && p.y > 0.0)) {
    float k = ${f(URA.width / 2 / ura.r)} / we;
    return vec3(0.6, 0.6, 0.6) * 0.36 * ${f(URA.albedo)} * k + (1.0 - ${f(URA.op)} * k) * behind;
  }
  return behind;
}

vec3 celestial(vec3 d, vec3 bg) {
  vec2 p = bodyUV(d, ${byId('moon')});
  if (dot(p, p) < 1.0) return moonAt(p);
  p = bodyUV(d, ${byId('jupiter')});
  if (dot(p, p) < 900.0) return jupiterAt(p, bg);
  p = bodyUV(d, ${byId('saturn')});
  if (dot(p, p) < 6.0) return saturnAt(p, bg);
  p = bodyUV(d, ${byId('uranus')});
  if (dot(p, p) < 4.5) return uranusAt(p, bg);
  return bg;
}

const int NB = ${BOARDS.length};
const vec4 BRD[NB] = vec4[NB](${BOARDS.map((b) => v4([...b.c, b.r])).join(',')});
const int LBL[NB * 3] = int[NB * 3](${lbl.join(',')});
const int SEG[10] = int[10](${SEG.join(',')});
const int NC = ${CYLS.length};
const vec4 CYL[NC] = vec4[NC](${CYLS.map((c) => v4([c.x, c.z, c.r, c.h])).join(',')});
const vec4 CYC[NC] = vec4[NC](${CYLS.map((c) => v4([...c.col, c.band ? 1 : 0])).join(',')});
const int NL = ${bulbs.length};
const vec4 BLB[NL] = vec4[NL](${bulbs.map((b) => v4([...b.c, b.r])).join(',')});
const vec3 BLE[NL] = vec3[NL](${bulbs.map((b) => v3(b.e)).join(',')});
const vec3 SLO[3] = vec3[3](${boxes.map((b) => v3(b[0] as V3)).join(',')});
const vec3 SHI[3] = vec3[3](${boxes.map((b) => v3(b[1] as V3)).join(',')});
const ivec2 SRG[3] = ivec2[3](${ranges.map(([a, b]) => `ivec2(${a},${b})`).join(',')});
const vec3 LDIR = normalize(vec3(-0.4, 0.8, -0.45));

float ridge(float az) {
  return 0.018 + 0.012 * sin(2.3 * az + 0.7) + 0.007 * sin(5.9 * az + 2.1) + 0.003 * sin(13.0 * az);
}

/* 空（夕暮れ）と天体、遠景の山並みと町の灯（無限遠） */
vec3 sky(vec3 d) {
  float el = asin(clamp(d.y, -1.0, 1.0)), az = atan(d.x, d.z);
  float rg = ridge(az);
  if (el < rg) {
    vec3 c = vec3(0.022, 0.026, 0.04);
    vec2 g = vec2(az, el) / 0.004;
    vec2 cell = floor(g);
    float hs = hash12(cell + 17.0);
    if (hs < 0.32 && el < rg - 0.002) {
      vec2 pc = (cell + 0.2 + 0.6 * vec2(hash12(cell + 3.1), hash12(cell + 7.7))) * 0.004;
      vec2 dd = vec2((az - pc.x) * cos(el), el - pc.y);
      if (dot(dd, dd) < 0.0006 * 0.0006) c += mix(vec3(9.0, 6.0, 2.6), vec3(6.0, 7.0, 8.0), step(0.24, hs));
    }
    return c;
  }
  float s = clamp(el / 0.6, 0.0, 1.0);
  vec3 hor = vec3(0.26, 0.17, 0.2), mid = vec3(0.07, 0.08, 0.17), top = vec3(0.012, 0.022, 0.06);
  return celestial(d, s < 0.25 ? mix(hor, mid, s / 0.25) : mix(mid, top, (s - 0.25) / 0.75));
}

float seg7(vec2 p, int m) {
  /* 1 文字は幅 0.6・高さ 1.0（左下が原点） */
  float w = 0.11, on = 0.0;
  if ((m & 1) != 0 && abs(p.y - 1.0) < w && p.x > 0.05 && p.x < 0.55) on = 1.0;
  if ((m & 2) != 0 && abs(p.x - 0.55) < w && p.y > 0.5 && p.y < 0.95) on = 1.0;
  if ((m & 4) != 0 && abs(p.x - 0.55) < w && p.y > 0.05 && p.y < 0.5) on = 1.0;
  if ((m & 8) != 0 && abs(p.y) < w && p.x > 0.05 && p.x < 0.55) on = 1.0;
  if ((m & 16) != 0 && abs(p.x - 0.05) < w && p.y > 0.05 && p.y < 0.5) on = 1.0;
  if ((m & 32) != 0 && abs(p.x - 0.05) < w && p.y > 0.5 && p.y < 0.95) on = 1.0;
  if ((m & 64) != 0 && abs(p.y - 0.5) < w && p.x > 0.05 && p.x < 0.55) on = 1.0;
  return on;
}

/* 板の模様: ジーメンススター（36 本）、外周の環、下に距離の数字 */
float board(int i, vec2 uv) {
  if (abs(uv.x) > ${f(BOARD_W)} - 0.04 || uv.y > ${f(BOARD_T)} - 0.04 || uv.y < -${f(BOARD_B)} + 0.04) return 0.03;
  float r = length(uv);
  if (r < 1.0) {
    if (r < 0.05) return 0.45;
    float a = atan(uv.y, uv.x);
    return mod(floor(a / 6.2831853 * 36.0 + 36.0), 2.0) < 0.5 ? 0.03 : 0.82;
  }
  if (r < 1.06) return 0.03;
  /* 数字（高さ 0.6、中央にそろえる） */
  float wd = 0.0;
  for (int j = 0; j < 3; j++) {
    int c = LBL[i * 3 + j];
    if (c >= 0) wd += c == 10 ? 0.3 : 0.78;
  }
  vec2 p = (uv - vec2(-wd * 0.3, -1.9)) / 0.6;
  float x = 0.0;
  for (int j = 0; j < 3; j++) {
    int c = LBL[i * 3 + j];
    if (c < 0) break;
    if (c == 10) {
      if (length(p - vec2(x + 0.15, 0.06)) < 0.1) return 0.03;
      x += 0.3;
    } else {
      if (seg7(p - vec2(x + 0.04, 0.0), SEG[c]) > 0.5) return 0.03;
      x += 0.78;
    }
  }
  return 0.82;
}

bool boxHit(vec3 ro, vec3 ird, vec3 lo, vec3 hi, float tmax) {
  vec3 t0 = (lo - ro) * ird, t1 = (hi - ro) * ird;
  vec3 a = min(t0, t1), b = max(t0, t1);
  float tn = max(max(a.x, a.y), a.z), tf = min(min(b.x, b.y), b.z);
  return tf > max(tn, 0.0) && tn < tmax;
}

vec3 radiance(vec3 ro, vec3 rd) {
  float t = 1e20;
  int id = 0;
  vec3 nrm = vec3(0.0, 1.0, 0.0);
  if (rd.y < 0.0) { t = -ro.y / rd.y; id = 1; }
  if (rd.z > 1e-6) {
    float tw = (${f(WALL.z)} - ro.z) / rd.z;
    vec3 p = ro + rd * tw;
    if (tw < t && p.x > ${f(WALL.x0)} && p.x < ${f(WALL.x1)} && p.y > 0.0 && p.y < ${f(WALL.h)}) { t = tw; id = 2; nrm = vec3(0.0, 0.0, -1.0); }
    for (int i = 0; i < NB; i++) {
      vec4 b = BRD[i];
      float tb = (b.z - ro.z) / rd.z;
      if (tb <= 0.0 || tb >= t) continue;
      vec2 uv = (ro.xy + rd.xy * tb - b.xy) / b.w;
      if (abs(uv.x) < ${f(BOARD_W)} && uv.y < ${f(BOARD_T)} && uv.y > -${f(BOARD_B)}) { t = tb; id = 10 + i; nrm = vec3(0.0, 0.0, -1.0); }
    }
  }
  for (int i = 0; i < NC; i++) {
    vec4 c = CYL[i];
    vec2 o = ro.xz - c.xy;
    float a = dot(rd.xz, rd.xz), b = dot(o, rd.xz), cc = dot(o, o) - c.z * c.z;
    float disc = b * b - a * cc;
    if (disc < 0.0 || a < 1e-12) continue;
    float tc = (-b - sqrt(disc)) / a;
    float y = ro.y + rd.y * tc;
    if (tc > 0.0 && tc < t && y > 0.0 && y < c.w) {
      t = tc; id = 30 + i;
      nrm = vec3(o.x + rd.x * tc, 0.0, o.y + rd.z * tc) / c.z;
    }
  }
  vec3 ird = 1.0 / rd;
  for (int s = 0; s < 3; s++) {
    if (!boxHit(ro, ird, SLO[s], SHI[s], t)) continue;
    for (int i = SRG[s].x; i < SRG[s].y; i++) {
      vec4 b = BLB[i];
      vec3 o = ro - b.xyz;
      float bb = dot(o, rd), cc = dot(o, o) - b.w * b.w, disc = bb * bb - cc;
      if (disc < 0.0) continue;
      float ts = -bb - sqrt(disc);
      if (ts > 0.0 && ts < t) { t = ts; id = 100 + i; }
    }
  }
  if (id == 0) return sky(rd);
  if (id >= 100) return BLE[id - 100];
  vec3 p = ro + rd * t, alb;
  if (id == 1) {
    vec2 q = floor(p.xz / 0.5);
    float ck = mod(q.x + q.y, 2.0);
    alb = mix(vec3(0.2, 0.195, 0.185), vec3(0.32, 0.31, 0.29), ck);
    /* 遠くは縞が細かくなりすぎるので平均の色へ寄せる */
    alb = mix(alb, vec3(0.26, 0.252, 0.238), smoothstep(60.0, 400.0, t));
  } else if (id == 2) {
    vec2 g = abs(fract(p.xy / ${f(WALL.grid)} + 0.5) - 0.5) * ${f(WALL.grid)};
    alb = min(g.x, g.y) < ${f(WALL.line / 2)} ? vec3(0.78, 0.78, 0.75) : vec3(0.06, 0.065, 0.075);
  } else if (id < 30) {
    vec4 b = BRD[id - 10];
    alb = vec3(board(id - 10, (p.xy - b.xy) / b.w));
  } else {
    vec4 c = CYC[id - 30];
    alb = c.rgb;
    if (c.w > 0.5 && fract(p.y / 0.4) < 0.1) alb = vec3(0.8);
  }
  return alb * (0.4 + 0.6 * max(dot(nrm, LDIR), 0.0));
}
`;
}
