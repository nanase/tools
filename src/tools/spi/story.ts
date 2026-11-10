/** 今の位置で起きていることの一言（配線図の下に出す）。w は色分け（m マスタ、s スレーブ、x 失敗） */
import { DEVS, hex, type Level, type Sim, sampleRising, valAt } from './bus';

export interface Say {
  t: string;
  w: 'm' | 's' | 'x' | null;
}
const lv = (v: Level) => (v === 'z' ? 'Z' : v === 'x' ? 'X' : String(v));

export function say(s: Sim, pt: number): Say {
  const dn = s.chain ? 'LED 1' : DEVS[s.sel[0]].name,
    cs = s.chain ? 'CS' : `CS${s.sel[0] + 1}`;
  if (pt < s.tCs) return { t: '待機 ― CS は High、MISO はどの機器も出力なし', w: null };
  if (pt >= s.tUp)
    return s.chain
      ? { t: 'CS ↑ 終了 ― 押し込まれたバイトで LED が点灯', w: null }
      : { t: `${cs} ↑ 終了 ― ${dn}は MISO から離れる`, w: null };
  if (!s.chain && s.c.both)
    return { t: `CS${s.sel[0] + 1} と CS${s.sel[1] + 1} が両方 Low ― 2 台が MISO に同時に出力`, w: 'x' };
  let last = null;
  for (const e of s.edges) if (e.t <= pt) last = e;
  if (!last) return { t: s.chain ? 'CS ↓ ― 3 台をまとめて選択' : `${cs} ↓ ― ${dn}を選択`, w: 'm' };
  const arr = last.rise ? '↑' : '↓';
  if (last.rise !== sampleRising(s.c.mode)) {
    const mo = valAt(s.lines.mosi, pt).v,
      mi = valAt(s.lines.miso, pt).v;
    return { t: `SCK ${arr} 次のビットを出力 ― MOSI ${lv(mo)}・MISO ${lv(mi)}`, w: 'm' };
  }
  const ms = s.samples.find((x) => x.i === 0 && x.e === last),
    listen = s.chain ? 1 : s.sel[0] + 1,
    ss = s.samples.find((x) => x.i === listen && x.e === last);
  if (ms?.b.why === 'race') return { t: `SCK ${arr} 読み取り ― MISO が同じエッジで変わり値は不定`, w: 'x' };
  if (ms?.b.why === 'idle') return { t: `SCK ${arr} 読み取り ― ${dn}は最初のビットをまだ出していない`, w: 'x' };
  if (ss?.b.why === 'race') return { t: `SCK ${arr} 読み取り ― ${dn}の側で MOSI が同じエッジで変わり値は不定`, w: 'x' };
  if (ms?.b.wrong && s.margin < 0)
    return { t: `SCK ${arr} 読み取り ― MISO の遅れが半周期を超え、1 つ前のビット`, w: 'x' };
  const bitNo = Math.floor(last.j / 2) + 1;
  if (bitNo % 8 === 0) {
    const n = bitNo / 8 - 1,
      a = s.devs[0].got[n],
      b = s.devs[listen].got[n];
    if (a !== undefined && b !== undefined)
      return { t: `${n + 1} バイト目の交換 ― マスタ ${hex(a)}・${dn} ${hex(b)}`, w: s.errM || s.errS ? 'x' : 's' };
  }
  const mv = ms ? (ms.b.why ? '?' : ms.b.v) : '–',
    sv = ss ? (ss.b.why ? '?' : ss.b.v) : '–';
  return { t: `SCK ${arr} 読み取り ― ${dn}が MOSI ${sv}、マスタが MISO ${mv}`, w: 's' };
}
