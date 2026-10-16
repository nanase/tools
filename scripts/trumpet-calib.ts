/**
 * src/tools/trumpet/calib.ts（音ごと・口の圧力ごとに、音高が合う唇の共振の比と、そのときの音量・重心）を作る。
 * bun scripts/trumpet-calib.ts で実行する（音域を 8 つに分けて並べて計算する。数分かかる）。
 *
 * 唇の共振 f_L を、鳴らしたい音の周波数の 0.5〜1.12 倍で 0.012 刻みに動かし、口の圧力ごとに 0.32 秒吹いて、
 * マウスピースの圧力の自己相関で鳴った音高を測る。最大の音量から 8 dB 以内の点だけで、音高が平均律と合う比を
 * 直線補間で求める（窓の端の弱い発振を避ける）
 */
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { air, profile, SPEC, VALVE_LEN } from '../src/tools/trumpet/bore';
import { Trumpet } from '../src/tools/trumpet/instrument';
import { FINGERS, fingering, HIGH, LOW, mtof, openNote } from '../src/tools/trumpet/notes';
import { boreSteps, inputImpedance } from '../src/tools/trumpet/tmm';

const FS = 48000;
/** 測る口の圧力 [kPa] */
const PMS = [2, 2.8, 4, 5.6, 8];

/** 自己相関の最初の大きな山から周波数 [Hz] と相関 */
function pitch(x: Float64Array): { f: number; c: number } {
  const n = x.length;
  let mean = 0;
  for (const v of x) mean += v;
  mean /= n;
  const lmin = Math.floor(FS / 1500),
    lmax = Math.floor(FS / 60),
    r = new Float64Array(lmax + 2);
  let e0 = 0;
  for (let i = 0; i < n - lmax; i++) e0 += (x[i] - mean) ** 2;
  for (let l = lmin; l <= lmax + 1; l++) {
    let s = 0,
      e1 = 0;
    for (let i = 0; i < n - lmax; i++) {
      s += (x[i] - mean) * (x[i + l] - mean);
      e1 += (x[i + l] - mean) ** 2;
    }
    r[l] = s / Math.sqrt(e0 * e1 + 1e-30);
  }
  let best = 0;
  for (let l = lmin + 1; l <= lmax; l++) if (r[l] > r[l - 1] && r[l] >= r[l + 1]) best = Math.max(best, r[l]);
  for (let l = lmin + 1; l <= lmax; l++)
    if (r[l] > r[l - 1] && r[l] >= r[l + 1] && r[l] > 0.9 * best) {
      const d = (0.5 * (r[l - 1] - r[l + 1])) / (r[l - 1] - 2 * r[l] + r[l + 1]);
      return { f: FS / (l + d), c: r[l] };
    }
  return { f: 0, c: 0 };
}

function play(t: Trumpet, m: number, ratio: number, pm: number, dur = 0.32) {
  const f = mtof(m);
  t.reset();
  t.setValves(FINGERS[fingering(m).semi].v);
  for (let i = 0; i < 3; i++) t.bore.valves[i].press = t.target[i];
  const N = Math.round(dur * FS),
    tl = Math.round(0.1 * FS),
    o = new Float64Array(tl),
    p = new Float64Array(tl);
  for (let i = 0; i < N; i++) {
    const s = i / FS,
      want = pm * (1 - Math.exp(-s / 0.004)) * (1 + 0.15 * Math.exp(-s / 0.04)),
      y = t.step(want, f * ratio);
    if (i >= N - tl) {
      o[i - N + tl] = y;
      p[i - N + tl] = t.lips.p;
    }
  }
  let e = 0,
    pe = 0;
  for (let i = 0; i < tl; i++) {
    e += o[i] ** 2;
    pe += p[i] ** 2;
  }
  const pr = pitch(p),
    c = 1200 * Math.log2(pr.f / f);
  return { ok: pr.c > 0.85 && Math.sqrt(pe / tl) > 30 && Math.abs(c) < 150, c, dB: 10 * Math.log10(e / tl / 4e-10) };
}

/** 音 m0〜m1 の表: [口の圧力 kPa, 唇の比, 音量 dB（1 m、軸の上）] の列 */
function calib(m0: number, m1: number): Record<number, [number, number, number][]> {
  const t = new Trumpet(FS),
    out: Record<number, [number, number, number][]> = {};
  for (let m = m0; m <= m1; m++) {
    const rows: [number, number, number][] = [];
    for (const pk of PMS) {
      const pts: { r: number; c: number; dB: number }[] = [];
      for (let r = 0.5; r <= 1.12; r += 0.012) {
        const o = play(t, m, r, pk * 1000);
        if (o.ok) pts.push({ r, c: o.c, dB: o.dB });
      }
      if (!pts.length) continue;
      const mx = Math.max(...pts.map((q) => q.dB)),
        good = pts.filter((q) => q.dB >= mx - 8);
      let ratio = Number.NaN;
      for (let i = 0; i + 1 < good.length; i++)
        if (good[i].c <= 0 && good[i + 1].c >= 0 && good[i + 1].r - good[i].r < 0.02) {
          ratio = good[i].r + ((0 - good[i].c) / (good[i + 1].c - good[i].c)) * (good[i + 1].r - good[i].r);
          break;
        }
      if (!Number.isFinite(ratio)) {
        const b = good.reduce((a, q) => (Math.abs(q.c) < Math.abs(a.c) ? q : a));
        if (Math.abs(b.c) < 35) ratio = b.r;
      }
      if (!Number.isFinite(ratio)) continue;
      const o = play(t, m, ratio, pk * 1000, 0.45);
      if (o.ok) rows.push([pk, Math.round(ratio * 10000) / 10000, Math.round(o.dB * 10) / 10]);
    }
    out[m] = rows;
    console.error(m, rows.map((r) => r.join('/')).join('  '));
  }
  return out;
}

const arg = process.argv.indexOf('--range');
if (arg > 0) {
  const [a, b] = process.argv[arg + 1].split('-').map(Number);
  process.stdout.write(JSON.stringify(calib(a, b)));
} else {
  const self = fileURLToPath(import.meta.url),
    parts: Promise<string>[] = [],
    step = Math.ceil((HIGH - LOW + 1) / 8);
  for (let m = LOW; m <= HIGH; m += step) {
    const range = `${m}-${Math.min(HIGH, m + step - 1)}`;
    parts.push(
      new Promise((res, rej) => {
        /* process.execPath は、このスクリプトを動かしている bun */
        const p = spawn(process.execPath, [self, '--range', range], { stdio: ['ignore', 'pipe', 'inherit'] });
        let s = '';
        p.stdout.on('data', (d) => {
          s += d;
        });
        p.on('close', (c) => (c ? rej(new Error(`${range} の計算が失敗しました（${c}）`)) : res(s)));
      }),
    );
  }
  const table: Record<number, [number, number, number][]> = {};
  for (const s of await Promise.all(parts)) Object.assign(table, JSON.parse(s));
  /* 倍音のはしご: 既定の管（長くしていない）の、指使い（抜差しは出さない）ごとの第 2〜第 10 共鳴の平均律からのずれ */
  const A = air(27),
    P = profile(SPEC),
    dev: number[][] = [];
  for (const g of FINGERS) {
    const extra = g.v.reduce((a, on, i) => a + (on ? VALVE_LEN[i] : 0), 0),
      st = boreSteps(P, extra, 1e-3),
      z = (f: number) => {
        const Z = inputImpedance(A, st, f);
        return Math.hypot(Z[0], Z[1]);
      },
      row: number[] = [];
    for (let n = 2; n <= 10; n++) {
      /* 平均律の音の ±150 セントで |Z| の山を、0.5 セント刻みで探す */
      const f0 = mtof(openNote(n) - g.semi);
      let best = 0,
        bc = 0;
      for (let c = -150; c <= 150; c += 0.5) {
        const v = z(f0 * 2 ** (c / 1200));
        if (v > best) [best, bc] = [v, c];
      }
      row.push(Math.round(bc));
    }
    dev.push(row);
    console.error('ladder', g.name, row.join(' '));
  }
  const lines = Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b)
    .map((m) => `  ${m}: ${JSON.stringify(table[m])},`);
  const src = `/**
 * 音ごと・口の圧力ごとの、音高が合う唇の共振の比（f_L ÷ 鳴らす音の平均律の周波数）と、そのときの 1 m 先・ベルの軸の上の
 * 音量 [dB]。scripts/trumpet-calib.ts で作る（直接編集しない）。管の中の温度 27 °C、非線形の伝搬あり
 */

/** 実音の MIDI 番号 → [口の圧力 kPa, 唇の比, 音量 dB] の列（口の圧力の小さい順） */
export const CALIB: Readonly<Record<number, readonly (readonly [number, number, number])[]>> = {
${lines.join('\n')}
};

/** 倍音のはしご: 指使い（notes.ts の FINGERS の順）ごとの、第 2〜第 10 共鳴の平均律からのずれ [セント]（既定の管、抜差しは出さない） */
export const RES_DEV: readonly (readonly number[])[] = ${JSON.stringify(dev)};
`;
  const OUT = new URL('../src/tools/trumpet/calib.ts', import.meta.url);
  writeFileSync(OUT, src);
  spawnSync(process.execPath, ['x', 'biome', 'format', '--write', fileURLToPath(OUT)], { stdio: 'inherit' });
  console.error('calib.ts:', Object.keys(table).length, 'notes');
}
