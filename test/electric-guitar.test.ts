import { describe, expect, it } from 'vitest';
import { parseMidi } from '../src/lib/midi';
import { smag } from '../src/tools/electric-guitar/filters';
import { driveCurve } from '../src/tools/electric-guitar/fx';
import { ANY, defOf, KEY, KNOB_ROWS, knobOff, scaleOf } from '../src/tools/electric-guitar/params';
import { defaults, KINDS, type Kind } from '../src/tools/electric-guitar/pedals';
import { PHRASES, PRESETS, phraseOf, presetRack, Seq } from '../src/tools/electric-guitar/phrases';
import { Proc } from '../src/tools/electric-guitar/proc';
import {
  cloneRack,
  DEFAULT_RACK,
  pickupPoly,
  type Rack,
  Rig,
  stagesOf,
  toneStackPoly,
} from '../src/tools/electric-guitar/rig';
import { FRETS, makeVoice, stepVoice } from '../src/tools/electric-guitar/strings';

const FS = 24000;
/** f [Hz] の周波数の応答のうち最大の所 */
const peakOf = (h: (f: number) => number): number => {
  let best = 0,
    bf = 0;
  for (let i = 0; i <= 400; i++) {
    const f = 50 * 400 ** (i / 400),
      v = h(f);
    if (v > best) {
      best = v;
      bf = f;
    }
  }
  return bf;
};
/** Proc を sec 秒回し、出力の最大と全サンプルを返す */
function run(R: Rack, sec = 1, play?: string, pluck = false) {
  const p = new Proc(FS, () => {});
  p.msg({ t: 'rack', R });
  if (play) p.msg({ t: 'play', v: play, bpm: phraseOf(play).bpm, beat: 0 });
  if (pluck) p.msg({ t: 'pluck', si: 5, fret: 0, amp: 1 });
  const L = new Float32Array(256),
    R2 = new Float32Array(256),
    all: number[] = [];
  let pk = 0,
    bad = false;
  for (let k = 0; k < (sec * FS) / 256; k++) {
    p.run(L, R2);
    for (let i = 0; i < 256; i++) {
      if (!Number.isFinite(L[i]) || !Number.isFinite(R2[i])) bad = true;
      pk = Math.max(pk, Math.abs(L[i]), Math.abs(R2[i]));
      all.push(L[i]);
    }
  }
  return { p, pk, bad, all };
}
const ped = (id: number, k: Kind, on = true) => ({ id, k, on, v: defaults(KINDS[k]) });
const swingOf = (p: Proc, si: number) => {
  const v = p.rig.live(si);
  return v ? v.re.reduce((a, x) => a + Math.abs(x), 0) : 0;
};

describe('ピックアップ', () => {
  it('コイルとケーブルの容量で 2〜5 kHz に共振の山がある', () => {
    for (const coil of ['single', 'hum'] as const) {
      const f = peakOf((x) => smag(pickupPoly(coil, 3, 1), x));
      expect(f).toBeGreaterThan(2000);
      expect(f).toBeLessThan(5000);
    }
  });
  it('ケーブルが長いほど山が下がり、トーンを絞ると 4 kHz が減る', () => {
    const f3 = peakOf((x) => smag(pickupPoly('single', 3, 1), x)),
      f10 = peakOf((x) => smag(pickupPoly('single', 10, 1), x));
    expect(f10).toBeLessThan(f3);
    expect(smag(pickupPoly('single', 3, 0), 4000)).toBeLessThan(smag(pickupPoly('single', 3, 1), 4000) / 4);
  });
  it('真上が節になる倍音は拾わない', () => {
    /* 6 弦の開放、ピックアップを弦長の 1/4 の所に置くと 4 倍音が出ない */
    const v = makeVoice(48000, 5, 0, { pos: 0.1 }, [{ x: 0.648 / 4, w: 0, gap: 0 }]);
    expect(Math.abs(v.wu0[3])).toBeLessThan(1e-9);
    expect(Math.abs(v.wu0[0])).toBeGreaterThan(0.5);
  });
});

describe('弦', () => {
  it('開放の 6 弦は 82.4 Hz で鳴る', () => {
    const v = makeVoice(FS, 5, 0, { pos: 0.1 }, [{ x: 0.042, w: 0.0035, gap: 0 }]),
      o = new Float64Array(4);
    let prev = 0,
      cross = 0;
    for (let i = 0; i < FS; i++) {
      stepVoice(v, 0, o);
      if (prev < 0 && o[0] >= 0) cross++;
      prev = o[0];
    }
    expect(v.f0).toBeCloseTo(82.41, 1);
    expect(cross).toBeGreaterThanOrEqual(80);
  });
  it('ハーモニクスは節の倍音だけを残す', () => {
    const v = makeVoice(FS, 5, 0, { harm: 2 }, []);
    expect((v.w[0] / (2 * Math.PI)) * FS).toBeGreaterThan(2 * 82.41 * 0.99);
  });
  it('チョーキングで 2 半音上がる', () => {
    const r = new Rig(FS),
      o = new Float64Array(2);
    r.pluck(2, 14, { amp: 1 });
    r.bendString(2, 2, 0.1);
    for (let i = 0; i < FS * 0.3; i++) r.sample(o);
    expect(r.live(2)?.ratio).toBeCloseTo(2 ** (2 / 12), 5);
  });
});

describe('機材', () => {
  it('歪みの入出力は単調で、大きな入力で頭打ちになる', () => {
    for (const t of ['od', 'ds', 'fuzz'] as const) {
      let prev = -Infinity;
      for (let x = -0.3; x <= 0.3; x += 0.01) {
        const y = driveCurve(t, 0.5, x);
        expect(y).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = y;
      }
      expect(Math.abs(driveCurve(t, 0.5, 0.3))).toBeLessThan(1.2);
    }
  });
  it('アンプのトーンは、ミドルを下げると 600 Hz の谷が深くなる', () => {
    const at = (m: number) => smag(toneStackPoly(0.5, m, 0.5), 600);
    expect(at(0)).toBeLessThan(at(1));
  });
  it('数値の行の既定値は種類の既定値と同じ', () => {
    for (const a of ANY)
      defOf(a).knobs.forEach((d, i) => {
        expect(KNOB_ROWS[a][i].v / scaleOf(d)).toBeCloseTo(d.v, 6);
      });
  });
  it('使わないつまみを無効にする', () => {
    expect(knobOff('wah', 'pedal', { mode: 'auto' })).not.toBe('');
    expect(knobOff('wah', 'sens', { mode: 'auto' })).toBe('');
    expect(knobOff('cab', 'fb', { type: 'off' })).not.toBe('');
  });
});

describe('ペダルの並び', () => {
  it('並べる順で音が変わる（歪みの前と後ろのリバーブ）', () => {
    const R1 = cloneRack(DEFAULT_RACK),
      R2 = cloneRack(DEFAULT_RACK);
    R1.pre = [ped(1, 'od'), ped(2, 'spring')];
    R2.pre = [ped(2, 'spring'), ped(1, 'od')];
    R1.post = [];
    R2.post = [];
    const a = run(R1, 1, undefined, true).all,
      b = run(R2, 1, undefined, true).all;
    let d = 0;
    for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
    expect(d).toBeGreaterThan(1e-3);
  });
  it('スルーのペダルは、外したのと同じ音になる', () => {
    const R1 = cloneRack(DEFAULT_RACK),
      R2 = cloneRack(DEFAULT_RACK);
    R1.pre = [ped(1, 'ds', false), ped(2, 'chorus')];
    R2.pre = [ped(2, 'chorus')];
    const a = run(R1, 0.5, undefined, true).all,
      b = run(R2, 0.5, undefined, true).all;
    expect(a).toEqual(b);
  });
  it('段の並びはギター・アンプの前・アンプ・キャビ・マイクの後ろの順', () => {
    const R = cloneRack(DEFAULT_RACK);
    R.pre = [ped(3, 'comp'), ped(4, 'od')];
    R.post = [ped(5, 'dly')];
    expect(stagesOf(R)).toEqual(['pu', 'p3', 'p4', 'amp', 'cab', 'p5']);
    const r = new Rig(FS);
    r.setRack(R);
    expect(r.tap.length).toBe(6);
  });
  it('同じ種類のペダルを 2 台つなげる', () => {
    const R = cloneRack(DEFAULT_RACK);
    R.pre = [ped(1, 'od'), ped(2, 'od')];
    const { bad, pk } = run(R, 0.5, undefined, true);
    expect(bad).toBe(false);
    expect(pk).toBeGreaterThan(0.01);
  });
});

describe('音', () => {
  it('どのプリセットとフレーズでも、値が壊れずフルスケール付近に収まる', () => {
    for (const pr of PRESETS) {
      const r = run(presetRack(pr.v), 1.5, pr.phrase);
      expect(r.bad, pr.v).toBe(false);
      expect(r.pk, pr.v).toBeGreaterThan(0.02);
      expect(r.pk, pr.v).toBeLessThan(3);
    }
  });
  it('フィードバックで弦が鳴り続ける', () => {
    const go = (fb: number) => {
      const R = presetRack('feedback');
      R.cab.fb = fb;
      const p = new Proc(FS, () => {});
      p.msg({ t: 'rack', R });
      p.msg({ t: 'pluck', si: 2, fret: 14, amp: 1 });
      const L = new Float32Array(256),
        R2 = new Float32Array(256);
      for (let k = 0; k < (5 * FS) / 256; k++) p.run(L, R2);
      return swingOf(p, 2);
    };
    expect(go(0.7)).toBeGreaterThan(20 * go(0));
  });
  it('試聴の段を通った音がそのまま出る', () => {
    const p = new Proc(FS, () => {}),
      L = new Float32Array(128),
      R = new Float32Array(128);
    p.msg({ t: 'listen', k: 'pu' });
    p.msg({ t: 'pluck', si: 0, fret: 0, amp: 1 });
    p.run(L, R);
    expect(L[127]).toBe(Math.fround(p.rig.tap[0]));
  });
});

describe('音色の切り替え', () => {
  it('絞ってから替え、前の音色で鳴っていた弦を消す', () => {
    const { p } = run(presetRack('lead'), 1, 'bend');
    expect(p.rig.voices.length).toBeGreaterThan(0);
    p.msg({ t: 'rack', R: presetRack('clean'), swap: true });
    const L = new Float32Array(256),
      R = new Float32Array(256);
    p.run(L, R);
    p.run(L, R);
    expect(p.rig.R.amp.type).toBe('clean');
    expect(p.rig.voices.every((v) => v.age < 512)).toBe(true);
  });
});

describe('フレーズ', () => {
  it('出来事はフレーズの長さに収まる', () => {
    for (const ph of PHRASES) for (const e of ph.ev) expect(e.b, ph.v).toBeLessThan(ph.bars * 4);
  });
  it('くり返しの 2 回目も弾き、単音は他の弦を止める', () => {
    const plucks: number[] = [],
      stops: number[] = [];
    const s = new Seq({
      pluck: (si) => plucks.push(si),
      stopString: (si) => stops.push(si),
      bendString: () => {},
      vibString: () => {},
    });
    const ph = phraseOf('lead');
    s.start('lead', 120, 0);
    for (let i = 0; i < 2 * ph.bars * 4 * 10 - 1; i++) s.step(0.05);
    expect(plucks.length).toBe(2 * ph.ev.filter((e) => e.k === 'pluck').length);
    expect(stops.length).toBeGreaterThan(0);
  });
});

describe('移調', () => {
  it('上げるときはフレットをずらし、下げるときは調弦を下げる', () => {
    const got: { fr: number; tune?: number }[] = [];
    const s = new Seq({
      pluck: (_si, fr, o) => got.push({ fr, tune: o.tune }),
      stopString: () => {},
      bendString: () => {},
      vibString: () => {},
    });
    s.key = 2;
    s.start('lead', 120, 0);
    s.step(0.01);
    expect(got[0]).toEqual({ fr: 17, tune: 0 });
    got.length = 0;
    s.key = -2;
    s.start('lead', 120, 0);
    s.step(0.01);
    expect(got[0]).toEqual({ fr: 15, tune: -2 });
  });
  it('いちばん上げてもフレットの数に収まる', () => {
    for (const p of PHRASES) {
      let mx = 0;
      const s = new Seq({
        pluck: (_si, fr) => {
          mx = Math.max(mx, fr);
        },
        stopString: () => {},
        bendString: () => {},
        vibString: () => {},
      });
      s.key = KEY.max ?? 0;
      s.start(p.v, p.bpm, 0);
      for (let i = 0; i < 400; i++) s.step(0.05);
      expect(mx, p.v).toBeLessThanOrEqual(FRETS);
    }
  });
});

describe('MIDI', () => {
  it('ピッチベンドを −1〜1 で読む', () => {
    expect(parseMidi([0xe0, 0, 64])).toEqual({ ch: 1, t: 'bend', v: 0 });
    expect(parseMidi([0xe1, 127, 127])).toEqual({ ch: 2, t: 'bend', v: 1 });
    expect(parseMidi([0xe0, 0, 0])).toEqual({ ch: 1, t: 'bend', v: -1 });
  });
});
