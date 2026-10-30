/**
 * 乾いた音のギター: ギター音響モデル（../guitar）で、クラシックギターの開放に近い E マイナーの分散和音を弾いた音。
 * 胴の放射を含み、部屋の響きは含まない（1 m 先の音圧）。部屋のページのために弾き方は既定値に固定する
 */
import { BODY_TYPES, makeBody } from '../guitar/body';
import { bodyDesc, Engine } from '../guitar/engine';
import { type Guitar, modesOf, pluckOf, TOOLS } from '../guitar/model';
import { setOf, stringPhys } from '../guitar/strings';

/** 弾く順（弦 0 = 1 弦）とフレット、弾く時刻 [s] */
const NOTES: [number, number, number][] = [
  [5, 0, 0],
  [4, 2, 0.16],
  [3, 2, 0.32],
  [2, 0, 0.48],
  [1, 0, 0.64],
  [0, 0, 0.8],
];
/** 1 音の長さ [s] */
const RING = 1.6;

export function guitar(fs: number): Float32Array {
  const set = setOf('nylon'),
    bt = BODY_TYPES[0],
    g: Guitar = {
      L: set.L,
      frets: set.frets,
      str: set.strings.map(stringPhys),
      body: makeBody({ type: bt.v, wood: 'spruce', h: bt.h, V: bt.V, dh: bt.dh }),
    },
    body = bodyDesc(g.body),
    tool = TOOLS[0],
    y = new Float32Array(Math.round((NOTES[NOTES.length - 1][2] + RING) * fs));
  for (const [si, fret, at] of NOTES) {
    const m = modesOf(g, si, fret, fs),
      pl = pluckOf(g, si, m, { pos: 0.13, amp: 1.2e-3, width: tool.w, rel: tool.rel, angle: Math.PI / 4 }),
      e = new Engine(fs),
      k0 = Math.round(at * fs),
      n = Math.min(Math.round(RING * fs), y.length - k0),
      x = new Float32Array(n);
    e.setBody(body);
    e.pluck({ si, N: m.N, w: m.w, s: m.s, f: pl.f });
    /* ギターの音の計算（guitar/worker.ts の renderPluck）と同じく 128 標本ずつ */
    for (let i = 0; i < n; i += 128) e.render(x, i, Math.min(128, n - i));
    for (let k = 0; k < n; k++) y[k0 + k] += x[k];
  }
  let mx = 0;
  for (const v of y) mx = Math.max(mx, Math.abs(v));
  if (mx > 0) for (let i = 0; i < y.length; i++) y[i] /= mx;
  return y;
}
