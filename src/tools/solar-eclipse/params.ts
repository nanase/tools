/** 日食の入力の定義（観測地の緯度・経度・標高）と、表示の補助 */
import { minus } from '../../lib/format';
import type { ParamDef } from '../../lib/param-def';

const deg = (v: number, s: number) => minus(String(Number(v.toFixed(s))));

export type Key = 'lat' | 'lon' | 'h';

export const LAT: ParamDef = {
  k: 'lat',
  nm: 'φ',
  sym: '<i>φ</i>',
  name: '緯度',
  sub: '北が正（測地緯度、WGS84）',
  unit: '°',
  min: -90,
  max: 90,
  v: 35.6895,
  ph: '例 35.69',
  pre: [],
  lin: { step: 0.01, big: 1 },
  sign: 'any',
  notation: 'plain',
  format: { input: (v) => deg(v, 4), step: (v) => deg(v, 2), text: (v) => `${deg(v, 4)}°` },
};

export const LON: ParamDef = {
  k: 'lon',
  nm: 'λ',
  sym: '<i>λ</i>',
  name: '経度',
  sub: '東が正',
  unit: '°',
  min: -180,
  max: 180,
  v: 139.6917,
  ph: '例 139.69',
  pre: [],
  lin: { step: 0.01, big: 1 },
  sign: 'any',
  notation: 'plain',
  format: { input: (v) => deg(v, 4), step: (v) => deg(v, 2), text: (v) => `${deg(v, 4)}°` },
};

export const ELEV: ParamDef = {
  k: 'h',
  nm: 'h',
  sym: '<i>h</i>',
  name: '標高',
  sub: '楕円体からの高さとして扱う。接触の時刻は 1000 m で 1 秒ほど変わる',
  unit: 'm',
  min: -400,
  max: 9000,
  v: 0,
  ph: '例 0',
  pre: [
    [0, '0'],
    [1000, '1000'],
    [3000, '3000'],
  ],
  lin: { step: 10, big: 100 },
  sign: 'any',
  notation: 'plain',
  format: { input: (v) => deg(v, 0), step: (v) => deg(v, 0), text: (v) => `${deg(v, 0)} m` },
};

export const PARAMS: ParamDef[] = [LAT, LON, ELEV];

/** 望遠の視野（画面の短い辺の半分が表す角度 [°]） */
export const ZOOMS = [
  ['0.5', '1°'],
  ['0.75', '1.5°'],
  ['1.5', '3°'],
] as const;

/** 再生の速さ（実時間の何倍） */
export const SPEEDS = [
  ['10', '×10'],
  ['60', '×60'],
  ['300', '×300'],
] as const;
