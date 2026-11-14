/**
 * 8 日巻きの置時計（時打ち付き）の計算。長さは mm（y は上が正）、正面から見た図の座標で、文字盤の中心が原点。
 * 時計の輪列: 香箱 → 中間車 → 2 番車（分針、1 時間に 1 回転）→ 3 番車 → がんぎ車 → アンクルと振り子。
 * 時打ちの輪列: 香箱 → 中間車 → ピン車（ハンマー）→ 止め車 → 予告車 → 風切り。数取り車は裏板の外。
 * 実際の速さ以下では歯と爪の接触まで解き（live）、早送りでは表の振り角と周期で進める（avg）
 */
import { DEG, D as ED, R as ER, ESC_DT, EscSim, type EscType, PEND, PITCH, TAU, TYPES } from './esc';
import { RAW, type RawTable, type Row } from './tables';

export { DEG, type EscType, TAU, TYPES };
export const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
export type Pt = [number, number];
const add = (a: Pt, r: number, ang: number): Pt => [a[0] + r * Math.cos(ang), a[1] + r * Math.sin(ang)];
/** a から ra、b から rb の距離にある点（side で左右を選ぶ） */
function meet(a: Pt, ra: number, b: Pt, rb: number, side: number): Pt {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    d = Math.hypot(dx, dy),
    x = (ra * ra - rb * rb + d * d) / (2 * d),
    h = Math.sqrt(Math.max(0, ra * ra - x * x)),
    ux = dx / d,
    uy = dy / d;
  return [a[0] + ux * x - side * uy * h, a[1] + uy * x + side * ux * h];
}

/* ===== 部品の位置 ===== */
export type Train = 'go' | 'st' | 'mw';
export interface Wheel {
  id: string;
  name: string;
  c: Pt;
  /** 歯数・モジュール・ピッチ円の半径 */
  z?: number;
  m?: number;
  r: number;
  tr: Train;
  /** 同じ軸のかな */
  pin?: { z: number; m: number };
  /** スポークの本数 */
  spk?: number;
  barrel?: boolean;
  fly?: boolean;
  /** 裏板の外（数取り車） */
  back?: boolean;
  /** 前板の前（表輪列） */
  front?: boolean;
  /** ピン車のハンマーのピン */
  pins?: number;
  pinR?: number;
}
const E: Pt = [0, 28],
  C: Pt = [0, 0],
  B: Pt = [22, -26],
  SB: Pt = [-22, -26];
const pr = (z: number, m: number) => (z * m) / 2;
const P3 = meet(C, pr(80, 0.4) + pr(8, 0.4), E, pr(72, 0.3) + pr(6, 0.3), -1),
  PI = meet(C, pr(48, 0.45) + pr(12, 0.45), B, pr(72, 0.5) + pr(12, 0.5), 1),
  SI = add(SB, pr(72, 0.5) + pr(8, 0.5), 107 * DEG),
  PW = add(SI, pr(40, 0.45) + pr(16, 0.45), 62 * DEG),
  LW = add(PW, pr(64, 0.3) + pr(8, 0.3), 78 * DEG),
  WW = add(LW, pr(56, 0.25) + pr(7, 0.25), 128 * DEG),
  FL = add(WW, pr(48, 0.22) + pr(6, 0.22), 96 * DEG),
  CW = add(PW, pr(90, 0.36) + pr(8, 0.36), 186 * DEG),
  MW = add(C, 7.5, 222 * DEG);
const LIST: Omit<Wheel, 'r'>[] = [
  { id: 'esc', name: 'がんぎ車', c: E, z: 30, tr: 'go', pin: { z: 6, m: 0.3 } },
  { id: 'w3', name: '3 番車', c: P3, z: 72, m: 0.3, tr: 'go', pin: { z: 8, m: 0.4 }, spk: 4 },
  { id: 'w2', name: '2 番車', c: C, z: 80, m: 0.4, tr: 'go', pin: { z: 12, m: 0.45 }, spk: 5 },
  { id: 'wi', name: '中間車', c: PI, z: 48, m: 0.45, tr: 'go', pin: { z: 12, m: 0.5 }, spk: 4 },
  { id: 'bar', name: '香箱（時計）', c: B, z: 72, m: 0.5, tr: 'go', barrel: true },
  { id: 'sbar', name: '香箱（時打ち）', c: SB, z: 72, m: 0.5, tr: 'st', barrel: true },
  { id: 'si', name: '中間車（時打ち）', c: SI, z: 40, m: 0.45, tr: 'st', pin: { z: 8, m: 0.5 }, spk: 4 },
  { id: 'pw', name: 'ピン車', c: PW, z: 64, m: 0.3, tr: 'st', pin: { z: 16, m: 0.45 }, spk: 4, pins: 8, pinR: 7.4 },
  { id: 'lw', name: '止め車', c: LW, z: 56, m: 0.25, tr: 'st', pin: { z: 8, m: 0.3 }, spk: 4 },
  { id: 'ww', name: '予告車', c: WW, z: 48, m: 0.22, tr: 'st', pin: { z: 7, m: 0.25 }, spk: 4 },
  { id: 'fly', name: '風切り', c: FL, tr: 'st', pin: { z: 6, m: 0.22 }, fly: true },
  { id: 'cw', name: '数取り車', c: CW, z: 90, m: 0.36, tr: 'st', back: true },
  { id: 'cannon', name: '筒かな', c: C, z: 12, m: 0.3125, tr: 'mw', front: true },
  { id: 'mw', name: '日の裏車', c: MW, z: 36, m: 0.3125, tr: 'mw', pin: { z: 10, m: 0.3 }, front: true, spk: 3 },
  { id: 'hw', name: '筒車', c: C, z: 40, m: 0.3, tr: 'mw', front: true },
];
export const W: Record<string, Wheel> = Object.fromEntries(
  LIST.map((w) => [w.id, { ...w, r: w.id === 'esc' ? ER : w.z && w.m ? pr(w.z, w.m) : 0 }]),
);
export const GEO = {
  E,
  C,
  /** アンクルの支点・振り子の吊り点 */
  P: [E[0], E[1] + ED] as Pt,
  SUS: [E[0], E[1] + ED + 7] as Pt,
  /** 地板の外形 [x0, y0, x1, y1]（裏に付く数取り車まで収める） */
  plate: [-58, -50, 52, 56] as [number, number, number, number],
  /** 音の模型の地板（104×106 mm）の外形。図の地板を広げても音は変えない */
  soundPlate: [-52, -50, 52, 56] as [number, number, number, number],
  /** 箱の裏板の外形（ゴングの台を留める。ゴングと振り子まで収める） */
  caseBack: [-66, -108, 70, 64] as [number, number, number, number],
  /** 持ち上げレバー・止めレバー・ハンマーの支点 */
  lift: [-15, 9] as Pt,
  lock: [-31, 24] as Pt,
  ham: [-44, -5] as Pt,
  /** ゴングの台（渦巻きの根元）と渦巻きの中心 */
  /* 根元はゴングの中心から 55.6 mm・218° の所。ハンマーの頭が線へほぼ真っすぐ当たる配置（2026-11-14） */
  gongBase: [8 + 55.6 * Math.cos((218 * Math.PI) / 180), -10 + 55.6 * Math.sin((218 * Math.PI) / 180)] as Pt,
  gongC: [8, -10] as Pt,
};

/* ===== 輪列の比: adv はがんぎ車の進んだ角（時計回りが正）。各車の角も時計回りを正にする ===== */
export const RATIO: Record<string, number> = {
  esc: 1,
  w3: -6 / 72,
  w2: (6 / 72) * (8 / 80),
  wi: -(6 / 72) * (8 / 80) * (12 / 48),
  bar: (6 / 72) * (8 / 80) * (12 / 48) * (12 / 72),
};
/** 時打ち: s は打った数（続いた値）。止め車は 1 打ちで 1 回転 */
export const SRATIO: Record<string, number> = {
  lw: 1,
  pw: -1 / 8,
  si: (1 / 8) * (16 / 40),
  sbar: -(1 / 8) * (16 / 40) * (8 / 72),
  ww: -(56 / 7),
  fly: (56 / 7) * (48 / 6),
  cw: (1 / 8) * (8 / 90),
};
/** がんぎ車は 1 秒に 1 歯（2 振り）進む */
export const ADV_PER_SEC = 12 * DEG;

/* ===== ゼンマイ: n は巻いてある回数（香箱の回転）。時計は 1 日 1 回転を使う ===== */
export const SPRING = { N: 8.4, click: 12, windRate: 0.9 };
const fRaw = (n: number) => (n <= 0 ? 0 : (0.42 + 0.58 * Math.min(1, n / SPRING.N)) * (1 - Math.exp(-n / 0.35)));
/** 力の割合（巻き切りで 1） */
export const springF = (n: number): number => fRaw(n) / fRaw(SPRING.N);

/* ===== 数取り車: 12 時間に 90 打ち。0 時 30 分の 1 打ち → 1 時の 1 打ち → … → 12 時の 12 打ち ===== */
export const SEQ: number[] = [];
for (let h = 1; h <= 12; h++) SEQ.push(1, h);
export const SLOT: number[] = [0];
for (const k of SEQ) SLOT.push(SLOT[SLOT.length - 1] + k);
/** 12 時間の中の分から、最後に打ち終えた数取り車の位置 */
export const countAt = (min12: number): number => SLOT[Math.floor(min12 / 30)];

/* ===== 時打ちの仕掛けの形: 図と時打ちの時刻の両方がこれを使う。部品はピンや溝に当たって動く ===== */
const rotAbout = (pv: Pt, p: Pt, a: number): Pt => [
  pv[0] + (p[0] - pv[0]) * Math.cos(a) - (p[1] - pv[1]) * Math.sin(a),
  pv[1] + (p[0] - pv[0]) * Math.sin(a) + (p[1] - pv[1]) * Math.cos(a),
];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** 点 p と線分 ab の距離 */
const segDist = (p: Pt, a: Pt, b: Pt) => {
  const vx = b[0] - a[0],
    vy = b[1] - a[1],
    t = clamp(((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy || 1), 0, 1);
  return Math.hypot(a[0] + vx * t - p[0], a[1] + vy * t - p[1]);
};
/**
 * 押されて回る部品の角: 角 0 で重なっていれば、重ならなくなるまで回した最小の角（押し上げられる）。
 * 重なっていなければ 0（休む位置）。over(a) は角 a で重なるか
 */
function pushed(over: (a: number) => boolean, amax = 40 * DEG): number {
  if (!over(0)) return 0;
  let lo = 0,
    hi = 0;
  for (let a = 0.5 * DEG; a <= amax; a += 0.5 * DEG)
    if (!over(a)) {
      hi = a;
      break;
    } else lo = a;
  if (!hi) return amax;
  for (let i = 0; i < 22; i++) {
    const m = (lo + hi) / 2;
    if (over(m)) lo = m;
    else hi = m;
  }
  return hi;
}
/** 支点 pv から半径 r の円（中心 c）に接する点の角。sign で 2 つのうちどちらかを選ぶ */
function tangentAng(c: Pt, r: number, pv: Pt, sign: number): number {
  const dx = c[0] - pv[0],
    dy = c[1] - pv[1];
  return Math.atan2(dy, dx) + Math.PI - sign * Math.acos(r / Math.hypot(dx, dy));
}
/** 渦巻きのゴングの線: t = 0 が根元（台、外の端）、1 が先。根元から内へ 1.55 回巻く */
export function gongAt(t: number): Pt {
  const g = GEO.gongC,
    b = GEO.gongBase,
    r0 = Math.hypot(b[0] - g[0], b[1] - g[1]),
    a0 = Math.atan2(b[1] - g[1], b[0] - g[0]),
    r = r0 - 11 * t,
    a = a0 - t * 1.55 * TAU;
  return [g[0] + r * Math.cos(a), g[1] + r * Math.sin(a)];
}
/**
 * 寸法 [mm]。持ち上げレバー（支点 L）は筒かなのピン 2 本に先を押されて反時計回りに上がり、ピンが抜けると落ちる。
 * レバーのピン G が止めレバー（支点 K）の腕を押して時計回りに上げ、止め車の切り欠きから止めの爪を抜く（予告）。
 * レバーの旗（G から F）は予告車のピンの通り道に入り、予告の間は輪列を止める。止めレバーの尾は数取り車の縁に乗り、
 * 溝に落ちると止まる。ハンマー（支点 H）は尾をピン車のピンに押されて上がり、ピンが外れると落ちてゴングを打つ
 */
export const SK = (() => {
  const L: Pt = GEO.lift,
    K: Pt = GEO.lock,
    H: Pt = GEO.ham,
    lw = W.lw.c,
    cw = W.cw.c,
    ww = W.ww.c,
    pw = W.pw.c,
    /* 止めの爪は止め車の半径 3.3 の所で、時計回りに上げると真っすぐ外へ出る位置に置く */
    detA = tangentAng(lw, 3.3, K, -1),
    det = add(lw, 3.3, detA),
    /* 数取り車の尾も、上げると真っすぐ外へ出る位置（溝の底から 0.6 浮かせる） */
    tailA = tangentAng(cw, W.cw.r - 1.6, K, -1),
    tail = add(cw, W.cw.r - 1.6, tailA),
    wpt: Pt = [-29.5, 15.5],
    /* 止めレバーの腕（wpt から det）の付け根から 0.35 の所の上に、0.15 のすき間をあけて G を置く（上げきっても腕から外れない） */
    q: Pt = [wpt[0] + (det[0] - wpt[0]) * 0.35, wpt[1] + (det[1] - wpt[1]) * 0.35],
    al = Math.hypot(det[0] - wpt[0], det[1] - wpt[1]),
    nrm: Pt = [-(det[1] - wpt[1]) / al, (det[0] - wpt[0]) / al],
    G: Pt = [q[0] + nrm[0] * 1.25, q[1] + nrm[1] * 1.25],
    /*
     * 旗: 予告車の右上で、持ち上げると予告車の中心へ真っすぐ入る所（L から半径 4.7 の円に接する点）に指の先 Ft を置く。
     * 腕は L から右を回って F へ行き、休んでいるときは予告ピンの通り道（半径 3.3 ± 0.7）の外にある
     */
    ftA = tangentAng(ww, 4.7, L, -1),
    Ft = add(ww, 4.7, ftA),
    F = add(ww, 6.7, ftA),
    fk: Pt = [-14, 18],
    tip: Pt = [L[0] + 9.75, L[1] - 6.09],
    /* ハンマー: 尾はピン車の半径 7.0 の所（ピンの通り道の中）。頭はゴングの根元近くの線の外側に 0.3 離して休む */
    htail = add(pw, 7.0, Math.atan2(H[1] - pw[1], H[0] - pw[0])),
    wp = gongAt(0.03),
    head = add(wp, 2.6 + 0.6 + 0.3, Math.atan2(wp[1] - GEO.gongC[1], wp[0] - GEO.gongC[0]));
  return {
    L,
    K,
    H,
    tip,
    G,
    F,
    Ft,
    fk,
    det,
    detA,
    tail,
    tailA,
    wpt,
    htail,
    head,
    /** 筒かなのピン（中心から 5.5、半径 0.8）と位相 */
    cPin: { R: 5.5, r: 0.8, off: 0 },
    tipR: 0.5,
    gR: 0.6,
    armW: 0.5,
    flagR: 0.5,
    /** 止め車の切り欠きのカム: 外 4.0・底 2.6・幅 ±15°。止めた所（s が整数）で切り欠きが爪の向きに来る */
    cam: { R: 4.0, floor: 2.6, half: 15 * DEG, off: 0 },
    detR: 0.4,
    /** 数取り車の溝の深さと、溝の後ろの坂の長さ（打った数の単位） */
    /* early: 止めの爪が止め車の切り欠きに入ってから、切り欠きの壁が爪に当たって止まるまでの進み */
    slot: { depth: 2.2, ramp: 0.04, early: 0.02 },
    tailR: 0.4,
    /** 予告車のピン（半径 3.3、太さ 0.7）と位相 */
    wPin: { R: 3.3, r: 0.7, ph: 0 },
    /** ピン車のピン（半径 7.4、太さ 0.75、8 本）と位相 */
    hPin: { R: 7.4, r: 0.75, ph: 0, n: 8 },
    htailR: 0.6,
    headR: 2.6,
  };
})();
/** 持ち上げレバーの角（反時計回り）。min12 は 12 時間の中の分 */
function liftRaw(min12: number, off: number): number {
  const hand = Math.PI / 2 - TAU * (min12 / 60),
    pins = [0, Math.PI].map((k) => add([0, 0], SK.cPin.R, hand + off + k));
  return pushed((a) => {
    const t = rotAbout(SK.L, SK.tip, a);
    return pins.some((p) => dist(p, t) < SK.cPin.r + SK.tipR || segDist(p, SK.L, t) < SK.cPin.r + SK.armW);
  });
}
/* 落ちる時刻を正時と 30 分にそろえるピンの位相（6° で 1 分） */
{
  let drop = 0;
  for (let m = 0; m < 30; m += 0.01) if (liftRaw(m, 0) > 0 && liftRaw(m + 0.01, 0) === 0) drop = m + 0.01;
  SK.cPin.off = (30 - drop) * 6 * DEG;
}
/** 持ち上げレバーの角の表（0.1 秒おき） */
const LIFT_N = 18000,
  LIFT_TAB = Float32Array.from({ length: LIFT_N }, (_, i) => liftRaw((i * 30) / LIFT_N, SK.cPin.off));
export function liftPhi(min12: number): number {
  const x = (((min12 % 30) + 30) % 30) * (LIFT_N / 30),
    i = Math.floor(x),
    a = LIFT_TAB[i % LIFT_N],
    b = LIFT_TAB[(i + 1) % LIFT_N];
  /* 落ちる所は補間しない */
  return b === 0 || a === 0 ? a : a + (b - a) * (x - i);
}
/** 持ち上げレバーの G と F の位置 */
export const liftAt = (phi: number): { G: Pt; F: Pt; Ft: Pt } => ({
  G: rotAbout(SK.L, SK.G, phi),
  F: rotAbout(SK.L, SK.F, phi),
  Ft: rotAbout(SK.L, SK.Ft, phi),
});
/** 点 p と止めレバーの腕（K から wpt、wpt から det）の距離。a は止めレバーの角（時計回り） */
export function lockArmDist(p: Pt, a: number): number {
  const w = rotAbout(SK.K, SK.wpt, -a);
  return Math.min(segDist(p, SK.K, w), segDist(p, w, rotAbout(SK.K, SK.det, -a)));
}
/**
 * 持ち上げレバーの G が止めレバーを押す角（時計回り）の表。レバーを少しずつ上げ、前の角から続けて解く:
 * 重なれば押し上げ、重ならなければ G に触れるまで落とす
 */
const LOCK_TAB = (() => {
  const t = new Float32Array(1001);
  let prev = 0;
  for (let i = 0; i <= 1000; i++) {
    const g = liftAt(i * 0.02 * DEG).G,
      over = (a: number) => lockArmDist(g, a) < SK.gR + SK.armW;
    let a = prev;
    if (over(a)) while (over(a)) a += 0.005 * DEG;
    else {
      while (a > 0 && !over(a - 0.005 * DEG)) a -= 0.005 * DEG;
      a = Math.max(0, a);
    }
    t[i] = prev = a;
  }
  return t;
})();
export function lockByLift(phi: number): number {
  const x = clamp(phi / (0.02 * DEG), 0, 1000),
    i = Math.min(999, Math.floor(x));
  return LOCK_TAB[i] + (LOCK_TAB[i + 1] - LOCK_TAB[i]) * (x - i);
}
/*
 * 止め車は時計回りに回る。止めた所（s が整数）で、切り欠きの後ろの壁が止めの爪に当たるよう、切り欠きの真ん中を
 * 爪から (幅の半分 − 爪の幅の半分) だけ時計回りにずらす
 */
SK.cam.off = -(SK.cam.half - Math.asin(SK.detR / 3.3));
/** 止めの爪が止め車のカムの外に出ているか */
export const detClear = (psi: number): boolean =>
  dist(rotAbout(SK.K, SK.det, -psi), W.lw.c) >= SK.cam.R + SK.detR + 0.05;
/** 数取り車の縁の半径（尾の下）。c は数取り車の位置（打った数） */
export function rimAt(c: number): number {
  let d = Number.POSITIVE_INFINITY;
  for (const p of SLOT) for (const q of [p, p + 90]) if (Math.abs(c - q) < Math.abs(d)) d = c - q;
  const r = W.cw.r,
    lo = r - SK.slot.depth;
  if (d < -SK.slot.early || d > SK.slot.ramp) return r;
  return d <= 0.005 ? lo : lo + ((d - 0.005) / (SK.slot.ramp - 0.005)) * SK.slot.depth;
}
/** 数取り車の縁が止めレバーを持ち上げる角 */
export function lockByRim(c: number): number {
  const need = rimAt(c) + SK.tailR + 0.1;
  return pushed((a) => dist(rotAbout(SK.K, SK.tail, -a), W.cw.c) < need);
}
/** 予告車のピンの位置。s は時打ちの位置 */
export const wPinAt = (s: number): Pt => add(W.ww.c, SK.wPin.R, SK.wPin.ph + 8 * s * TAU);
/** 旗の指（F から Ft の線分）にピンが当たるか */
const flagHits = (pin: Pt, phi: number) => {
  const { F, Ft } = liftAt(phi);
  return segDist(pin, F, Ft) < SK.wPin.r + SK.flagR;
};
/** 予告: 止めた所から旗に当たるまでの時打ちの進み（予告車の 1 回転のうちに当たらなければ null） */
function warnRaw(phi: number): number | null {
  let k = 0;
  while (k <= 250 && !flagHits(wPinAt(k * 0.0005), phi)) k++;
  if (k > 250) return null;
  if (k === 0) return 0;
  let lo = (k - 1) * 0.0005,
    hi = k * 0.0005;
  for (let i = 0; i < 16; i++) {
    const m = (lo + hi) / 2;
    if (flagHits(wPinAt(m), phi)) hi = m;
    else lo = m;
  }
  return lo;
}
/** 止めの爪が外れる持ち上げレバーの角 */
export const PHI_UNLOCK = (() => {
  for (let i = 0; i <= 1000; i++) if (detClear(lockByLift(i * 0.02 * DEG))) return i * 0.02 * DEG;
  return Number.POSITIVE_INFINITY;
})();
/* 予告ピンの位相: 止めの爪が外れる角のレバーで、0.06 だけ進んで旗に当たるようにする */
{
  const { F, Ft } = liftAt(PHI_UNLOCK),
    on = (a: number) => segDist(add(W.ww.c, SK.wPin.R, a), F, Ft) < SK.wPin.r + SK.flagR;
  let hit = 0;
  for (let k = 0; k < 3600; k++) {
    const a = (k / 3600) * TAU;
    if (on(a) && !on(a - TAU / 3600)) {
      hit = a;
      break;
    }
  }
  SK.wPin.ph = hit - 0.06 * 8 * TAU;
}
const WARN_TAB = Array.from({ length: 1001 }, (_, i) => warnRaw(i * 0.02 * DEG));
export function warnDelta(phi: number): number | null {
  return WARN_TAB[clamp(Math.round(phi / (0.02 * DEG)), 0, 1000)];
}
/** ピン車のピン。s は時打ちの位置 */
export const hPinsAt = (s: number): Pt[] =>
  Array.from({ length: SK.hPin.n }, (_, k) =>
    add(W.pw.c, SK.hPin.R, SK.hPin.ph + (s / SK.hPin.n) * TAU + (k * TAU) / SK.hPin.n),
  );
/** ハンマーの角（時計回りが持ち上がる向き） */
function hamRaw(s: number): number {
  const pins = hPinsAt(s);
  return pushed((a) => {
    const t = rotAbout(SK.H, SK.htail, -a);
    /* 尾の先の丸みと、尾の腕の横腹の両方で当たる */
    return pins.some((p) => dist(p, t) < SK.hPin.r + SK.htailR || segDist(p, SK.H, t) < SK.hPin.r + SK.armW);
  });
}
/** ピンが外れる所を 1 打ちの 0.75 にそろえる。u0 は持ち上げ始める所、max は外れる直前の角、hit はゴングを打つ角 */
export const HAM = (() => {
  let rel = 0;
  for (let u = 0; u < 1; u += 0.001) if (hamRaw(u) > 0 && hamRaw(u + 0.001) === 0) rel = u + 0.001;
  SK.hPin.ph = ((rel - 0.75) / SK.hPin.n) * TAU;
  let u0 = 0.75;
  while (u0 > 0 && hamRaw(u0 - 0.001) > 0) u0 -= 0.001;
  /* 打った瞬間の角: 頭がゴングの線に触れる所（休む位置から反時計回り） */
  const wire = Array.from({ length: 201 }, (_, i) => gongAt(i / 1000)),
    gap = (a: number) => {
      const h = rotAbout(SK.H, SK.head, -a);
      return Math.min(...wire.map((w) => dist(w, h))) - SK.headR - 0.6;
    };
  let hit = 0;
  while (hit > -5 * DEG && gap(hit) > 0) hit -= 0.01 * DEG;
  return { u0, max: hamRaw(0.749), hit };
})();
const HAM_TAB = Float32Array.from({ length: 1000 }, (_, i) => hamRaw(i / 1000));
export function hamAngle(s: number): number {
  const u = s - Math.floor(s);
  return HAM_TAB[Math.min(999, Math.floor(u * 1000))];
}

/* ===== 定常の表 ===== */
export interface Table {
  T: number;
  rows: readonly Row[];
  /** これより弱いと止まる力の割合・止まる直前の振り角 */
  fStop: number;
  Aon: number;
  /** f = 0.7 の周期（この周期を 1 s に合わせた竿の長さで動かす＝調整済みの時計） */
  P07: number;
  A: (f: number) => number;
  P: (f: number) => number;
}
function interp(rows: readonly Row[], f: number, k: 'A' | 'P'): number {
  if (f <= rows[0].f) return rows[0][k];
  for (let i = 1; i < rows.length; i++)
    if (f <= rows[i].f) {
      const a = rows[i - 1],
        b = rows[i],
        u = (f - a.f) / (b.f - a.f);
      return a[k] + (b[k] - a[k]) * u;
    }
  return rows[rows.length - 1][k];
}
export function makeTable(raw: RawTable): Table {
  const rows = [...raw.rows].sort((a, b) => a.f - b.f),
    P07 = interp(rows, 0.7, 'P');
  return {
    T: raw.T,
    rows,
    fStop: rows[0].f * 0.97,
    Aon: rows[0].A,
    P07,
    A: (f) => interp(rows, f, 'A'),
    P: (f) => interp(rows, f, 'P') / P07,
  };
}
export const TABLES = Object.fromEntries((Object.keys(RAW) as EscType[]).map((k) => [k, makeTable(RAW[k])])) as Record<
  EscType,
  Table
>;
/** 進み遅れ [s/日]（正が進み） */
export const rateOf = (type: EscType, f: number): number => (1 / TABLES[type].P(f) - 1) * 86400;

/** 手でつかんで動かせる振れ角の上限（当たり止めの 8° まで） [rad] */
const BANK_MAX = 8 * DEG;

/* ===== 時計の全体 ===== */
export type StrikeState = 'lock' | 'warn0' | 'warn' | 'run';
/** 時計の出来事。t は実際の速さで動かしているときの計算の時刻 [s]（音を出す時刻を合わせるため） */
export type ClockEvent = (
  | { k: 'tick'; side: 0 | 1; v: number }
  | { k: 'free'; side: 0 | 1; F?: number; vt?: number }
  | { k: 'bank'; v: number }
  | { k: 'hit'; side: 0 | 1; J: number; d: number; v: number; x: number; y: number; nx: number; ny: number }
  | { k: 'click'; w: 'T' | 'S' }
  | { k: 'full'; w: 'T' | 'S' }
  | { k: 'gong'; f: number; n: number }
  | { k: 'unlock' | 'warn' | 'lock' }
) & { t?: number };
interface Quake {
  t0: number;
  dur: number;
  f: (u: number) => number;
  quake: boolean;
}
export interface Saved {
  v: 1;
  type: EscType;
  adv: number;
  nT: number;
  nS: number;
  clock0: number;
  A: number;
  stopped: boolean;
  s: number;
  sst: StrikeState;
  wall: number;
}
export interface Snap {
  type: EscType;
  mode: 'live' | 'avg';
  adv: number;
  th: number;
  A: number;
  stopped: boolean;
  nT: number;
  nS: number;
  fT: number;
  fS: number;
  s: number;
  sst: StrikeState;
  sw: number;
  hamT: number;
  lift: number;
  clockMs: number;
  Fn: [number, number];
  blows: number;
  next: number;
  gx: number;
  quake: boolean;
}
/** 12 時間の中の分（その時刻の地方時） */
export function min12Of(ms: number): number {
  const off = new Date(ms).getTimezoneOffset();
  return (((ms / 60000 - off) % 720) + 720) % 720;
}
export class Clock {
  type: EscType;
  adv = 0;
  nT = SPRING.N;
  nS = SPRING.N;
  /** adv = 0 のときに時計が示す時刻 [ms] */
  clock0: number;
  /** 計算の上の実際の時刻 [ms]（実際の速さ以外で先へ進む） */
  real: number;
  mode: 'live' | 'avg' = 'live';
  /** 振り角 [°] */
  A = 0;
  stopped = false;
  live: EscSim | null = null;
  readonly events: ClockEvent[] = [];
  /* 時打ち: s は打った数、sw はその速さ [打ち/s]、hamT はハンマーが落ちてからの時間 */
  s: number;
  sw = 0;
  sst: StrikeState = 'lock';
  hamT = 9;
  blowsThis = 0;
  sTarget = 0;
  windT = false;
  windS = false;
  /* 揺れ: 台の加速度の関数・台の変位 [mm] と速さ */
  gq: Quake | null = null;
  gx = 0;
  gv = 0;
  private ampHold = 0;
  /** 持ち上げレバーを決めた最後の時刻（12 時間の中の分） */
  private liftMin = -1;
  constructor(type: EscType = 'recoil', now = Date.now()) {
    this.type = type;
    this.clock0 = now;
    this.real = now;
    this.s = countAt(this.min12());
    this.A = this.tab.A(this.fT());
    this.startLive();
  }
  get tab(): Table {
    return TABLES[this.type];
  }
  fT(): number {
    return springF(this.nT);
  }
  fS(): number {
    return springF(this.nS);
  }
  clockMs(): number {
    return this.clock0 + (this.adv / ADV_PER_SEC) * 1000;
  }
  min12(): number {
    return min12Of(this.clockMs());
  }
  setType(type: EscType): void {
    this.type = type;
    if (this.mode === 'live') this.startLive();
  }
  /** 速さを切り替える。live: 歯の接触まで解く。avg: 表で進める */
  setMode(mode: 'live' | 'avg'): void {
    if (mode === this.mode) return;
    if (mode === 'avg') this.live = null;
    this.mode = mode;
    if (mode === 'live') this.startLive();
  }
  private startLive(): void {
    const L = PEND.L * this.tab.P07 ** -2,
      A = this.stopped ? Math.max(0.02, this.A) : Math.max(0.3, this.A),
      s = new EscSim(this.type, { T: this.tab.T * this.fT(), A, L });
    s.adv = Math.round(this.adv / PITCH) * PITCH - 6 * DEG;
    this.live = s;
    this.ampHold = A;
    this.adv = s.adv;
  }
  /** 振り子のおもりを手でつかむ。th は目標の振れ角 [rad]、null で離す。実際の速さ以下のときだけ */
  grab(th: number | null): void {
    if (!this.live || this.mode !== 'live') return;
    this.live.grab = th === null ? null : clamp(th, -BANK_MAX, BANK_MAX);
    if (th !== null) this.stopped = false;
  }
  get grabbed(): boolean {
    return this.live?.grab != null;
  }
  /** ゼンマイの巻きを決める。n は巻いてある回数 */
  setWind(w: 'T' | 'S', n: number): void {
    const v = clamp(n, 0, SPRING.N);
    if (w === 'T') this.nT = v;
    else this.nS = v;
  }
  /** 止まった振り子を押す */
  push(): void {
    this.stopped = false;
    if (this.live) {
      this.live.th = -3.6 * DEG;
      this.live.om = 0;
      this.ampHold = 3.6;
    }
    this.A = Math.max(this.A, 3.6);
  }
  /**
   * 台を振り子の振れる向きに揺らす。a は最大の加速度 [m/s²]。
   * push: 0.3 s の 1 往復。quake: 20 s の地震（0.5〜5 Hz の正弦 14 本、立ち上がり 2 s・強い揺れ 6 s・減衰）
   */
  shake(kind: 'push' | 'quake', a: number, seed = Date.now()): void {
    if (!this.live) return;
    const t0 = this.live.t;
    if (kind === 'push') {
      const T = 0.3;
      this.gq = { t0, dur: T, f: (u) => a * Math.sin((2 * Math.PI * u) / T), quake: false };
      return;
    }
    let x = (seed & 0xffff) + 7;
    const rnd = () => {
        x = (x * 1103515245 + 12345) >>> 0;
        return x / 4294967296;
      },
      comp: [number, number, number][] = [];
    for (let i = 0; i < 14; i++) {
      const f = 0.5 * 10 ** rnd();
      comp.push([2 * Math.PI * f, rnd() * 2 * Math.PI, f ** -0.4 * (0.6 + 0.8 * rnd())]);
    }
    const env = (u: number) => (u < 2 ? (u / 2) ** 2 : u < 8 ? 1 : Math.exp(-(u - 8) / 3.5)),
      raw = (u: number) => {
        let v = 0;
        for (const [w, p, k] of comp) v += k * Math.sin(w * u + p);
        return v * env(u);
      };
    let pk = 0;
    for (let u = 0; u < 20; u += 0.01) pk = Math.max(pk, Math.abs(raw(u)));
    this.gq = { t0, dur: 20, f: (u) => (a * raw(u)) / pk, quake: true };
  }
  private agAt(t: number): number {
    const q = this.gq;
    if (!q) return 0;
    const u = t - q.t0;
    if (u > q.dur) {
      this.gq = null;
      return 0;
    }
    return u < 0 ? 0 : q.f(u);
  }
  /** 台の変位（図を動かすため）。揺れのあとはゆっくり元へ戻す */
  private ground(ag: number, dt: number): void {
    const w = 2 * Math.PI * 0.35;
    this.gv += (ag * 1000 - 1.8 * w * this.gv - w * w * this.gx) * dt;
    this.gx += this.gv * dt;
    if (!this.gq && Math.abs(this.gx) < 0.01 && Math.abs(this.gv) < 0.05) this.gx = this.gv = 0;
  }
  /** 次の時打ちの sec 秒前まで針を進める（分針を回すのと同じ） */
  toBeforeStrike(sec = 10): void {
    const m = this.min12() % 30;
    let delta = (30 - m) * 60 - sec;
    const cross = delta < 1;
    if (cross) delta += 1800;
    this.clock0 += delta * 1000;
    if (cross && this.sst === 'lock') this.s = countAt((this.min12() + 719) % 720);
  }
  /** 実際の時刻に合わせる（数取り車もそろえる） */
  setNow(now: number): void {
    this.clock0 = now - (this.adv / ADV_PER_SEC) * 1000;
    this.s = countAt(this.min12());
    this.sst = 'lock';
    this.sw = 0;
  }
  /** 分針をつまんで回す [分] */
  turnHands(dmin: number): void {
    this.clock0 += dmin * 60000;
  }
  /** 実時間 dt [s] を k 倍の速さで進める。巻き上げはいつも実時間 */
  advance(dt: number, k: number): void {
    for (const w of ['T', 'S'] as const) {
      if (!(w === 'T' ? this.windT : this.windS)) continue;
      const key = w === 'T' ? 'nT' : 'nS',
        before = this[key];
      this[key] = Math.min(SPRING.N, before + SPRING.windRate * dt);
      for (let c = Math.floor(before * SPRING.click); c < Math.floor(this[key] * SPRING.click); c++)
        this.events.push({ k: 'click', w });
      if (this[key] >= SPRING.N && before < SPRING.N) this.events.push({ k: 'full', w });
    }
    const sim = dt * k;
    if (this.mode === 'live') this.stepLive(sim);
    else this.stepAvg(sim);
    this.real += sim * 1000;
  }
  private stepLive(sim: number): void {
    const s = this.live;
    if (!s) return;
    const a0 = s.adv;
    let n = Math.round(sim / ESC_DT),
      j = 0;
    while (n-- > 0) {
      s.T = this.tab.T * this.fT();
      s.step(ESC_DT);
      const a = Math.abs(s.th) / DEG;
      if (Math.abs(s.om) < 0.02 && a > 0.05) this.ampHold = a;
      if (this.gq) {
        const ag = this.agAt(s.t);
        s.ag = ag;
        this.ground(ag, ESC_DT);
      } else if (this.gx || this.gv) {
        s.ag = 0;
        this.ground(0, ESC_DT);
      }
      for (const e of s.events) this.events.push(e);
      s.events.length = 0;
      if (++j % 12 === 0) {
        const n0 = this.events.length;
        this.stepStrike(12 * ESC_DT);
        for (let i = n0; i < this.events.length; i++) this.events[i].t = s.t;
      }
    }
    this.adv = s.adv;
    this.nT = Math.max(0, this.nT - ((s.adv - a0) * RATIO.bar) / TAU);
    this.A = this.ampHold;
    this.stopped = this.A < this.tab.Aon * 0.5;
  }
  /** 表で進める: 振り角は定常値へ時定数 45 s で近づき、周期は表の値 */
  stepAvg(sim: number): void {
    const tab = this.tab;
    let left = sim;
    while (left > 0) {
      const dt = Math.min(left, 5),
        f = this.fT(),
        run = !this.stopped && f > tab.fStop;
      left -= dt;
      this.A += ((run ? tab.A(f) : 0) - this.A) * (1 - Math.exp(-dt / 45));
      if (!this.stopped && this.A < tab.Aon * 0.85) this.stopped = true;
      if (!this.stopped) {
        const da = (dt / tab.P(f)) * ADV_PER_SEC;
        this.adv += da;
        this.nT = Math.max(0, this.nT - (da * RATIO.bar) / TAU);
      }
      /* 時打ちは打っている間だけ 5 ms 刻み。ゼンマイが尽きて輪列が動けないときは 1 s 刻み */
      let t = dt;
      while (t > 0) {
        const run = this.sst === 'run' || this.sst === 'warn0',
          stuck = run && this.sw === 0 && this.fS() <= this.strikeLoad() + 0.04,
          h = run && !stuck ? 0.005 : Math.min(t, 1);
        this.stepStrike(Math.min(h, t));
        t -= h;
      }
    }
  }
  /** 持ち上げレバーの角 [rad]: 筒かなのピンに押されて正時・30 分の約 4 分前から上がり、ちょうどで落ちる */
  liftH(min12 = this.min12()): number {
    /*
     * リコイル式ではがんぎ車が 1 振りごとに少し戻り、針もわずかに戻る。ピンが先を外れた直後に戻っても、落ちたレバーは
     * 上がり直さない（ピンは落ちた先の横に当たるだけ）。1 秒より小さな戻りでは前の時刻のレバーを使う
     */
    if (this.liftMin >= 0 && min12 < this.liftMin && this.liftMin - min12 < 1 / 60) return liftPhi(this.liftMin);
    this.liftMin = min12;
    return liftPhi(min12);
  }
  /** ハンマーを持ち上げる重さ（ピン車のピンが尾を押している間）。u は 1 打ちの中の位置 */
  private strikeLoad(u = this.s - Math.floor(this.s)): number {
    return u > HAM.u0 && u < 0.75 ? 0.36 * (0.6 + 0.4 * ((u - HAM.u0) / (0.75 - HAM.u0))) : 0;
  }
  /** 時打ちの 1 刻み */
  private stepStrike(dt: number): void {
    const h = this.liftH(),
      ev = this.events,
      u = this.s - Math.floor(this.s);
    /*
     * 予告: 持ち上げレバーが止めレバーを押し上げ、止めの爪が止め車の切り欠きから出ると、予告ピンが旗に当たるまで回る。
     * 予告の間はレバーの動きにつれてピンが旗に押される。レバーが落ちて旗が通り道から出ると打ち始める
     */
    if (this.sst === 'lock' && detClear(lockByLift(h))) {
      this.sst = 'warn0';
      ev.push({ k: 'unlock' });
    } else if (this.sst === 'warn') {
      const d = warnDelta(h);
      if (d === null) {
        this.sst = 'run';
        this.blowsThis = 0;
        this.sTarget = this.nextSlot();
      } else this.s = Math.floor(this.s) + d;
    } else if (this.sst === 'warn0' || this.sst === 'run') {
      const f = this.fS(),
        load = this.strikeLoad(u);
      this.sw = Math.max(0, this.sw + ((f - load - 0.04 - 0.78 * this.sw * Math.abs(this.sw)) / 0.05) * dt);
      const s0 = this.s;
      this.s += this.sw * dt;
      this.nS = Math.max(0, this.nS - (this.s - s0) / 180);
      if (this.sst === 'warn0') {
        const stopAt = Math.floor(s0) + (warnDelta(h) ?? 0.06);
        if (this.s >= stopAt) {
          this.s = stopAt;
          this.sw = 0;
          this.sst = 'warn';
          ev.push({ k: 'warn' });
        }
      } else {
        if (Math.floor(this.s - 0.75) > Math.floor(s0 - 0.75)) {
          this.hamT = 0;
          this.blowsThis++;
          ev.push({ k: 'gong', f, n: this.blowsThis });
        }
        if (this.s >= this.sTarget) {
          this.s = this.sTarget;
          this.sw = 0;
          this.sst = 'lock';
          ev.push({ k: 'lock' });
        }
      }
    }
    this.hamT += dt;
  }
  /** 数取り車の今の位置の次の溝 */
  private nextSlot(): number {
    const c = this.s % 90,
      base = this.s - c;
    for (const p of SLOT) if (p > c + 0.5) return base + p;
    return base + 90 + SLOT[1];
  }
  /** 次（または今）打つ数 */
  nextCount(): number {
    const c = Math.round(this.s % 90),
      i = SLOT.findIndex((p) => p > c);
    return i > 0 ? SLOT[i] - SLOT[i - 1] : SEQ[0];
  }
  /** 今打っている時打ちの全部の数 */
  strikeTotal(): number {
    return this.blowsThis + Math.max(0, Math.round(this.sTarget - this.s));
  }
  snap(): Snap {
    const live = this.live;
    return {
      type: this.type,
      mode: this.mode,
      adv: this.adv,
      th: live ? live.th : 0,
      A: this.A,
      stopped: this.stopped,
      nT: this.nT,
      nS: this.nS,
      fT: this.fT(),
      fS: this.fS(),
      s: this.s,
      sst: this.sst,
      sw: this.sw,
      hamT: this.hamT,
      lift: this.liftH(),
      clockMs: this.clockMs(),
      Fn: live ? [live.Fn[0], live.Fn[1]] : [0, 0],
      blows: this.blowsThis,
      next: this.nextCount(),
      gx: this.gx,
      quake: !!this.gq?.quake,
    };
  }
  save(): Saved {
    return {
      v: 1,
      type: this.type,
      adv: this.adv,
      nT: this.nT,
      nS: this.nS,
      clock0: this.clock0,
      A: this.A,
      stopped: this.stopped,
      s: this.s,
      sst: this.sst === 'run' || this.sst === 'warn0' ? 'lock' : this.sst,
      wall: Date.now(),
    };
  }
  /** 保存した状態から、閉じていた間を表で進めて戻す */
  static load(o: Saved, now = Date.now()): Clock {
    const c = new Clock(o.type, now);
    Object.assign(c, {
      adv: o.adv,
      nT: o.nT,
      nS: o.nS,
      clock0: o.clock0,
      A: o.A,
      stopped: o.stopped,
      s: o.s,
      sst: o.sst,
      real: now,
    });
    c.mode = 'avg';
    c.live = null;
    const gap = (now - o.wall) / 1000;
    if (gap > 0) c.stepAvg(Math.min(gap, 400 * 86400));
    c.events.length = 0;
    c.real = now;
    return c;
  }
}
export const isSaved = (o: unknown): o is Saved =>
  !!o &&
  typeof o === 'object' &&
  (o as Saved).v === 1 &&
  (o as Saved).type in TYPES &&
  [o as Saved].every((x) => [x.adv, x.nT, x.nS, x.clock0, x.A, x.s, x.wall].every(Number.isFinite));
export { ED, ER };
