/** オシロスコープの入力の定義: 表示範囲・トリガ・リサジューの設定 */
import { fmt, plain } from '../../lib/format';
import type { ParamDef, ParamFormat } from '../../lib/param-def';

export type Key = 'hd' | 'vd' | 'tl';

/** 時間軸（1 div あたり）: 1-2-5 */
export const HD = [10e-6, 20e-6, 50e-6, 100e-6, 200e-6, 500e-6, 1e-3, 2e-3, 5e-3, 10e-3, 20e-3, 50e-3];
/** 振幅（1 div あたり、フルスケールを 1 とする）: 1-2-5 */
export const VD = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5];

/** 符号つき（+0.25・−0.10・±0.00） */
export const signed = (v: number, d = 2): string => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(d);
const LV: ParamFormat = { input: (v) => signed(v), step: (v) => signed(v), text: (v) => `${signed(v)} FS` };

export const PARAMS: (ParamDef & { k: Key })[] = [
  {
    k: 'hd',
    nm: 'H',
    sym: 'H',
    name: '時間軸',
    sub: '横 1 目盛り（div）あたりの時間。表示窓の幅は 10 div',
    unit: 's',
    min: HD[0],
    max: HD[HD.length - 1],
    v: 200e-6,
    list: HD,
    log: true,
    snap: true,
    ph: '例 1m',
    bad: '読めない値です（例 200u・1m・5ms）',
    pre: [],
    format: { text: (v) => `${fmt(v, 's', 3)}/div` },
  },
  {
    k: 'vd',
    nm: 'V',
    sym: 'V',
    name: '振幅',
    sub: '縦 1 目盛り（div）あたりの振幅。フルスケールを 1 とする。表示窓の高さは 8 div',
    unit: 'FS',
    min: VD[0],
    max: VD[VD.length - 1],
    v: 0.2,
    list: VD,
    log: true,
    snap: true,
    notation: 'plain',
    ph: '例 0.1',
    bad: '読めない値です（例 0.1・0.05）',
    pre: [],
    format: { text: (v) => `${plain(v)} FS/div` },
  },
  {
    k: 'tl',
    nm: 'TRIG',
    sym: '',
    name: 'トリガのレベル',
    sub: '表示窓の右端の ◀ をドラッグしても変えられます',
    unit: 'FS',
    min: -1,
    max: 1,
    v: 0,
    lin: { step: 0.01, big: 0.1 },
    sign: 'any',
    ph: '例 0.1',
    bad: '読めない値です（例 0.1・−0.25）',
    pre: [],
    format: LV,
  },
];
export const P = Object.fromEntries(PARAMS.map((d) => [d.k, d])) as Record<Key, ParamDef>;

export type Mode = 'auto' | 'normal' | 'single';
export const MODES = [
  ['auto', 'AUTO', 'トリガがなければ今の波形をそのまま出す'],
  ['normal', 'NORMAL', 'トリガが来るまで前の波形を残す'],
  ['single', 'SINGLE', '1 回だけ取り込んで止める'],
] as const;
/** トリガの位置（表示窓の左からの割合） */
export const POS = [0.1, 0.25, 0.5, 0.75, 0.9] as const;
/** ノイズ除去の幅（フルスケールを 1 とする） */
export const HY = { off: 0, lo: 0.01, hi: 0.05 } as const;
export type Hy = keyof typeof HY;

/* リサジュー */
export type XyMode = 'xy' | 'ms';
/** 表示範囲（中心から端までの振幅） */
export const XR = [0.25, 0.5, 1] as const;
/** 描く長さ（秒） */
export const XL = [0.005, 0.01, 0.02, 0.05, 0.1] as const;
export type Persist = 'off' | 'short' | 'long';
/** 残光: 1 フレームごとに前の線を消す割合 */
export const FADE: Record<Persist, number> = { off: 1, short: 0.35, long: 0.1 };
