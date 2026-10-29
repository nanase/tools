import { describe, expect, it } from 'vitest';
import { fold, fronts, imageCount, images, path } from '../src/tools/reverb/image';
import {
  bandWeight,
  convolve,
  decayTime,
  EARLY_S,
  echoes,
  edc,
  fdnIR,
  gauss,
  mixBands,
  params,
  partOf,
  splitBands,
  synth,
} from '../src/tools/reverb/ir';
import {
  acoustics,
  BANDS,
  C0,
  dist,
  eyring,
  type Face,
  MATERIALS,
  NB,
  PRESETS,
  type Room,
  sabine,
} from '../src/tools/reverb/room';

/** 面がすべて同じ吸音率 a（全帯域）の部屋。空気の吸収は乾いた高温の空気でほぼ 0 にはできないので、別に外す */
const uniform = (a: number, dim: [number, number, number] = [6, 5, 3]): Room => {
  const v = `u${a}`;
  if (!MATERIALS.some((m) => m.v === v))
    (MATERIALS as { v: string; name: string; a: number[] }[]).push({ v, name: v, a: Array(NB).fill(a) });
  const mat = Object.fromEntries((['w', 'e', 's', 'n', 'f', 'c'] as Face[]).map((f) => [f, v])) as Record<Face, string>;
  return { dim, mat, src: [1.7, 2.1, 1.3], rcv: [4.2, 3.3, 1.6] };
};
const fs = 16000;

describe('残響時間の式', () => {
  it('Sabine の 0.161 は 24 ln 10 / c（c = 343 m/s）', () => {
    expect((24 * Math.LN10) / 343).toBeCloseTo(0.161, 3);
  });
  it('Eyring は吸音率が小さいと Sabine に近づき、1 で 0 になる', () => {
    const V = 100,
      S = 130;
    expect(eyring(V, S, 0.01) / sabine(V, S * 0.01)).toBeCloseTo(1, 1);
    expect(eyring(V, S, 0.5) / sabine(V, S * 0.5)).toBeCloseTo(0.5 / Math.log(2), 6);
    expect(eyring(V, S, 1)).toBe(0);
  });
  it('臨界距離 √(A/16π) は 0.057 √(V/T)（Sabine）と同じ', () => {
    const V = 2000,
      A = 300,
      T = sabine(V, A);
    expect(Math.sqrt(A / (16 * Math.PI)) / (0.057 * Math.sqrt(V / T))).toBeCloseTo(1, 1);
  });
  it('平均自由行程 4V/S・混合時間 √V ms', () => {
    const a = acoustics(uniform(0.2));
    expect(a.V).toBe(90);
    expect(a.S).toBe(2 * (30 + 15 + 18));
    expect(a.mfp).toBeCloseTo(360 / 126, 9);
    expect(a.tMix).toBeCloseTo(Math.sqrt(90) / 1000, 9);
  });
  it('部屋の例はすべて計算できる', () => {
    for (const p of PRESETS) {
      const a = acoustics(p.room);
      if (a.closed) for (const t of a.eyr) expect(t).toBeGreaterThan(0.05);
      else expect(a.closed).toBe(false);
    }
  });
});

describe('鏡像法', () => {
  it('1 回の反射は 6 つで、面に映した位置にある', () => {
    const r = uniform(0.2),
      im = images(r, { tMax: 1, orderMax: 1 }),
      [W, D, H] = r.dim,
      [x, y, z] = r.src,
      want = [
        [-x, y, z],
        [2 * W - x, y, z],
        [x, -y, z],
        [x, 2 * D - y, z],
        [x, y, -z],
        [x, y, 2 * H - z],
      ];
    expect(im.n).toBe(7);
    expect(im.order[0]).toBe(0);
    for (const w of want) {
      const k = Array.from({ length: im.n }, (_, i) => i).find(
        (i) => Math.hypot(im.x[i] - w[0], im.y[i] - w[1], im.z[i] - w[2]) < 1e-9,
      );
      expect(k).toBeDefined();
      expect(im.order[k as number]).toBe(1);
    }
  });
  it('振幅は β = √(1 − α) を反射の回数だけ掛け、距離で割る', () => {
    const r = uniform(0.36),
      im = images(r, { tMax: 0.2 });
    for (let i = 0; i < im.n; i += 97) {
      /* 空気の吸収の分を割り戻して比べる */
      const ratio = (im.amp[i * NB] * im.r[i]) / 0.8 ** im.order[i];
      expect(ratio).toBeGreaterThan(0.99);
      expect(ratio).toBeLessThanOrEqual(1);
    }
  });
  it('半径 R の中の鏡像の数は 4πR³ / 3V（Kuttruff）', () => {
    const r = uniform(0.2),
      im = images(r, { tMax: 0.25 }),
      R = C0 * 0.25;
    expect(im.n / imageCount(R, 90)).toBeCloseTo(1, 1);
  });
  it('反射の密度 dN/dt = 4πc³t² / V（Kuttruff）', () => {
    const r = uniform(0.2),
      im = images(r, { tMax: 0.25 }),
      t = 0.2,
      dt = 0.01;
    let n = 0;
    for (let i = 0; i < im.n; i++) if (im.t[i] >= t && im.t[i] < t + dt) n++;
    const want = (4 * Math.PI * C0 ** 3 * (t + dt / 2) ** 2 * dt) / 90;
    expect(n / want).toBeGreaterThan(0.95);
    expect(n / want).toBeLessThan(1.05);
  });
  it('経路の反射点は面の上にあり、長さは鏡像までの距離に等しい', () => {
    const r = uniform(0.2),
      im = images(r, { tMax: 0.06 });
    for (let i = 0; i < im.n; i++) {
      const p = path(r, im, i);
      expect(p.length).toBe(im.order[i] + 2);
      let len = 0;
      for (let k = 1; k < p.length; k++) len += dist(p[k - 1], p[k]);
      expect(len).toBeCloseTo(im.r[i], 6);
      for (let k = 1; k < p.length - 1; k++) {
        const onFace = p[k].some((u, a) => Math.abs(u) < 1e-9 || Math.abs(u - r.dim[a]) < 1e-9);
        expect(onFace).toBe(true);
      }
    }
  });
  it('折り返しは周期 2L の三角波', () => {
    expect(fold(-1, 5)).toBeCloseTo(1, 12);
    expect(fold(7, 5)).toBeCloseTo(3, 12);
    expect(fold(12, 5)).toBeCloseTo(2, 12);
  });
  it('屋外（地面だけ）は直接音と地面の反射の 2 つ', () => {
    const r = PRESETS.find((p) => p.v === 'open')?.room as Room,
      im = images(r, { tMax: 2 }),
      d = Math.hypot(r.src[0] - r.rcv[0], r.src[1] - r.rcv[1]),
      h = r.src[2] + r.rcv[2];
    expect(im.n).toBe(2);
    expect(im.r[1]).toBeCloseTo(Math.hypot(d, h), 9);
  });
  it('建物の壁が 1 枚あると、やまびこが分かれて聞こえる', () => {
    const r = PRESETS.find((p) => p.v === 'yamabiko')?.room as Room,
      sy = synth(r, { fs, dur: 0.6 }),
      ec = echoes(sy.h, fs, sy.t0);
    /* 東の壁（x = 60 m）へ往復: 約 2 × 55 m ÷ c ≈ 0.32 s 遅れる */
    expect(ec.length).toBe(1);
    expect(ec[0].dt).toBeGreaterThan(0.3);
    expect(ec[0].dt).toBeLessThan(0.34);
    /* 閉じた部屋の残響はエコーではない */
    const h = PRESETS.find((p) => p.v === 'class')?.room as Room,
      sh = synth(h, { fs, dur: 1.2 });
    expect(echoes(sh.h, fs, sh.t0)).toEqual([]);
  });
  it('波面: 直接音の円の半径は c·t', () => {
    const r = uniform(0.2),
      im = images(r, { tMax: 0.05 }),
      t = 0.004,
      fr = fronts(r, im, t);
    const d = fr.find((f) => f.order === 0);
    expect(d?.rho).toBeCloseTo(Math.sqrt((C0 * t) ** 2 - (r.src[2] - r.rcv[2]) ** 2), 9);
  });
});

describe('帯域', () => {
  it('帯域の重みの和はどの周波数でも 1', () => {
    for (const f of [0, 20, 100, 125, 177, 700, 1000, 3000, 4000, 10000, 20000]) {
      let s = 0;
      for (let b = 0; b < NB; b++) s += bandWeight(b, f);
      expect(s).toBeCloseTo(1, 12);
    }
    expect(bandWeight(2, 500)).toBe(1);
  });
  it('どの帯域も同じ列なら、分けて足すと元に戻る', () => {
    const x = new Float64Array(2000);
    x[300] = 1;
    x[1200] = -0.5;
    const y = mixBands(
      Array.from({ length: NB }, () => x),
      fs,
    );
    for (let i = 0; i < x.length; i++) expect(y[i]).toBeCloseTo(x[i], 9);
  });
  it('分けた帯域の和は元の列', () => {
    const r = gauss(3),
      x = Float64Array.from({ length: 3000 }, () => r()),
      bs = splitBands(x, fs);
    for (let i = 0; i < x.length; i += 37) expect(bs.reduce((s, b) => s + b[i], 0)).toBeCloseTo(x[i], 9);
  });
});

describe('解析（ISO 3382-1）', () => {
  /** 残響時間 T の指数で減衰する雑音 */
  const decay = (T: number, dur: number) => {
    const r = gauss(7);
    return Float64Array.from({ length: Math.round(dur * fs) }, (_, k) => r() * 10 ** ((-3 * k) / (T * fs)));
  };
  it('逆向き積分の T20・T30 は、指数の減衰の残響時間に一致する', () => {
    const h = decay(1.2, 3),
      e = edc(h);
    expect(decayTime(e, fs, -5, -25) / 1.2).toBeCloseTo(1, 1);
    expect(decayTime(e, fs, -5, -35) / 1.2).toBeCloseTo(1, 1);
  });
  it('指数の減衰の C80・D50 は 10 log(e^{13.8·0.08/T} − 1)・1 − e^{−13.8·0.05/T}', () => {
    const T = 1.5,
      h = decay(T, 5),
      p = params(h, fs, 0),
      k = 6 * Math.LN10;
    const c80 = 10 * Math.log10(Math.exp((k * 0.08) / T) - 1),
      d50 = 1 - Math.exp((-k * 0.05) / T);
    expect(p.c80[3]).toBeCloseTo(c80, 0);
    expect(p.d50[3]).toBeCloseTo(d50, 1);
  });
});

describe('合成', () => {
  /** 鏡像だけ（tMax まで）に当てはめた 500 Hz の残響時間と、Eyring の残響時間 */
  const ismT = (r: Room, tMax: number) => {
    const ac = acoustics(r),
      s = synth(r, { fs, dur: 2 * tMax, nMax: imageCount(C0 * tMax, ac.V), tail: 'fit' });
    return [s.tailT60[2], ac.eyr[2]];
  };
  it('立方体で吸音率が小さい部屋の鏡像の減衰は Eyring に近い（拡散に近い）', () => {
    for (const a of [0.1, 0.3]) {
      const [t, e] = ismT({ ...uniform(a, [10, 10, 10]), air: { t: 20, rh: 100 } }, 0.5);
      expect(t / e).toBeGreaterThan(0.95);
      expect(t / e).toBeLessThan(1.12);
    }
  });
  it('細長い部屋の鏡像の減衰は Eyring より遅い（鏡のような反射だけでは拡散にならない）', () => {
    const [t, e] = ismT({ ...uniform(0.3, [20, 4, 3]), air: { t: 20, rh: 100 } }, 0.4);
    expect(t / e).toBeGreaterThan(1.5);
  });
  it('延ばした残響の T30 は、当てはめた残響時間に一致する', () => {
    const r = uniform(0.15, [12, 9, 5]),
      s = synth(r, { fs, dur: 2.5, nMax: 15000, tail: 'eyring' }),
      p = params(s.h, fs, s.t0),
      ac = acoustics(r);
    expect(s.tTail).toBeLessThan(1);
    expect(p.t30[2] / ac.eyr[2]).toBeGreaterThan(0.9);
    expect(p.t30[2] / ac.eyr[2]).toBeLessThan(1.1);
  });
  it('直接音は 1/r の大きさで r/c に届く', () => {
    const r = uniform(0.2),
      s = synth(r, { fs, dur: 0.1 }),
      d = dist(r.src, r.rcv),
      k = Math.round((d / C0) * fs);
    let m = 0,
      at = 0;
    for (let i = 0; i < k + 10; i++)
      if (Math.abs(s.h[i]) > m) {
        m = Math.abs(s.h[i]);
        at = i;
      }
    expect(Math.abs(at - k)).toBeLessThanOrEqual(1);
    expect(s.t0).toBeCloseTo(d / C0, 9);
  });
  it('区分: 直接音・初期反射（80 ms まで）・後部残響', () => {
    expect(partOf(0.01, 0.01)).toBe('direct');
    expect(partOf(0.01 + EARLY_S, 0.01)).toBe('early');
    expect(partOf(0.02 + EARLY_S, 0.01)).toBe('late');
  });
});

describe('楽器のページの残響', () => {
  it('同じ部屋の値で作ったフィードバック遅延網の T30 は Eyring の残響時間に近い', () => {
    for (const v of ['class', 'hall', 'church']) {
      const r = PRESETS.find((p) => p.v === v)?.room as Room,
        [l] = fdnIR(r, fs, 8),
        p = params(l, fs, 0),
        ac = acoustics(r);
      expect(p.t30[2] / ac.eyr[2]).toBeGreaterThan(0.9);
      expect(p.t30[2] / ac.eyr[2]).toBeLessThan(1.1);
    }
  });
});

describe('畳み込み', () => {
  it('FFT の畳み込みは定義どおりの和に一致する', () => {
    const r = gauss(11),
      x = Float64Array.from({ length: 300 }, () => r()),
      h = Float64Array.from({ length: 77 }, () => r()),
      y = convolve(x, h);
    expect(y.length).toBe(376);
    for (const n of [0, 5, 76, 150, 299, 375]) {
      let s = 0;
      for (let k = 0; k < h.length; k++) if (n - k >= 0 && n - k < x.length) s += h[k] * x[n - k];
      expect(y[n]).toBeCloseTo(s, 9);
    }
  });
});

describe('帯域の数', () => {
  it('オクターブ帯 125 Hz〜4 kHz', () => {
    expect(BANDS).toEqual([125, 250, 500, 1000, 2000, 4000]);
  });
});
