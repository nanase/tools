import { describe, expect, it } from 'vitest';
import {
  CHORDS,
  type ChordId,
  envAt,
  hzOf,
  noteOf,
  octOf,
  roomIr,
  Shepard,
  TIMBRES,
  type TimbreId,
} from '../src/tools/shepard-tone/shepard';

const FS = 48000;
const chordIds = Object.keys(CHORDS) as ChordId[];
const timbreIds = Object.keys(TIMBRES) as TimbreId[];

function make(o: { chord?: ChordId; timbre?: TimbreId } & Partial<Shepard> = {}): Shepard {
  const { chord = 'major', timbre = 'sine', ...rest } = o,
    s = new Shepard(FS);
  s.setChord(CHORDS[chord].s);
  s.setTimbre(timbre);
  Object.assign(s, { on: true, ...rest });
  return s;
}
function run(s: Shepard, sec: number): Float32Array {
  const out = new Float32Array(Math.floor(sec * FS));
  for (let i = 0; i < out.length; i += 2048) {
    const b = new Float32Array(Math.min(2048, out.length - i));
    s.render(b, b.length);
    out.set(b, i);
  }
  return out;
}
const rms = (a: Float32Array, s = 0, e = a.length): number => {
  let v = 0;
  const i0 = Math.round(s),
    i1 = Math.round(e);
  for (let i = i0; i < i1; i++) v += a[i] * a[i];
  return Math.sqrt(v / Math.max(1, i1 - i0));
};
const db = (v: number): number => 20 * Math.log10(v);
/** ハン窓を掛けた 1 点の周波数成分の大きさ */
function amp(x: Float32Array, f: number): number {
  let re = 0,
    im = 0;
  for (let i = 0; i < x.length; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / x.length),
      p = (2 * Math.PI * f * i) / FS;
    re += x[i] * w * Math.cos(p);
    im += x[i] * w * Math.sin(p);
  }
  return (2 * Math.hypot(re, im)) / x.length / 0.5;
}

describe('無限音階の音', () => {
  it('山の外は 0 で、中心で 1 になる', () => {
    expect(envAt(4.5, 4.5, 9)).toBe(1);
    expect(envAt(0, 4.5, 9)).toBeCloseTo(0, 10);
    expect(envAt(-1, 4.5, 9)).toBe(0);
    expect(envAt(10, 4.5, 9)).toBe(0);
    expect(hzOf(octOf(440))).toBeCloseTo(440, 9);
  });

  it('どの和音と音色でも、1 オクターブ進むと同じ音の並びへ戻る', () => {
    for (const chord of chordIds)
      for (const timbre of timbreIds) {
        const s = make({ chord, timbre }),
          key = (p: number) =>
            s
              .voices(p)
              .map((v) => [v.x.toFixed(6), v.a.toFixed(6)].join())
              .sort(),
          pos = 3.37;
        expect(key(pos + 12), `${chord} ${timbre}`).toEqual(key(pos));
      }
  });

  it('山を変えても 1 オクターブで戻る', () => {
    const s = make({ timbre: 'organ', center: 3.2, width: 4.3 }),
      key = (p: number) =>
        s
          .voices(p)
          .map((v) => v.x.toFixed(6))
          .sort();
    expect(key(5.5 + 12)).toEqual(key(5.5));
  });

  it('音は音量 0 で出入りし、急に現れない', () => {
    for (const timbre of timbreIds)
      for (const [center, width] of [
        [4.5, 9],
        [2.5, 9],
        [6.5, 4],
      ]) {
        const s = make({ timbre, center, width }),
          dp = 0.02;
        let prev = new Map(s.voices(0).map((v) => [v.id, v.a])),
          worst = 0;
        for (let p = dp; p < 12; p += dp) {
          const cur = new Map(s.voices(p).map((v) => [v.id, v.a]));
          for (const [id, a] of cur) worst = Math.max(worst, Math.abs(a - (prev.get(id) ?? 0)));
          for (const [id, a] of prev) if (!cur.has(id)) worst = Math.max(worst, a);
          prev = cur;
        }
        expect(worst, `${timbre} ${center} ${width}`).toBeLessThan(0.02);
      }
  });

  it('動いても全体の音量がほぼ一定で、音色と和音で大きく変わらない', () => {
    const all: number[] = [];
    for (const timbre of timbreIds)
      for (const chord of ['single', 'dim7'] as const) {
        /* 1 オクターブ分を 4 秒で動かす */
        const x = run(make({ timbre, chord, vel: 3, rate: 3 }), 4),
          seg: number[] = [];
        for (let k = 0; k < 8; k++) seg.push(db(rms(x, k * 0.5 * FS, (k + 1) * 0.5 * FS)));
        expect(Math.max(...seg) - Math.min(...seg), `${timbre} ${chord}`).toBeLessThan(1.5);
        all.push(...seg);
      }
    expect(Math.max(...all) - Math.min(...all)).toBeLessThan(5);
    expect(Math.max(...all)).toBeLessThan(-3);
  });

  it('山を動かしても音は飛ばない', () => {
    const x = run(make({ timbre: 'saw', center: 2.5, width: 3, vel: 24, rate: 24 }), 2);
    let peak = 0;
    for (const v of x) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThan(1);
    expect(x.every(Number.isFinite)).toBe(true);
  });

  it('下降で 1 周しても数が壊れない（高い倍音が標本化周波数を超える）', () => {
    for (const timbre of timbreIds) {
      const x = run(make({ timbre, dir: -1, vel: -24, rate: 24 }), 2);
      expect(x.every(Number.isFinite), timbre).toBe(true);
    }
  });

  it('上昇と下降で位置の増減が変わる', () => {
    const up = make({ rate: 2 });
    run(up, 2);
    expect(up.pos).toBeGreaterThan(3);
    const dn = make({ rate: 2, dir: -1 });
    run(dn, 2);
    expect(dn.pos).toBeLessThan(-3);
  });

  it('音程の変化を止めても音は鳴り続け、再開すると進む', () => {
    const s = make({ rate: 2 });
    run(s, 1);
    s.moving = false;
    run(s, 1);
    const p = s.pos,
      x = run(s, 1);
    expect(Math.abs(s.pos - p)).toBeLessThan(1e-3);
    expect(rms(x)).toBeGreaterThan(0.05);
    s.moving = true;
    run(s, 1);
    expect(s.pos).toBeGreaterThan(p + 1);
  });

  it('止めると選んだ和音の音だけが出る', () => {
    const s = make({ chord: 'major', moving: false, pos: 0 });
    const x = run(s, 1.5).subarray(FS / 2);
    /* 位置 0 は A。メジャーは A・C♯・E */
    for (const f of [440, 554.37, 659.26]) expect(amp(x, f), `${f} Hz`).toBeGreaterThan(0.03);
    for (const f of [466.16, 523.25, 587.33]) expect(amp(x, f), `${f} Hz`).toBeLessThan(0.002);
  });

  it('半音ずつのときは位置が整数になり、音の変わり目で音量が 0 になる', () => {
    const s = make({ stepped: true, vel: 2, rate: 2, pos: 3.4 });
    expect(s.shown()).toBe(3);
    expect(s.gate(3.5)).toBe(0);
    expect(s.gate(3)).toBe(1);
    expect(s.gate(3.495)).toBeLessThan(0.05);
    s.vel = 0;
    expect(s.gate(3.5)).toBe(1);
    const x = run(make({ stepped: true, vel: 2, rate: 2 }), 3);
    expect(x.every(Number.isFinite)).toBe(true);
    expect(rms(x)).toBeGreaterThan(0.05);
  });

  it('止めると音が消えて位置も止まり、再生で続きから鳴る', () => {
    const s = make({ rate: 2 });
    run(s, 1);
    s.on = false;
    run(s, 0.3);
    const p = s.pos;
    expect(s.silent).toBe(true);
    expect(rms(run(s, 0.5))).toBe(0);
    expect(s.pos).toBe(p);
    s.on = true;
    expect(rms(run(s, 0.5))).toBeGreaterThan(0.05);
    expect(s.pos).toBeGreaterThan(p);
  });

  it('start で鳴らすと 0.5 秒ほどかけて大きくなる', () => {
    const s = make({ on: false, moving: false });
    s.start(0);
    const x = run(s, 1),
      w = FS / 20,
      at = (t: number) => rms(x, t * FS, t * FS + w);
    expect(at(0)).toBeLessThan(at(0.2) * 0.5);
    expect(at(0.2)).toBeLessThan(at(0.6) * 0.8);
    expect(at(0.6)).toBeCloseTo(at(0.9), 2);
  });

  it('和音を替えた直後に音が飛ばない', () => {
    const s = make({ moving: false });
    run(s, 0.5);
    const out = new Float32Array(4800);
    s.setChord(CHORDS.dim7.s);
    s.render(out, out.length);
    let jump = 0;
    for (let i = 1; i < out.length; i++) jump = Math.max(jump, Math.abs(out[i] - out[i - 1]));
    expect(jump).toBeLessThan(0.5);
    expect(out.every(Number.isFinite)).toBe(true);
  });

  it('音色を替えても鳴り続ける', () => {
    const s = make({ moving: false });
    run(s, 0.3);
    s.setTimbre('bell');
    run(s, 0.2);
    expect(rms(run(s, 0.3))).toBeGreaterThan(0.05);
    expect(s.voices().some((v) => !v.fund)).toBe(true);
  });

  it('音名とセントを読む', () => {
    expect(noteOf(0)).toEqual({ name: 'A', cent: 0 });
    expect(noteOf(3.25)).toEqual({ name: 'C', cent: 25 });
    expect(noteOf(-1)).toEqual({ name: 'G♯', cent: 0 });
    expect(noteOf(24.6).name).toBe('A♯');
    expect(noteOf(24.6).cent).toBe(-40);
  });
});

describe('残響のインパルス応答', () => {
  it('エネルギーが 1 で、t60 で 60 dB ほど減り、左右で違う', () => {
    const L = roomIr(FS, 2.2, 1234),
      R = roomIr(FS, 2.2, 98765);
    let e = 0;
    for (const v of L) e += v * v;
    expect(e).toBeCloseTo(1, 5);
    expect(L.length).toBe(Math.ceil(2.2 * 1.15 * FS));
    const head = rms(L, 0.05 * FS, 0.15 * FS),
      tail = rms(L, 2.05 * FS, 2.15 * FS);
    expect(db(tail / head)).toBeLessThan(-45);
    expect(L[1000]).not.toBe(R[1000]);
  });
});
