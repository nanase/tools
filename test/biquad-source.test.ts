import { describe, expect, it } from 'vitest';
import {
  FILE_MAX,
  fileLoop,
  GEN_DUR,
  GROUPS,
  isRecording,
  makeLoop,
  makeNoise,
  REF_RMS,
  SOURCES,
  SRC0,
  sourceOf,
  toLoop,
  VOICE_GAP,
  XFADE,
} from '../src/tools/biquad/source';
import { makeMusic } from '../src/tools/pcm/music';

const FS = 48000;
function src(v: string) {
  const s = sourceOf(v);
  if (!s) throw new Error(v);
  return s;
}
function loop(v: string) {
  const l = makeLoop(src(v), FS);
  if (!l) throw new Error(v);
  return l;
}
/** 倍率を掛けた後の実効値（全チャンネル） */
function rmsAfter(data: Float32Array[], gain: number): number {
  let e = 0,
    n = 0;
  for (const y of data)
    for (const v of y) {
      e += v * v * gain * gain;
      n++;
    }
  return Math.sqrt(e / n);
}

describe('試聴の入力の一覧', () => {
  it('既定はホワイトノイズ、見出しごとの数はノイズ 3・楽器 4・自然の音 12・声 3', () => {
    expect(SRC0.v).toBe('white');
    expect(SRC0.label).toBe('ホワイトノイズ');
    const n = (g: string) => SOURCES.filter((s) => s.group === g).length;
    expect(GROUPS.map(([g]) => n(g))).toEqual([3, 4, 12, 3]);
  });

  it('値は重ならず、「ファイル」「開く」とも重ならない', () => {
    const vs = SOURCES.map((s) => s.v);
    expect(new Set(vs).size).toBe(vs.length);
    expect(vs).not.toContain('file');
    expect(vs).not.toContain('open');
  });

  it('録音を読むのは自然の音と声だけ', () => {
    expect(isRecording(src('brook'))).toBe(true);
    expect(isRecording(src('voice-ja-f'))).toBe(true);
    expect(isRecording(src('pink'))).toBe(false);
    expect(isRecording(src('drums'))).toBe(false);
    expect(sourceOf('nothing')).toBeUndefined();
  });
});

describe('くり返し鳴らす形', () => {
  it('ノイズは種が同じなら同じ音で、ホワイトは −1〜1', () => {
    const a = makeNoise('white', FS, 1, 3),
      b = makeNoise('white', FS, 1, 3);
    expect(a).toEqual(b);
    expect(Math.max(...a.map(Math.abs))).toBeLessThanOrEqual(1);
  });

  it('ノイズ・楽器はどれも倍率を掛けると実効値が REF_RMS になる', () => {
    for (const v of ['white', 'pink', 'brown', 'mix', 'drums', 'pluck', 'pad']) {
      const l = loop(v);
      expect(l.gain).toBeGreaterThan(0);
      /* 打楽器は音の間を数えないので、全体の実効値は少し下がる */
      const r = rmsAfter(l.data, l.gain);
      expect(r / REF_RMS, v).toBeGreaterThan(v === 'drums' ? 0.4 : 0.9);
      expect(r / REF_RMS, v).toBeLessThan(1.1);
    }
  });

  it('今までの入力と同じく、ホワイトノイズの倍率はほぼ 1', () => {
    const l = loop('white');
    expect(l.gain).toBeCloseTo(1, 1);
  });

  it('混ぜた音はステレオのまま', () => {
    expect(loop('mix').data).toHaveLength(2);
    expect(loop('pad').data).toHaveLength(1);
  });

  it('楽器は PCM のページと同じく 4 秒をそのままくり返す（拍がずれず、冒頭も欠けない）', () => {
    for (const v of ['mix', 'drums', 'pluck', 'pad']) {
      const l = loop(v),
        m = makeMusic(v as 'mix', FS, GEN_DUR);
      expect(l.data[0].length, v).toBe(GEN_DUR * FS);
      expect(l.data[0].slice(0, 2000), v).toEqual(m[0].slice(0, 2000));
      expect(l.data[0].slice(-2000), v).toEqual(m[0].slice(-2000));
    }
  });

  it('録音は makeLoop では作らない', () => {
    expect(makeLoop(src('brook'), FS)).toBeNull();
  });

  it('自然の音は終わりを初めに重ねた分だけ短く、声は無音を足した分だけ長い', () => {
    const x = makeNoise('white', FS, 3);
    expect(toLoop([x], FS, 'xfade').data[0].length).toBe(x.length - Math.round(XFADE * FS));
    const v = toLoop([x], FS, 'gap').data[0];
    expect(v.length).toBe(x.length + Math.round(VOICE_GAP * FS));
    expect(v[v.length - 1]).toBe(0);
  });

  it('無音は倍率 0', () => {
    expect(toLoop([new Float32Array(FS)], FS, 'xfade').gain).toBe(0);
  });

  it('ファイルは先頭 30 秒・2 チャンネルまで', () => {
    const long = new Float32Array((FILE_MAX + 5) * FS).fill(0.1),
      l = fileLoop([long, long, long], FS);
    expect(l.data).toHaveLength(2);
    expect(l.data[0].length).toBe(FILE_MAX * FS - Math.round(XFADE * FS));
  });

  it('50 ms より短いファイルでも大きさをそろえる', () => {
    const l = fileLoop([new Float32Array([0.5, -0.5, 0.5, -0.5])], FS);
    expect(l.data[0].length).toBe(3);
    expect(l.gain).toBeGreaterThan(0);
  });

  it('空のファイルでも落ちない', () => {
    const l = fileLoop([new Float32Array(0)], FS);
    expect(l.gain).toBe(0);
  });
});
