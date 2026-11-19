import { describe, expect, it } from 'vitest';
import {
  DRUM_PART,
  envAt,
  MAX_VOICES,
  newPart,
  type Op,
  partGains,
  Synth,
  snapshot,
  type Tone,
} from '../src/tools/fm-synthesizer/engine';
import { DRUM_HI, DRUM_LO, DRUM_NAMES, GM_FAMILIES, GM_NAMES, PADS, padOf } from '../src/tools/fm-synthesizer/gm';

const op = (o: Partial<Op> = {}): Op => ({ r: 1, i: 0, l: 0, ar: 0, dr: 1, sl: 1, rr: 0.3, vs: 0, ks: 0, ...o });
/** OP4 だけが鳴る正弦波（アルゴリズム 7 で、ほかの 3 つの出力は −∞ に近い） */
const sine = (o: Partial<Op> = {}): Tone => ({
  alg: 0,
  fb: 0,
  ops: [op(), op(), op(), op(o)],
  lfo: { rate: 5, vib: 0, trem: 0, delay: 0 },
  gain: 0,
});
const SR = 48000;
const peak = (s: Synth, sec: number) => {
  const n = Math.round(sec * SR),
    L = new Float32Array(128),
    R = new Float32Array(128);
  let m = 0;
  for (let i = 0; i < n; i += 128) {
    s.render(L, R, 128);
    for (let k = 0; k < 128; k++) m = Math.max(m, Math.abs(L[k]), Math.abs(R[k]));
  }
  return m;
};

describe('GM の表', () => {
  it('音色は 128 で、系統は 16', () => {
    expect(GM_NAMES).toHaveLength(128);
    expect(GM_FAMILIES).toHaveLength(16);
  });
  it('打楽器の 35〜81 はどれも名前を持ち、ちょうど 1 つのパッドに入る', () => {
    for (let n = DRUM_LO; n <= DRUM_HI; n++) {
      expect(DRUM_NAMES[n]).toBeTruthy();
      expect(PADS.filter((p) => p.notes.includes(n))).toHaveLength(1);
    }
    expect(PADS).toHaveLength(8);
    expect(padOf(34)).toBe(-1);
    expect(padOf(46)).toBe(4);
  });
});

describe('エンベロープ', () => {
  it('アタックで最大まで上がり、ディケイの時間でサステインとの差が 60 dB 縮む', () => {
    const o = op({ ar: 0.1, dr: 1, sl: 0.5 });
    expect(envAt(o, 0.05)).toBeCloseTo(0.5, 6);
    expect(envAt(o, 0.1)).toBeCloseTo(1, 6);
    expect(envAt(o, 1.1) - 0.5).toBeCloseTo(0.5e-3, 6);
  });
  it('離すとリリースの時間で 60 dB 下がる', () => {
    const o = op({ sl: 1, rr: 0.5 });
    expect(envAt(o, 1.5, 1)).toBeCloseTo(1e-3, 6);
  });
  it('キースケールで高い音ほど速く減衰する', () => {
    const o = op({ dr: 1, sl: 0, ks: 1 });
    expect(envAt(o, 0.5, Number.POSITIVE_INFINITY, 72)).toBeLessThan(envAt(o, 0.5, Number.POSITIVE_INFINITY, 60));
  });
});

describe('音源', () => {
  it('キャリアの出力レベル 0 dB の正弦波は、定位が中央なら左右とも振幅 cos 45°', () => {
    const s = new Synth(SR, sine(), sine());
    s.parts[0].cc7 = 127;
    s.noteOn(0, 69, 1);
    /* 鳴り始めは直流を取り除くフィルタがわずかに行き過ぎるので、落ち着いてから測る */
    peak(s, 0.1);
    expect(peak(s, 0.05)).toBeCloseTo(Math.SQRT1_2, 2);
  });
  it('離した音はリリースのあとで消える', () => {
    const s = new Synth(SR, sine({ rr: 0.05 }), sine());
    s.noteOn(0, 60, 1);
    peak(s, 0.02);
    s.noteOff(0, 60);
    peak(s, 0.2);
    expect(s.voices).toHaveLength(0);
  });
  it('ダンパーペダルを踏んでいる間は離しても鳴り、ペダルを上げると離す', () => {
    const s = new Synth(SR, sine({ rr: 0.05 }), sine());
    s.cc(0, 64, 127);
    s.noteOn(0, 60, 1);
    s.noteOff(0, 60);
    peak(s, 0.2);
    expect(s.voices).toHaveLength(1);
    s.cc(0, 64, 0);
    peak(s, 0.2);
    expect(s.voices).toHaveLength(0);
  });
  it(`同時に鳴らすのは ${MAX_VOICES} 音まで`, () => {
    const s = new Synth(SR, sine({ rr: 5 }), sine());
    for (let n = 0; n < MAX_VOICES + 10; n++) s.noteOn(0, 30 + n, 1);
    peak(s, 0.05);
    expect(s.voices.length).toBeLessThanOrEqual(MAX_VOICES);
  });
  it('曲を止めても MIDI 機器の音は残る', () => {
    const s = new Synth(SR, sine({ rr: 0.02 }), sine());
    s.noteOn(0, 60, 1, 0);
    s.noteOn(0, 64, 1, 1);
    s.allOff(undefined, 0);
    peak(s, 0.2);
    expect(s.voices.map((v) => v.note)).toEqual([64]);
  });
  it('打楽器は離さなくても、鳴り止んだら終える', () => {
    const s = new Synth(SR, sine(), sine({ dr: 0.05, sl: 0 }));
    s.noteOn(DRUM_PART, 38, 1);
    s.noteOff(DRUM_PART, 38);
    peak(s, 0.3);
    expect(s.voices).toHaveLength(0);
  });
  it('整流波のキャリアでも直流を出さない', () => {
    const t = sine({ w: 5 }),
      s = new Synth(SR, t, sine());
    s.noteOn(0, 60, 1);
    const L = new Float32Array(128),
      R = new Float32Array(128);
    let sum = 0,
      n = 0;
    for (let i = 0; i < SR / 128; i++) {
      s.render(L, R, 128);
      if (i < (SR * 0.5) / 128) continue;
      for (let k = 0; k < 128; k++) sum += L[k];
      n += 128;
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.01);
  });
  it('ミュートしたパートは鳴らない', () => {
    const s = new Synth(SR, sine(), sine());
    s.parts[0].mute = true;
    s.noteOn(0, 69, 1);
    expect(peak(s, 0.05)).toBe(0);
  });
  it('全音停止で、ダンパーペダルで延ばしている音もすぐ消える', () => {
    const s = new Synth(SR, sine({ rr: 5 }), sine());
    s.cc(0, 64, 127);
    s.noteOn(0, 60, 1);
    s.noteOff(0, 60);
    s.panic();
    peak(s, 0.05);
    expect(s.voices).toHaveLength(0);
    expect(s.parts[0].sus).toBe(false);
  });
  it('残響へ送る音は、直接音に送る量を掛けたもの', () => {
    const s = new Synth(SR, sine(), sine());
    s.parts[0].rev = 0.5;
    s.noteOn(0, 69, 1);
    const L = new Float32Array(128),
      R = new Float32Array(128),
      SL = new Float32Array(128),
      SR2 = new Float32Array(128);
    s.render(L, R, 128, SL, SR2);
    for (let i = 0; i < 128; i++) expect(SL[i]).toBeCloseTo(L[i] * 0.5, 6);
  });
  it('ハイハットの閉じた音は開いた音を止める', () => {
    const s = new Synth(SR, sine(), sine({ rr: 5 }));
    s.noteOn(DRUM_PART, 46, 1);
    peak(s, 0.02);
    s.noteOn(DRUM_PART, 42, 1);
    peak(s, 0.05);
    expect(s.voices.map((v) => v.note)).toEqual([42]);
  });
  it('定位を右へ振りきると左は鳴らない', () => {
    const p = newPart(sine());
    p.pan = 1;
    const [l, r] = partGains(p);
    expect(l).toBeCloseTo(0, 6);
    expect(r).toBeGreaterThan(0);
  });
});

describe('表示用の波形', () => {
  it('正弦波の 2 周期で、最大はエンベロープの大きさ', () => {
    const w = snapshot(sine({ dr: 1, sl: 0.5 }), 10, Number.POSITIVE_INFINITY, 1, 60, 2, 256);
    expect(w).toHaveLength(512);
    expect(Math.max(...w)).toBeCloseTo(0.5, 2);
  });
});
