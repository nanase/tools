/** 係数の書き出し（テキスト・C の配列。DOM に依存しない） */
import type { Design, Spec } from './design';
import { WINS } from './params';

/** 型: 倍精度（有効数字 17 桁）か単精度（9 桁に丸める） */
export type CType = 'f64' | 'f32';

/** 1 つの係数の表記（指数表記。0 は 0.0。C の float は f を付ける） */
export function coefStr(v: number, t: CType, c = false): string {
  const s = v === 0 ? '0.0' : t === 'f64' ? v.toExponential(16) : Math.fround(v).toExponential(8);
  return t === 'f32' && c ? `${s}f` : s;
}

const RESP: Record<Spec['t'], string> = { lowpass: 'LPF', highpass: 'HPF', bandpass: 'BPF', bandstop: 'BSF' };

/** 設計の要約（C のコメント） */
export function summary(s: Spec, d: Design): string {
  const m =
    s.method === 'window'
      ? `${WINS.find((w) => w.v === s.win)?.ab ?? ''}窓${s.win === 'kaiser' ? `（β = ${Number(d.beta.toFixed(4))}）` : ''}`
      : s.method === 'remez'
        ? '等リップル（Parks–McClellan）'
        : '最小二乗';
  const f = s.t === 'bandpass' || s.t === 'bandstop' ? `fc = ${s.f1}, ${s.f2} Hz` : `fc = ${s.f1} Hz`;
  return `FIR ${RESP[s.t]}、${m}、fs = ${s.fs} Hz、${f}、N = ${d.N}（遅延 ${(d.N - 1) / 2} サンプル）`;
}

/** 書き出す文字列。txt は 1 行に 1 つ、c は C の配列の宣言 */
export function coefText(s: Spec, d: Design, fmt: 'txt' | 'c', t: CType): string {
  const h = Array.from(d.h);
  if (fmt === 'txt') return `${h.map((v) => coefStr(v, t)).join('\n')}\n`;
  const ty = t === 'f64' ? 'double' : 'float';
  return [
    `/* ${summary(s, d)} */`,
    `#define FIR_N ${d.N}`,
    `static const ${ty} fir_h[FIR_N] = {`,
    ...h.map((v, i) => `\t${coefStr(v, t, true)}${i < h.length - 1 ? ',' : ''}`),
    '};',
    '',
  ].join('\n');
}
