import { describe, expect, it } from 'vitest';
import {
  axleOffsets,
  CARS,
  type CarId,
  gateOn,
  hzPerKmh,
  modeOf,
  pick,
  type Run,
  seatAt,
  V_MAX,
} from '../src/tools/vvvf/cars';
import { Drive, V_TOP } from '../src/tools/vvvf/drive';
import { ECHO, makeIr } from '../src/tools/vvvf/echo';
import { Inverter, railLevel, tri } from '../src/tools/vvvf/inverter';

const FS = 48000;
const ids = Object.keys(CARS) as CarId[];
const power = (v: number): Run => ({ v, a: 0, power: true, brake: false });

/** 音を作る。road は走行音、force は磁力の音 */
function sound(
  id: CarId,
  r: Run,
  sec: number,
  opt: { road?: boolean; force?: boolean; rail?: number } = {},
): Float32Array {
  const inv = new Inverter(CARS[id], FS);
  inv.road = opt.road ?? false;
  inv.force = opt.force ?? false;
  inv.rail = opt.rail ?? 0;
  const n = Math.floor(sec * FS),
    x = new Float32Array(n);
  for (let i = 0; i < n; i += 256) inv.render(r, x, i, Math.min(256, n - i));
  return x.subarray(Math.floor(0.2 * FS));
}
/** ハン窓を掛けた 1 点の周波数成分の大きさ */
function amp(x: ArrayLike<number>, f: number): number {
  let re = 0,
    im = 0;
  const n = x.length;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n),
      a = (2 * Math.PI * f * i) / FS;
    re += w * x[i] * Math.cos(a);
    im -= w * x[i] * Math.sin(a);
  }
  return (4 * Math.hypot(re, im)) / n;
}
/** 範囲の中で最も強い周波数 */
function peak(x: ArrayLike<number>, lo: number, hi: number, step = 2): number {
  let best = lo,
    v = -1;
  for (let f = lo; f <= hi; f += step) {
    const a = amp(x, f);
    if (a > v) {
      v = a;
      best = f;
    }
  }
  return best;
}
/** 自動で走らせ、条件を満たすまでの時間 [s] を返す */
function timeUntil(d: Drive, ok: (d: Drive) => boolean, max = 200): number {
  const dt = 1 / 750;
  for (let t = 0; t < max; t += dt) {
    if (ok(d)) return t;
    d.tick(dt);
  }
  return Number.POSITIVE_INFINITY;
}

describe('モードの表', () => {
  it('どの車種も基本波の小さい順に並び、0 Hz から始まって 1 パルスで終わる', () => {
    for (const id of ids)
      for (const tab of [CARS[id].acc, CARS[id].brk]) {
        expect(tab[0].f).toBe(0);
        for (let i = 1; i < tab.length; i++) expect(tab[i].f).toBeGreaterThan(tab[i - 1].f);
        const last = tab[tab.length - 1];
        expect(last.sync && last.n).toBe(1);
      }
  });
  it('同期のキャリアは基本波のちょうど整数倍、非同期は基本波によらない', () => {
    const c = CARS.tokyu9000;
    for (const f of [8, 20, 30, 40]) {
      const p = pick(c.acc, f);
      expect(p.s.sync).toBe(true);
      expect(p.fc / f).toBe(p.s.sync ? p.s.n : 0);
    }
    expect(pick(CARS.tokyu5000.acc, 5).fc).toBe(740);
    expect(pick(CARS.tokyu5000.acc, 15).fc).toBe(740);
  });
  it('5000 系は 3 パルスを挟んで 1 パルスへ移る', () => {
    const t = CARS.tokyu5000.acc;
    expect(pick(t, 50).s.sync).toBe(false);
    const p3 = pick(t, 57).s,
      p1 = pick(t, 70).s;
    expect(p3.sync && p3.n).toBe(3);
    expect(p1.sync && p1.n).toBe(1);
  });
  it('歯車比は公表の値', () => {
    expect(CARS.tokyu5000.gear).toBeCloseTo(6.21, 2);
    expect(CARS.tokyu9000.gear).toBeCloseTo(6.07, 2);
    expect(CARS.keikyu.gear).toBeCloseTo(5.93, 2);
  });
  it('京急のキャリアはファソラシドレミファソに近い', () => {
    const notes = [175, 196, 223, 233, 262, 294, 311, 350, 400];
    const scale = [174.6, 196, 220, 233.1, 261.6, 293.7, 311.1, 349.2, 392];
    notes.forEach((f, i) => {
      expect(Math.abs(1200 * Math.log2(f / scale[i]))).toBeLessThan(40);
    });
    expect(pick(CARS.keikyu.acc, 1.3).fc).toBe(262);
  });
});

describe('モードの判定', () => {
  it('惰行とブレーキの終わりではスイッチが止まる', () => {
    const c = CARS.keikyu;
    expect(gateOn(c, { v: 50, a: 0, power: false, brake: false })).toBe(false);
    expect(gateOn(c, { v: 50, a: -3, power: false, brake: true })).toBe(true);
    expect(gateOn(c, { v: 5, a: -3, power: false, brake: true })).toBe(false);
    /* 5000 系は止まるまで電気ブレーキが効く */
    expect(gateOn(CARS.tokyu5000, { v: 0.5, a: -1, power: false, brake: true })).toBe(true);
  });
  it('基本波の周波数は速度に比例する', () => {
    const c = CARS.tokyu5000,
      a = modeOf(c, power(40)),
      b = modeOf(c, power(80));
    expect(b.f1 / a.f1).toBeCloseTo(2, 6);
    expect(hzPerKmh(c)).toBeGreaterThan(1.2);
    expect(hzPerKmh(c)).toBeLessThan(1.35);
  });
});

describe('運転', () => {
  it('自動: 発車して上の速度まで加速し、惰行してブレーキで止まる', () => {
    for (const id of ids) {
      const d = new Drive(CARS[id]);
      d.auto();
      expect(timeUntil(d, (x) => x.v >= V_TOP)).toBeLessThan(60);
      const coast = timeUntil(d, (x) => !x.power && x.a <= 0.001);
      expect(coast).toBeLessThan(10);
      expect(timeUntil(d, (x) => x.brake)).toBeLessThan(4);
      expect(timeUntil(d, (x) => x.kind === 'stop')).toBeLessThan(60);
      expect(d.v).toBe(0);
      expect(d.power || d.brake).toBe(false);
    }
  });
  it('自動: 走行中に入れると今の速度から続ける', () => {
    const d = new Drive(CARS.tokyu5000);
    d.hand(3);
    timeUntil(d, (x) => x.v >= 30);
    const v0 = d.v;
    d.auto();
    d.tick(0.01);
    expect(Math.abs(d.v - v0)).toBeLessThan(0.1);
    expect(d.power).toBe(true);
  });
  it('京急の音階は加速を入れてすぐ上がり始め、約 1.1 秒で上がり切り、最後の音が 3 秒以上続く', () => {
    const c = CARS.keikyu,
      d = new Drive(c);
    d.auto();
    expect(timeUntil(d, (x) => modeOf(c, x).fc > 175)).toBeLessThan(0.25);
    expect(d.v).toBeLessThan(0.2);
    const d2 = new Drive(c);
    d2.auto();
    const t = timeUntil(d2, (x) => modeOf(c, x).fc >= 400);
    expect(t).toBeGreaterThan(0.9);
    expect(t).toBeLessThan(1.35);
    /* 上がり切った時点でも、ほとんど走っていない */
    expect(d2.v).toBeLessThan(1.5);
    expect(timeUntil(d2, (x) => modeOf(c, x).sync)).toBeGreaterThan(3);
  });
  it('京急の音階は自動運転で等間隔に上がる', () => {
    const c = CARS.keikyu,
      d = new Drive(c),
      dt = 1 / 750,
      at: number[] = [];
    let last = modeOf(c, { ...d, power: true }).fc;
    d.auto();
    for (let t = 0; t < 1.5; t += dt) {
      d.tick(dt);
      const f = modeOf(c, d).fc;
      if (f !== last) at.push(t);
      last = f;
    }
    expect(at.length).toBe(8);
    for (let i = 0; i < at.length; i++) expect(Math.abs(at[i] - 0.14 * (i + 1))).toBeLessThan(0.012);
  });
  it('加速のすべりは段に比例し、やめるとすぐ消える', () => {
    const c = CARS.keikyu,
      d = new Drive(c);
    d.hand(1);
    for (let i = 0; i < 300; i++) d.tick(0.01);
    expect(d.slip).toBeCloseTo(2.6 / 3, 3);
    d.hand(3);
    for (let i = 0; i < 300; i++) d.tick(0.01);
    expect(d.slip).toBeCloseTo(2.6, 3);
    d.hand(0);
    for (let i = 0; i < 60; i++) d.tick(0.01);
    expect(d.slip).toBe(0);
    d.halt();
    expect(d.slip).toBe(0);
  });
  it('緊急停止: どの状態からでもすぐ 0 km/h になる', () => {
    const d = new Drive(CARS.tokyu5000);
    d.auto();
    timeUntil(d, (x) => x.v >= 50);
    d.halt();
    expect(d.v).toBe(0);
    expect(d.a).toBe(0);
    expect(d.kind).toBe('stop');
    d.tick(1);
    expect(d.v).toBe(0);
  });
  it('手動: 加速は上限の速度で止まり、ブレーキで止まりきると停止になる', () => {
    const d = new Drive(CARS.tokyu5000);
    d.hand(3);
    timeUntil(d, (x) => x.v >= V_MAX);
    for (let i = 0; i < 1000; i++) d.tick(0.01);
    expect(d.v).toBeLessThanOrEqual(V_MAX);
    d.hand(-3);
    expect(timeUntil(d, (x) => x.kind === 'stop')).toBeLessThan(80);
    expect(d.v).toBe(0);
  });
  it('手動: 止まっている間に惰行かブレーキを押しても動かない', () => {
    const d = new Drive(CARS.tokyu5000);
    d.hand(0);
    expect(d.kind).toBe('stop');
    d.hand(-2);
    expect(d.kind).toBe('stop');
    expect(d.v).toBe(0);
  });
  it('手動: ブレーキで速度が下がる。加速から切り替えても 1 秒あまりで下がり始める', () => {
    const d = new Drive(CARS.tokyu9000);
    d.hand(3);
    timeUntil(d, (x) => x.v >= 40);
    d.hand(-3);
    expect(timeUntil(d, (x) => x.a < 0, 2)).toBeLessThan(1.5);
    const v = d.v;
    for (let i = 0; i < 100; i++) d.tick(0.01);
    expect(d.v).toBeLessThan(v);
  });
});

describe('臨場感', () => {
  const rms = (x: ArrayLike<number>) => {
    let e = 0;
    for (let i = 0; i < x.length; i++) e += x[i] * x[i];
    return Math.sqrt(e / x.length);
  };
  it('編成の全車軸が前から順に、台車ごとに 2 本ずつ並ぶ', () => {
    for (const id of ['tokyu5000', 'tokyu9000', 'keikyu'] as const) {
      const c = CARS[id],
        a = axleOffsets(c);
      expect(a.length).toBe(c.cars * 4);
      for (let i = 1; i < a.length; i++) expect(a[i]).toBeLessThan(a[i - 1]);
      /* 聞く車両の台車は中央をはさんで前後に並ぶ */
      expect(a).toContainEqual(c.bogie / 2 + 1.05);
      expect(a).toContainEqual(-c.bogie / 2 - 1.05);
    }
  });
  it('連結部寄りの席に近い 4 本は、連結部をはさむ 2 つの台車で 2.1・4.1・2.1 m 間隔', () => {
    const c = CARS.tokyu5000,
      seat = seatAt(c, true),
      near = axleOffsets(c)
        .filter((x) => Math.abs(x - seat) < 6)
        .sort((p, q) => q - p);
    expect(near.length).toBe(4);
    const gap = near.slice(1).map((x, i) => near[i] - x);
    expect(gap[0]).toBeCloseTo(2.1, 6);
    expect(gap[1]).toBeCloseTo(4.1, 6);
    expect(gap[2]).toBeCloseTo(2.1, 6);
    /* 京急は車体が短いので、連結部をはさむ台車が近い */
    const k = axleOffsets(CARS.keikyu);
    expect(k[1] - k[2]).toBeCloseTo(CARS.keikyu.bogie - 2.1, 6);
    expect(CARS.keikyu.len - CARS.keikyu.bogie - 2.1).toBeLessThan(gap[1]);
  });
  it('打音の減りは録音の測定に沿う: 20 m 先は近い音より 10〜20 dB 低く、100 m 先でも消え切らない', () => {
    const near = railLevel(1.55),
      db = (d: number) => 20 * Math.log10(railLevel(d) / near);
    expect(db(20)).toBeLessThan(-10);
    expect(db(20)).toBeGreaterThan(-20);
    expect(db(100)).toBeLessThan(db(20));
    expect(db(100)).toBeGreaterThan(-60);
  });
  it('連結部寄りの席は車両の中央よりレールの音が大きい', () => {
    const c: Run = { v: 70, a: 0, power: false, brake: false },
      run = (end: boolean) => {
        const inv = new Inverter(CARS.tokyu5000, FS);
        inv.road = false;
        inv.seatEnd = end;
        const x = new Float32Array(FS * 5);
        for (let i = 0; i < x.length; i += 256) inv.render(c, x, i, Math.min(256, x.length - i));
        return rms(x);
      };
    expect(run(true)).toBeGreaterThan(run(false) * 1.2);
  });
  it('編成が長いほど遠い車両の音が加わる', () => {
    const c: Run = { v: 70, a: 0, power: false, brake: false },
      run = (cars: number) => {
        const inv = new Inverter({ ...CARS.tokyu5000, cars }, FS);
        inv.road = false;
        inv.seatEnd = false;
        const x = new Float32Array(FS * 5);
        for (let i = 0; i < x.length; i += 256) inv.render(c, x, i, Math.min(256, x.length - i));
        return rms(x);
      };
    expect(run(10)).toBeGreaterThan(run(1));
  });
  it('打音は毎回違う雑音で、速いほど大きい', () => {
    const c: Run = { v: 90, a: 0, power: false, brake: false },
      x = sound('tokyu5000', c, 4.2, { rail: 25 }),
      /* 25 m / 25 m/s = 1 秒。同じ打音の繰り返しなら 1 秒ずらした波形がよく似る */
      a = x.subarray(FS, FS * 2),
      b = x.subarray(FS * 2, FS * 3);
    let ab = 0;
    for (let i = 0; i < a.length; i++) ab += a[i] * b[i];
    expect(Math.abs(ab / (a.length * rms(a) * rms(b)))).toBeLessThan(0.2);
    expect(rms(x)).toBeGreaterThan(rms(sound('tokyu5000', { ...c, v: 45 }, 4.2, { rail: 25 })) * 1.5);
  });
  it('打音の中心は 100〜500 Hz で、30 Hz より強い', () => {
    const c: Run = { v: 70, a: 0, power: false, brake: false },
      x = sound('tokyu5000', c, 5, { rail: 25 }),
      band = (from: number, to: number, st: number) => {
        let e = 0,
          n = 0;
        for (let f = from; f <= to; f += st, n++) e += amp(x, f) ** 2;
        return e / n;
      };
    expect(band(120, 500, 20)).toBeGreaterThan(band(20, 40, 5) * 2);
    expect(band(120, 500, 20)).toBeGreaterThan(band(2000, 6000, 200) * 10);
  });
  it('高速では走行音がスイッチの音より大きく、低速では小さい', () => {
    const at = (v: number) => {
      const on = rms(sound('tokyu5000', power(v), 0.6)),
        all = rms(sound('tokyu5000', power(v), 0.6, { road: true })),
        road = Math.sqrt(Math.max(0, all * all - on * on));
      return { on, road };
    };
    const hi = at(75),
      lo = at(10);
    expect(hi.road).toBeGreaterThan(hi.on);
    expect(lo.road).toBeLessThan(lo.on / 3);
  });
  it('継ぎ目の音は速度と間隔で決まる周期で鳴る', () => {
    /* 惰行で走行音なし: 継ぎ目の音だけになる。大きさの自己相関の山が周期になる */
    const c: Run = { v: 90, a: 0, power: false, brake: false },
      x = sound('tokyu5000', c, 6.2, { rail: 25 }),
      env = Array.from({ length: Math.floor(x.length / 480) }, (_, i) => rms(x.subarray(i * 480, (i + 1) * 480)));
    let best = 0,
      lag = 0;
    for (let k = 70; k <= 130; k++) {
      let e = 0;
      for (let i = 0; i + k < env.length; i++) e += env[i] * env[i + k];
      e /= env.length - k;
      if (e > best) {
        best = e;
        lag = k;
      }
    }
    /* 25 m / 25 m/s = 1 秒 */
    expect(Math.abs(lag * 0.01 - 1)).toBeLessThan(0.03);
  });
  it('継ぎ目の音は走行音より大きく聞こえ、低い音が強い', () => {
    const c: Run = { v: 60, a: 0, power: false, brake: false },
      j = sound('tokyu5000', c, 3.2, { rail: 25 }),
      roadOnly = sound('tokyu5000', c, 1.2, { road: true });
    let p = 0;
    for (const v of j) p = Math.max(p, Math.abs(v));
    /* 山の高さが走行音の実効値の 2 倍以上 */
    expect(p).toBeGreaterThan(rms(roadOnly) * 2);
    /* 低い帯（40〜300 Hz）のほうが高い帯（1〜4 kHz）より強い */
    const band = (a: number, b: number, st: number) => {
      let e = 0;
      for (let f = a; f <= b; f += st) e += amp(j, f) ** 2;
      return e / ((b - a) / st);
    };
    expect(band(40, 300, 20)).toBeGreaterThan(band(1000, 4000, 200));
  });
  it('継ぎ目の音はなしにでき、止まっていれば鳴らない', () => {
    const c: Run = { v: 60, a: 0, power: false, brake: false };
    expect(rms(sound('tokyu5000', c, 2, { rail: 0 }))).toBeLessThan(1e-3);
    expect(rms(sound('tokyu5000', c, 2, { rail: 25 }))).toBeGreaterThan(1e-3);
    expect(rms(sound('tokyu5000', { ...c, v: 0 }, 1, { rail: 25 }))).toBeLessThan(1e-3);
  });
  it('ロングレールは定尺レールより継ぎ目が少ない', () => {
    const c: Run = { v: 90, a: 0, power: false, brake: false },
      e = (L: number) => rms(sound('tokyu5000', c, 4, { rail: L }));
    expect(e(200)).toBeLessThan(e(25));
  });
  it('ステレオでは左右が違い、なしでは同じになる', () => {
    const run = (stereo: boolean) => {
      const inv = new Inverter(CARS.tokyu5000, FS);
      inv.stereo = stereo;
      const n = FS,
        L = new Float32Array(n),
        R = new Float32Array(n);
      for (let i = 0; i < n; i += 256) inv.render(power(70), L, i, Math.min(256, n - i), R);
      return { L, R };
    };
    const a = run(true),
      b = run(false);
    let dA = 0,
      dB = 0;
    for (let i = 0; i < FS; i++) {
      dA += Math.abs(a.L[i] - a.R[i]);
      dB += Math.abs(b.L[i] - b.R[i]);
    }
    expect(dA).toBeGreaterThan(100);
    expect(dB).toBe(0);
  });
  it('反響: トンネルは 2 kHz の音も響く', () => {
    const [t] = makeIr('tunnel', FS, false),
      head = t.subarray(Math.floor(0.2 * FS), Math.floor(0.8 * FS));
    expect(amp(head, 2000)).toBeGreaterThan(amp(head, 300) * 0.15);
  });
  it('反響: トンネルは地上より長く、エネルギーは 1 にそろう', () => {
    const [gL] = makeIr('ground', FS, true),
      [tL, tR] = makeIr('tunnel', FS, true),
      [mL, mR] = makeIr('tunnel', FS, false);
    expect(tL.length).toBeGreaterThan(gL.length * 4);
    expect(ECHO.tunnel.wet).toBeGreaterThan(ECHO.ground.wet);
    for (const x of [gL, tL]) expect(rms(x) * Math.sqrt(x.length)).toBeCloseTo(1, 3);
    expect(tL).not.toEqual(tR);
    expect(mL).toBe(mR);
    /* 後ろへ行くほど小さい */
    const part = (x: Float32Array, a: number, b: number) => rms(x.subarray(a * FS, b * FS));
    expect(part(tL, 0.5, 0.6)).toBeLessThan(part(tL, 0.1, 0.2));
    expect(part(tL, 2, 2.1)).toBeLessThan(part(tL, 0.5, 0.6));
    expect(tL.every(Number.isFinite)).toBe(true);
  });
  it('走行音の音量の倍率で走行音だけが変わる', () => {
    const c: Run = { v: 60, a: 0, power: false, brake: false },
      run = (lv: number) => {
        const inv = new Inverter(CARS.tokyu5000, FS);
        inv.roadLevel = lv;
        inv.rail = 0;
        const n = FS,
          x = new Float32Array(n);
        for (let i = 0; i < n; i += 256) inv.render(c, x, i, Math.min(256, n - i));
        return rms(x.subarray(4800));
      };
    expect(run(1) / run(0.5)).toBeGreaterThan(1.7);
    expect(run(1) / run(0.5)).toBeLessThan(2.1);
  });
  it('トンネルでは走行音が大きくなる', () => {
    const run = (tunnel: boolean) => {
      const inv = new Inverter(CARS.tokyu5000, FS);
      inv.tunnel = tunnel;
      inv.rail = 0;
      const n = FS,
        x = new Float32Array(n),
        c: Run = { v: 60, a: 0, power: false, brake: false };
      for (let i = 0; i < n; i += 256) inv.render(c, x, i, Math.min(256, n - i));
      return rms(x);
    };
    expect(run(true) / run(false)).toBeGreaterThan(1.2);
  });
  it('hush で鳴っている継ぎ目の音が消える', () => {
    const inv = new Inverter(CARS.tokyu5000, FS),
      c: Run = { v: 90, a: 0, power: false, brake: false },
      s0: Run = { v: 0, a: 0, power: false, brake: false },
      x = new Float32Array(1024);
    inv.road = false;
    inv.rail = 25;
    /* 踏むまで走らせる */
    let hit = false;
    for (let i = 0; i < 200 && !hit; i++) {
      inv.render(c, x, 0, 1024);
      hit = rms(x) > 1e-3;
    }
    expect(hit).toBe(true);
    inv.hush();
    /* 遅れて届くはずの遠い音も残らない */
    for (let i = 0; i < 40; i++) {
      inv.render(s0, x, 0, 1024);
      expect(rms(x)).toBeLessThan(1e-4);
    }
  });
});

describe('インバータの音', () => {
  it('三角波は振幅 1 で周期 1', () => {
    expect(tri(0)).toBe(0);
    expect(tri(0.25)).toBeCloseTo(1, 12);
    expect(tri(0.75)).toBeCloseTo(-1, 12);
    expect(tri(1.25)).toBeCloseTo(1, 12);
  });
  it('非同期の低速はキャリアの 2 倍付近が主になる', () => {
    /* 5000 系の 3 km/h: 基本波が小さく、キャリア 740 Hz の 2 倍の両脇が強い */
    const x = sound('tokyu5000', { v: 3, a: 3.3, power: true, brake: false }, 0.8),
      p = peak(x, 300, 3200, 4);
    expect(Math.abs(p - 1480)).toBeLessThan(40);
  });
  it('速度が上がっても非同期なら音の中心はキャリアで決まる', () => {
    const a = peak(sound('tokyu5000', power(5), 0.7), 1300, 1660, 4),
      b = peak(sound('tokyu5000', power(12), 0.7), 1300, 1660, 4);
    expect(Math.abs(a - 1480)).toBeLessThan(40);
    expect(Math.abs(b - 1480)).toBeLessThan(40);
  });
  it('同期の成分は基本波の整数倍に並び、速度に比例して高くなる', () => {
    const c = CARS.tokyu9000,
      f1 = hzPerKmh(c) * 18,
      x = sound('tokyu9000', power(18), 0.8);
    /* 同期 15 倍: 主な成分は基本波の 13・17 倍あたり。2 台を重ねているので 1 台目の周波数で測る */
    const onGrid = Math.max(amp(x, f1 * 13), amp(x, f1 * 17)),
      off = Math.max(amp(x, f1 * 13.5), amp(x, f1 * 16.5));
    expect(onGrid).toBeGreaterThan(off * 5);
  });
  it('1 パルスは基本波の 5・7 倍が強く、スイッチの高い音がない', () => {
    const c = CARS.tokyu5000,
      f1 = hzPerKmh(c) * 70,
      x = sound('tokyu5000', power(70), 0.8),
      h5 = amp(x, f1 * 5),
      h7 = amp(x, f1 * 7),
      none = amp(x, f1 * 6.5);
    expect(h5).toBeGreaterThan(none * 5);
    expect(h7).toBeGreaterThan(none * 5);
  });
  it('京急の音階の高さはキャリアの 2 倍で鳴る', () => {
    const c = CARS.keikyu,
      v = 1 / hzPerKmh(c),
      x = sound('keikyu', { v, a: 0, power: true, brake: false }, 0.8),
      /* キャリア 233 Hz: 2・4・6 倍…に並ぶので、いちばん低い音の高さは 466 Hz */
      p = peak(x, 150, 700, 2);
    expect(Math.abs(p - 2 * 233)).toBeLessThan(25);
  });
  it('5000 系の停止直前はキャリア 200 Hz になる', () => {
    expect(modeOf(CARS.tokyu5000, { v: 1, a: -2, power: false, brake: true }).fc).toBe(200);
  });
  it('惰行ではスイッチの音が消え、走行音だけが残る', () => {
    const coast: Run = { v: 60, a: 0, power: false, brake: false },
      rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
    expect(rms(sound('tokyu5000', coast, 0.6))).toBeLessThan(1e-3);
    expect(rms(sound('tokyu5000', coast, 0.6, { road: true }))).toBeGreaterThan(0.01);
  });
  it('どの車種・音源でも発散せず、音の大きさが 2 を超えない', () => {
    for (const id of ids)
      for (const force of [false, true])
        for (const v of [0, 3, 20, 45, 60, 100]) {
          const x = sound(id, power(v), 0.3, { road: true, force, rail: 25 });
          for (const s of x) expect(Math.abs(s)).toBeLessThanOrEqual(2);
          expect(x.every(Number.isFinite)).toBe(true);
        }
  });
  it('44.1 kHz でも同じ周波数で鳴る', () => {
    const inv = new Inverter(CARS.tokyu5000, 44100);
    inv.road = false;
    inv.rail = 0;
    const n = 44100,
      x = new Float32Array(n);
    for (let i = 0; i < n; i += 256) inv.render(power(5), x, i, Math.min(256, n - i));
    let best = 0,
      v = -1;
    for (let f = 1300; f <= 1660; f += 4) {
      let re = 0,
        im = 0;
      for (let i = 8820; i < n; i++) {
        const a = (2 * Math.PI * f * i) / 44100;
        re += x[i] * Math.cos(a);
        im -= x[i] * Math.sin(a);
      }
      const q = Math.hypot(re, im);
      if (q > v) {
        v = q;
        best = f;
      }
    }
    expect(Math.abs(best - 1480)).toBeLessThan(40);
  });
  it('idle は止まって音が消え切ってから真になる', () => {
    const inv = new Inverter(CARS.tokyu5000, FS),
      r: Run = { v: 0, a: 0, power: false, brake: false },
      on: Run = { v: 10, a: 1, power: true, brake: false },
      x = new Float32Array(1024);
    for (let i = 0; i < 20; i++) inv.render(on, x, 0, 1024);
    expect(inv.idle(r)).toBe(false);
    for (let i = 0; i < 20; i++) inv.render(r, x, 0, 1024);
    expect(inv.idle(r)).toBe(true);
  });
});
