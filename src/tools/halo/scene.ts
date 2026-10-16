/** ハロのページの場面: 結晶の母集団のプリセット、光源（太陽・月）、大気の透過率（CPU 版） */
import type { Population } from './trace';

/** 母集団の数の上限 */
export const MAX_POP = 6;

export interface Preset {
  k: string;
  name: string;
  /** 吹き出しの説明 */
  title: string;
  /** 選んだときの光源の高度 [°] */
  e: number;
  pops: Population[];
}

const P = (o: Partial<Population>): Population => ({
  orient: 'random',
  ca: 1,
  tilt: 0,
  rot: 0,
  w: 100,
  d: 60,
  pyr: 0,
  ...o,
});

/** プリセット（割合は表面積をそろえた結晶の数の比 [%]） */
export const PRESETS: Preset[] = [
  {
    k: 'cirrus',
    name: '巻雲',
    title: '板 50 %・ずんぐりした柱 25 %・鉛筆状の柱 25 %（橋詰ほか 2006 が岐阜の表示を再現した割合）',
    e: 23,
    pops: [
      P({ orient: 'plate', ca: 0.3, tilt: 1, w: 50, d: 150 }),
      P({ orient: 'random', ca: 1, w: 25, d: 60 }),
      P({ orient: 'column', ca: 2, tilt: 1, w: 25, d: 100 }),
    ],
  },
  {
    k: 'columns',
    name: '柱の多い空',
    title: '水平な柱 76 %・ランダムな柱 10 %・板 11 %・Parry 3 %（atoptics が英国 2001-02-09 の表示を再現した割合）',
    e: 22,
    pops: [
      P({ orient: 'column', ca: 1.2, tilt: 1, w: 76, d: 100 }),
      P({ orient: 'random', ca: 2, w: 10, d: 60 }),
      P({ orient: 'plate', ca: 0.1, tilt: 2, w: 5, d: 150 }),
      P({ orient: 'plate', ca: 0.1, tilt: 6, w: 6, d: 150 }),
      P({ orient: 'parry', ca: 2, tilt: 1, rot: 1, w: 3, d: 100 }),
    ],
  },
  {
    k: 'plates',
    name: '板だけ',
    title: '傾き 0.5° の板だけ（鋭い幻日と環天頂アーク、太陽が高ければ環水平アーク）',
    e: 10,
    pops: [P({ orient: 'plate', ca: 0.2, tilt: 0.5, w: 100, d: 200 })],
  },
  {
    k: 'pillar',
    name: '太陽柱',
    title: '傾き 4° の薄い板（太陽が地平線の近くにあるとき）',
    e: 2,
    pops: [P({ orient: 'plate', ca: 0.1, tilt: 4, w: 100, d: 200 })],
  },
  {
    k: 'diamond',
    name: 'ダイヤモンドダスト',
    title: '板・柱・Parry・Lowitz・ランダムの混合（割合はこのツールで決めた例）',
    e: 15,
    pops: [
      P({ orient: 'plate', ca: 0.2, tilt: 0.5, w: 35, d: 200 }),
      P({ orient: 'column', ca: 2, tilt: 0.5, w: 30, d: 120 }),
      P({ orient: 'parry', ca: 2, tilt: 0.5, rot: 1, w: 10, d: 120 }),
      P({ orient: 'lowitz', ca: 0.25, tilt: 0.5, rot: 20, w: 10, d: 150 }),
      P({ orient: 'random', ca: 1, w: 15, d: 60 }),
    ],
  },
  {
    k: 'pyramid',
    name: '珍しい半径の暈',
    title: '錐面のある結晶（向きはランダム）。9°・18°・20°・23°・24°・35° の暈',
    e: 30,
    pops: [P({ orient: 'random', ca: 0.3, pyr: 0.5, w: 100, d: 100 })],
  },
  {
    k: 'random',
    name: 'ランダム',
    title: '向きのそろわない六角柱だけ（内暈と外暈）',
    e: 30,
    pops: [P({ orient: 'random', ca: 1, w: 100, d: 50 })],
  },
];

export const presetOf = (k: string): Preset => PRESETS.find((p) => p.k === k) ?? PRESETS[0];

/* ---------- 大気（シェーダの ATMOS と同じ定数。CPU では光源の円盤の透過率と露出に使う） ---------- */

const RE = 6360,
  RT = 6420,
  BR = [5.802e-3, 13.558e-3, 33.1e-3],
  HR = 8,
  BME = 4.44e-3,
  HM = 1.2,
  BO = [0.65e-3, 1.881e-3, 0.085e-3];

function hitSphere(p: number[], d: number[], r: number): number {
  const b = p[0] * d[0] + p[1] * d[1] + p[2] * d[2],
    c = p[0] * p[0] + p[1] * p[1] + p[2] * p[2] - r * r,
    disc = b * b - c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc),
    t0 = -b - s,
    t1 = -b + s;
  return t0 > 0 ? t0 : t1 > 0 ? t1 : -1;
}

/**
 * エーロゾルの量: Hillaire 2020 の Mie の係数（鉛直の光学的厚さ約 0.005、とても澄んだ空）を何倍にするか。
 * 晴れた日の全球平均（550 nm で約 0.12）よりは澄んだ空にする（このツールで決めたこと）
 */
export const AOD = 5;

/** 地上から高度 elev [°] の光源までの大気の透過率（RGB）。地平線の下は 0 */
export function groundT(elev: number, aod = AOD): [number, number, number] {
  const e = (elev * Math.PI) / 180,
    p = [0, 0, RE + 0.002],
    d = [Math.cos(e), 0, Math.sin(e)];
  if (hitSphere(p, d, RE) > 0) return [0, 0, 0];
  const tt = hitSphere(p, d, RT),
    od = [0, 0, 0],
    N = 64;
  for (let i = 0; i < N; i++) {
    const t = (tt * (i + 0.5)) / N,
      q = [p[0] + t * d[0], p[1] + t * d[1], p[2] + t * d[2]],
      h = Math.hypot(q[0], q[1], q[2]) - RE,
      r = Math.exp(-h / HR),
      m = Math.exp(-h / HM),
      oz = Math.max(0, 1 - Math.abs(h - 25) / 15);
    for (let k = 0; k < 3; k++) od[k] += (BR[k] * r + BME * aod * m + BO[k] * oz) * (tt / N);
  }
  return [Math.exp(-od[0]), Math.exp(-od[1]), Math.exp(-od[2])];
}

/** 大気差（Sæmundsson 1986）: 真の高度 [°] → 見かけの高度 [°]。−1° より下は −2° で 0 になるよう減らす */
export function apparent(h: number): number {
  const b = Math.max(h, -1);
  return h + (1.02 / Math.tan(((b + 10.3 / (b + 5.11)) * Math.PI) / 180) / 60) * Math.max(0, Math.min(1, h + 2));
}

/* ---------- 月 ---------- */

/** 朔望月 [日] */
export const SYNODIC = 29.530589;

/** 月齢 [日] → 位相角 [°]（0 が満月）。月の軌道を円とみた近似 */
export const phaseAngle = (age: number): number => Math.abs(180 - (((360 * age) / SYNODIC) % 360));

/**
 * 月の放射照度 ÷ 太陽の放射照度。満月の等級 −12.73 に位相角の項を足し（Allen の式）、太陽の −26.74 と比べる
 */
export function moonRatio(age: number): number {
  const a = phaseAngle(age),
    m = -12.73 + 0.026 * a + 4e-9 * a ** 4;
  return 10 ** (-0.4 * (m + 26.74));
}
