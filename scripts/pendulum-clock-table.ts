/**
 * 振り子時計の定常の表を作り直す。脱進機の型ごとに、ゼンマイの力の割合 f を下げながら接触の計算を 500 秒回し、
 * 最後の 40 往復の周期と振り角を測る（振り角が落ち着くまでの時定数は約 8 分）。止まった所（がんぎ車が進まない）で打ち切る。
 * 使い方: bun scripts/pendulum-clock-table.ts [型 …] > 結果を見て src/tools/pendulum-clock/tables.ts へ写す（1 型に 8〜10 分）
 */
import { DEG, ESC_DT, EscSim, type EscType } from '../src/tools/pendulum-clock/esc';
import { RAW } from '../src/tools/pendulum-clock/tables';

const DUR = 500,
  FS = [1, 0.85, 0.7, 0.55, 0.42, 0.32, 0.24, 0.18, 0.13, 0.1, 0.08];
const only = process.argv.slice(2) as EscType[];
for (const type of (only.length ? only : Object.keys(RAW)) as EscType[]) {
  const T0 = RAW[type].T;
  let Aprev = 3.8;
  for (const f of FS) {
    const s = new EscSim(type, { T: T0 * f, A: Aprev });
    let last = s.th,
      amp = 0,
      adv20 = 0;
    const amps: number[] = [],
      zc: number[] = [];
    while (s.t < DUR) {
      s.step(ESC_DT);
      amp = Math.max(amp, Math.abs(s.th));
      if (last < 0 && s.th >= 0) {
        zc.push(s.t);
        amps.push(amp / DEG);
        amp = 0;
      }
      last = s.th;
      if (!adv20 && s.t >= DUR - 40) adv20 = s.adv;
      s.events.length = 0;
    }
    const P = (zc[zc.length - 1] - zc[zc.length - 41]) / 40,
      A = amps[amps.length - 1] ?? 0,
      run = (s.adv - adv20) / DEG / 40,
      ok = Math.abs(run - 12) < 0.6;
    console.log(type, JSON.stringify({ f, A: +A.toFixed(4), P: ok ? +P.toFixed(7) : null }));
    if (!ok) break;
    Aprev = A;
  }
}
