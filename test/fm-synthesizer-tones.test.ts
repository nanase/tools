import { describe, expect, it } from 'vitest';
import { DRUM_PART, Synth, type Tone } from '../src/tools/fm-synthesizer/engine';
import { DRUM_HI, DRUM_LO } from '../src/tools/fm-synthesizer/gm';
import { DRUM_DEFAULT, DRUM_TONES, GM_TONES, PIANO } from '../src/tools/fm-synthesizer/tones';
import { PICKED_DRUM, PICKED_GM } from '../src/tools/fm-synthesizer/tones-picked';
import { SENS_GM } from '../src/tools/fm-synthesizer/tones-sens';

const SR = 48000;
/** 大きさを測る区切り（10 ms） */
const BLOCK = 480;

/**
 * ノート note をベロシティ 0.8 で 0.6 秒押して離し、1.5 秒ぶん鳴らす。左の RMS [dBFS] は、最も大きい区切りから
 * 20 dB 以内の区切りだけで求める（減衰の速い音でも鳴っている間の大きさをくらべる）
 */
function measure(tone: Tone, drum?: number): { db: number; peak: number } {
  const part = drum === undefined ? 0 : DRUM_PART,
    note = drum ?? 60,
    s = new Synth(SR, drum === undefined ? tone : PIANO, DRUM_DEFAULT);
  s.parts[part].cc7 = 127;
  s.parts[part].cc11 = 127;
  if (drum !== undefined) s.drums.set(drum, tone);
  s.noteOn(part, note, 0.8);
  const L = new Float32Array(BLOCK),
    R = new Float32Array(BLOCK),
    blocks: number[] = [];
  let peak = 0;
  for (let b = 0; b < 150; b++) {
    if (b === 60) s.noteOff(part, note);
    s.render(L, R, BLOCK);
    let e = 0;
    for (let i = 0; i < BLOCK; i++) {
      e += L[i] * L[i];
      peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    }
    blocks.push(e / BLOCK);
  }
  const max = Math.max(...blocks),
    sel = blocks.filter((e) => e >= max / 100);
  return { db: 10 * Math.log10(sel.reduce((a, e) => a + e, 0) / sel.length), peak };
}

/** 打楽器の大きさの目標 [dBFS]: キック・スネア・タムは旋律の音色と同じ、ラテンの太鼓は少し小さく、シンバルや小物は 6 dB 小さく */
const MAIN = [35, 36, 37, 38, 39, 40, 41, 43, 45, 47, 48, 50];
const drumTarget = (n: number): number => (MAIN.includes(n) ? -20 : n >= 60 && n <= 66 ? -22 : -26);

const drums = (): [number, Tone][] => {
  const out: [number, Tone][] = [];
  for (let n = DRUM_LO; n <= DRUM_HI; n++) out.push([n, DRUM_TONES[n]]);
  return out;
};

describe('音色の表', () => {
  it('GM の 128 音色があり、最初はグランドピアノ', () => {
    expect(GM_TONES).toHaveLength(128);
    expect(PIANO).toBe(GM_TONES[0]);
  });
  it('打楽器の 35〜81 はどれも音色を持ち、音の高さのノート番号が決まっている', () => {
    for (const [n, t] of drums()) {
      expect(t, `ノート ${n}`).toBeDefined();
      expect(Number.isInteger(t.key), `ノート ${n}`).toBe(true);
      expect(t.key).toBeGreaterThanOrEqual(0);
      expect(t.key).toBeLessThanOrEqual(127);
    }
  });
  it('どの値も範囲に入る', () => {
    const all: [string, Tone][] = [
      ...GM_TONES.map((t, p): [string, Tone] => [`音色 ${p}`, t]),
      ...drums().map(([n, t]): [string, Tone] => [`打楽器 ${n}`, t]),
      ['打楽器の既定', DRUM_DEFAULT],
    ];
    for (const [name, t] of all) {
      expect(Number.isInteger(t.alg) && t.alg >= 0 && t.alg <= 7, name).toBe(true);
      expect(Number.isInteger(t.fb) && t.fb >= 0 && t.fb <= 7, name).toBe(true);
      expect(t.ops, name).toHaveLength(4);
      expect(Number.isFinite(t.gain), name).toBe(true);
      const { rate, vib, trem, delay } = t.lfo;
      expect(rate > 0 && vib >= 0 && trem >= 0 && delay >= 0, name).toBe(true);
      for (const o of t.ops) {
        for (const v of Object.values(o)) expect(Number.isFinite(v), name).toBe(true);
        expect(o.r, name).toBeGreaterThan(0);
        expect(o.i, name).toBeGreaterThanOrEqual(0);
        expect(o.l, name).toBeLessThanOrEqual(0);
        expect(o.ar, name).toBeGreaterThanOrEqual(0);
        expect(o.dr, name).toBeGreaterThan(0);
        expect(o.sl >= 0 && o.sl <= 1, name).toBe(true);
        expect(o.rr, name).toBeGreaterThan(0);
        expect(o.vs >= 0 && o.vs <= 1, name).toBe(true);
      }
    }
  });
});

describe('音量のそろえ方', () => {
  /*
   * レビューで選んだ音色（tones-picked.ts）は耳で決めた補正を含むので、大きさの幅は問わない。
   * そのほかは、今の音色のまま音量だけ直したもの（±2 dB 程度）を含めて ±3 dB
   */
  it('旋律の音色は −20 dBFS ± 3 dB で、割れない', () => {
    for (const [p, t] of GM_TONES.entries()) {
      const { db, peak } = measure(t);
      if (!PICKED_GM[p]) expect(Math.abs(db + 20), `音色 ${p}: ${db.toFixed(1)} dB`).toBeLessThan(3);
      expect(peak, `音色 ${p}`).toBeLessThan(1);
      expect(peak, `音色 ${p}`).toBeGreaterThan(0.01);
    }
  });
  it('打楽器は種類ごとの目標 ± 3 dB で、割れない', () => {
    for (const [n, t] of drums()) {
      const { db, peak } = measure(t, n);
      if (!PICKED_DRUM[n]) expect(Math.abs(db - drumTarget(n)), `ノート ${n}: ${db.toFixed(1)} dB`).toBeLessThan(3);
      expect(peak, `ノート ${n}`).toBeLessThan(1);
      expect(peak, `ノート ${n}`).toBeGreaterThan(0.01);
    }
    const d = measure(DRUM_DEFAULT);
    expect(Math.abs(d.db + 22)).toBeLessThan(2);
  });
});

describe('ベロシティと音の高さの効き', () => {
  it('表の音色には効きが入り、ほかの値はレビューで選んだ音色のまま', () => {
    for (const [p, s] of Object.entries(SENS_GM)) {
      const t = GM_TONES[Number(p)],
        base = PICKED_GM[Number(p)];
      expect(t.fbv ?? 0).toBe(s.fbv ?? 0);
      for (const [k, o] of t.ops.entries()) {
        expect(o.va ?? 0).toBe(s.va[k]);
        expect(o.ka ?? 0).toBe(s.ka?.[k] ?? 0);
        expect(o.dt ?? 0).toBe(s.dt?.[k] ?? 0);
        if (base)
          expect({ ...o, va: undefined, ka: undefined, dt: undefined }).toEqual({
            ...base.ops[k],
            va: undefined,
            ka: undefined,
            dt: undefined,
          });
      }
    }
  });
});
