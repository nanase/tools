/**
 * src/tools/organ/tuned.ts（オルガン音響モデルの、既定の設定で調律した管の値）を作る。bun run organ-tune で実行する。
 * すべてのストップ・鍵・列の管を鳴らして周波数を測り、管の長さ（リード管は舌の固有振動数と共鳴管の長さ）を直して、
 * 調律前に対する比と、定常の音の倍音・立ち上がり・実効値を書く。サンプリング周波数 48 kHz、平均律、A4 = 440 Hz
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { divOf, OPT0, pipesOf, STOPS } from '../src/tools/organ/stops';
import { rowOf, voice, windOf } from '../src/tools/organ/voice';

const OUT = new URL('../src/tools/organ/tuned.ts', import.meta.url),
  FS = 48000;
const t0 = performance.now(),
  out: Record<string, number[][][]> = {};
let worst = 0,
  n = 0;
for (const s of STOPS) {
  const d = divOf(s.div),
    rows: number[][][] = [],
    wind = windOf(s, OPT0);
  for (let k = d.lo; k <= d.hi; k++) {
    const r: number[][] = [];
    for (const p of pipesOf(s, k, OPT0)) {
      const v = voice(p, FS, wind),
        row = rowOf(p, v),
        c = Math.abs(1200 * Math.log2(row.fr));
      worst = Math.max(worst, c);
      n++;
      r.push([
        Number(row.k.toFixed(6)),
        Number(row.res.toFixed(6)),
        Number(row.fr.toFixed(6)),
        Number(row.rise.toPrecision(3)),
        Number(row.rms.toPrecision(3)),
        ...row.db,
        ...row.ph,
      ]);
    }
    rows.push(r);
  }
  out[s.id] = rows;
  console.log(`${s.name}: ${rows.length} 鍵、${((performance.now() - t0) / 1000).toFixed(1)} s`);
}
const src = `/**
 * オルガン音響モデルの、既定の設定（風圧 800 Pa、平均律、A4 = 440 Hz、整音の既定、48 kHz）で調律した管の値。
 * scripts/organ-tune.ts で作る（直接編集しない）。ストップ → 鍵（鍵盤の下端から）→ 列 の順に、
 * [長さ（舌）の比, 共鳴管の長さの比, 測った周波数 ÷ 目標, 立ち上がり [s], 実効値 [Pa], 倍音 [dB] × 8, 位相 [1/64 回転] × 8]
 */
// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: 測った値で、√2 などの定数ではない
export const TUNED: Record<string, number[][][]> = ${JSON.stringify(out)};
`;
writeFileSync(OUT, src);
/* 書き方をほかのファイルとそろえる */
spawnSync(process.execPath, ['x', 'biome', 'format', '--write', fileURLToPath(OUT)], { stdio: 'inherit' });
console.log(`wrote src/tools/organ/tuned.ts（${n} 本、調律の残りの最大 ${worst.toFixed(2)} セント）`);
