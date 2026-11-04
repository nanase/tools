/** 天体衝突のページの入力の定義 */
import type { ParamDef } from '../../lib/param-def';
import type { BodyKey, ImpactorKey, TargetKey } from './model';

export type PKey = 'L' | 'v' | 'th';

/** 長さの表記（例 500 m、1.75 km、12300 km） */
export const fmtLen = (m: number): string =>
  m >= 1e5
    ? `${Math.round(m / 1000).toLocaleString('en-US')} km`
    : m >= 1000
      ? `${Number((m / 1000).toFixed(m >= 1e4 ? 1 : 2))} km`
      : `${Number(m.toFixed(m >= 100 ? 0 : 1))} m`;
const lenView = (v: number) => (v >= 1000 ? `${Number((v / 1000).toFixed(2))} km` : `${v} m`);

export const PARAMS: (ParamDef & { k: PKey })[] = [
  {
    k: 'L',
    nm: '直径',
    sym: '<i>L</i>',
    name: '衝突体の直径',
    sub: '衝突体は球とする',
    unit: 'm',
    min: 10,
    max: 3000000,
    v: 1000,
    ph: '例 1k',
    list: [
      10, 15, 20, 30, 40, 60, 80, 100, 150, 200, 300, 500, 700, 1000, 1500, 2000, 3000, 5000, 7000, 10000, 15000, 20000,
      30000, 50000, 100000, 200000, 300000, 500000, 1000000, 2000000, 3000000,
    ],
    log: true,
    format: {
      input: (v) =>
        v >= 1e6 ? `${Number((v / 1e6).toFixed(2))}M` : v >= 1000 ? `${Number((v / 1000).toFixed(2))}k` : String(v),
      view: lenView,
      step: lenView,
      text: lenView,
    },
    bad: '数を入れてください（例 1k）',
    pre: [
      [100, '100 m'],
      [1000, '1 km'],
      [10000, '10 km'],
      [100000, '100 km'],
      [1000000, '1000 km'],
    ],
  },
  {
    k: 'v',
    nm: '速度',
    sym: '<i>v</i>',
    name: '衝突体の速度',
    sub: '大気に入る前の速度',
    unit: 'km/s',
    min: 5,
    max: 70,
    v: 20,
    ph: '例 20',
    list: [5, 8, 11, 15, 20, 25, 30, 40, 50, 70],
    notation: 'plain',
    inputmode: 'decimal',
    format: { input: String, step: String, text: (v) => `${v} km/s` },
    bad: '数を入れてください（例 20）',
    pre: [
      [11, '11'],
      [20, '20'],
      [50, '50'],
    ],
  },
  {
    k: 'th',
    nm: '角度',
    sym: '<i>θ</i>',
    name: '入射角',
    sub: '地面から測った角度。90° は真上から',
    unit: '°',
    min: 10,
    max: 90,
    v: 45,
    ph: '例 45',
    list: [10, 15, 20, 30, 45, 60, 75, 90],
    snap: true,
    notation: 'plain',
    inputmode: 'decimal',
    format: { input: String, step: String, text: (v) => `${v}°` },
    bad: '数を入れてください（例 45）',
    pre: [
      [30, '30'],
      [45, '45'],
      [90, '90'],
    ],
  },
];

export const IMP_CHOICES = [
  ['stone', '岩石'],
  ['iron', '鉄'],
  ['ice', '氷'],
] as const;
export const BODY_CHOICES = [
  ['earth', '地球'],
  ['moon', '月'],
  ['mars', '火星'],
  ['venus', '金星'],
] as const;
export const AIR_CHOICES = [
  ['1', 'あり'],
  ['0', 'なし'],
] as const;
export const TGT_CHOICES = [
  ['rock', '岩石'],
  ['sand', '砂'],
  ['water', '水'],
] as const;
export const Q_CHOICES = [
  ['70', '標準'],
  ['100', '細かい', '計算に 3 倍ほどかかる'],
  ['140', 'とても細かい', '計算に 8 倍ほどかかる'],
] as const;
export const RATE_CHOICES = [
  ['0.25', '1/4'],
  ['0.5', '1/2'],
  ['1', '標準'],
  ['2', '2 倍'],
] as const;

export interface Preset {
  nm: string;
  title: string;
  L: number;
  v: number;
  th: number;
  imp: ImpactorKey;
  body: BodyKey;
  tgt: TargetKey;
}
/** 実在のクレーターの例。衝突体の大きさは Collins ほか 2005 の例と、直径が合う値 */
export const PRESETS: readonly Preset[] = [
  { nm: 'バリンジャー', title: '直径 1.2 km', L: 40, v: 20, th: 45, imp: 'iron', body: 'earth', tgt: 'rock' },
  { nm: 'リース', title: '直径 24 km', L: 1750, v: 20, th: 45, imp: 'stone', body: 'earth', tgt: 'rock' },
  { nm: 'チクシュルーブ', title: '直径 180 km', L: 18000, v: 20, th: 45, imp: 'stone', body: 'earth', tgt: 'rock' },
  { nm: 'ティコ（月）', title: '直径 85 km', L: 5000, v: 20, th: 45, imp: 'stone', body: 'moon', tgt: 'rock' },
  {
    nm: '南極エイトケン（月）',
    title: '直径 2,500 km',
    L: 300000,
    v: 15,
    th: 45,
    imp: 'stone',
    body: 'moon',
    tgt: 'rock',
  },
];

/** 時間の表記 */
export const fmtT = (s: number): string =>
  s >= 3600
    ? `${(s / 3600).toFixed(1)} 時間`
    : s >= 120
      ? `${(s / 60).toFixed(1)} 分`
      : s >= 10
        ? `${s.toFixed(0)} 秒`
        : s >= 1
          ? `${s.toFixed(1)} 秒`
          : `${s.toFixed(2)} 秒`;

/** 上付きの指数で書く（例 7.4 × 10⁴） */
export function sci(x: number): string {
  if (x < 1e4) return x >= 100 ? x.toFixed(0) : x.toPrecision(2);
  const e = Math.floor(Math.log10(x)),
    sup = String(e).replace(/\d/g, (c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c]);
  return `${(x / 10 ** e).toFixed(1)} × 10${sup}`;
}
export const fmtMt = (J: number): string => {
  const Mt = J / 4.184e15;
  return Mt >= 1 ? `${sci(Mt)} Mt` : `${(Mt * 1000).toPrecision(3)} kt`;
};
