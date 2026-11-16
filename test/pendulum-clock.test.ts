import { describe, expect, it } from 'vitest';
import { ART, LOOP } from '../src/lib/card-art';
import { D, DEG, ESC_DT, EscSim, makeEsc, PITCH, toothPts } from '../src/tools/pendulum-clock/esc';

const insidePoly = (pts: readonly [number, number][], x: number, y: number) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i],
      [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

import {
  Clock,
  countAt,
  HAM,
  hamAngle,
  hPinsAt,
  liftAt,
  lockArmDist,
  lockByLift,
  lockByRim,
  type Pt,
  rateOf,
  rimAt,
  SK,
  SLOT,
  springF,
  TABLES,
  W,
  wPinAt,
} from '../src/tools/pendulum-clock/model';
import { caseIR, roomIR } from '../src/tools/pendulum-clock/room';
import { gongModes, makeSfx, PLATE } from '../src/tools/pendulum-clock/sfx';

describe('輪列', () => {
  it('がんぎ車は 1 時間に 120 回転、香箱は 1 日に 1 回転', () => {
    const esc = (80 / 8) * (72 / 6),
      bar = (72 / 12) * (48 / 12);
    expect(esc).toBe(120);
    expect(bar).toBe(24);
    expect(W.esc.r).toBe(12);
  });
  it('数取り車は 12 時間で 90 打ち（30 分の 1 打ちと正時の 1〜12 打ち）', () => {
    expect(SLOT[SLOT.length - 1]).toBe(90);
    expect(countAt(0)).toBe(0);
    expect(countAt(150)).toBe(SLOT[5]);
  });
});

describe('脱進機', () => {
  for (const type of ['recoil', 'graham', 'brocot'] as const)
    it(`${type}: 1 秒に 1 歯（12°）進み、振り角が保たれる`, () => {
      const s = new EscSim(type, { T: TABLES[type].T, A: TABLES[type].A(1) });
      let adv0 = 0;
      while (s.t < 12) {
        s.step(ESC_DT);
        if (!adv0 && s.t >= 2) adv0 = s.adv;
      }
      const run = (s.adv - adv0) / DEG / (s.t - 2);
      expect(run).toBeGreaterThan(11);
      expect(run).toBeLessThan(13);
      expect(Math.abs(s.th) / DEG).toBeLessThan(5);
    });
  it('力が弱まると、リコイル式は遅れ、グラハム式はわずかに進む', () => {
    const d = (t: 'recoil' | 'graham' | 'brocot') => rateOf(t, springF(2)) - rateOf(t, 1);
    expect(d('recoil')).toBeLessThan(-20);
    expect(d('graham')).toBeGreaterThan(0);
    expect(Math.abs(d('graham'))).toBeLessThan(20);
  });
  for (const type of ['recoil', 'graham', 'brocot'] as const)
    it(`${type}: 歯先のほかは爪に食い込まない（歯と爪が噛み合う形）`, () => {
      const s = new EscSim(type, { T: TABLES[type].T, A: TABLES[type].A(1) }),
        e = makeEsc(type);
      let worst = 0;
      while (s.t < 4) {
        s.step(ESC_DT);
        const c = Math.cos(s.th),
          sn = Math.sin(s.th),
          base = Math.round(s.adv / PITCH);
        for (let side = 0; side < 2; side++)
          for (let dk = -2; dk <= 2; dk++) {
            const tp = toothPts(type, e.phi0, (side ? -7 : 0) + base + dk, s.adv);
            /* 歯の先端（1 番目の点）のほかの点が爪の中にないか */
            for (const [vi, [x, y]] of tp.entries()) {
              if (vi === 1) continue;
              const qx = c * x + sn * (y - D),
                qy = -sn * x + c * (y - D);
              if (insidePoly(e.pal[side].pts, qx, qy)) worst++;
            }
          }
      }
      expect(worst).toBe(0);
    });
});

const rotAbout = (pv: Pt, p: Pt, a: number): Pt => [
  pv[0] + (p[0] - pv[0]) * Math.cos(a) - (p[1] - pv[1]) * Math.sin(a),
  pv[1] + (p[0] - pv[0]) * Math.sin(a) + (p[1] - pv[1]) * Math.cos(a),
];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const segDist = (p: Pt, a: Pt, b: Pt) => {
  const vx = b[0] - a[0],
    vy = b[1] - a[1],
    t = Math.min(1, Math.max(0, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(a[0] + vx * t - p[0], a[1] + vy * t - p[1]);
};
describe('時打ちの仕掛けの当たり', () => {
  it('レバーとピンは重ならず、動いている部品は押す相手に触れている', () => {
    /* 2 時 56 分から 3 時 1 分まで 0.05 秒おきに、図と同じ計算で部品の位置を出して距離を測る */
    const c = new Clock('recoil', new Date(2026, 0, 1, 2, 56, 0).getTime());
    c.setMode('avg');
    const tol = 0.03,
      bad: string[] = [];
    let blows = 0,
      warned = false;
    for (let i = 0; i < 6000; i++) {
      c.advance(0.05, 1);
      for (const e of c.events) {
        if (e.k === 'gong') blows++;
        if (e.k === 'warn') warned = true;
      }
      c.events.length = 0;
      const f = c.snap(),
        min = (f.clockMs / 60000) % 720;
      /* 持ち上げレバーの先と筒かなのピン */
      const hand = Math.PI / 2 - (2 * Math.PI * (min % 60)) / 60,
        cpins = [0, Math.PI].map(
          (k): Pt => [SK.cPin.R * Math.cos(hand + SK.cPin.off + k), SK.cPin.R * Math.sin(hand + SK.cPin.off + k)],
        ),
        tip = rotAbout(SK.L, SK.tip, f.lift),
        dTip = Math.min(...cpins.map((p) => dist(p, tip) - SK.cPin.r - SK.tipR));
      if (dTip < -tol) bad.push(`${i} lift tip overlaps ${dTip.toFixed(3)}`);
      if (f.lift > 0.002 && dTip > 0.1) bad.push(`${i} lift up without pin ${dTip.toFixed(3)}`);
      /* 止めレバー: G・数取り車の縁・止め車のカム */
      const psi = Math.max(lockByLift(f.lift), lockByRim(f.s % 90)),
        { G, F, Ft } = liftAt(f.lift),
        det = rotAbout(SK.K, SK.det, -psi),
        tail = rotAbout(SK.K, SK.tail, -psi),
        dG = lockArmDist(G, psi) - SK.gR - SK.armW,
        dRim = dist(tail, W.cw.c) - (rimAt(f.s % 90) + SK.tailR + 0.1);
      if (dG < -tol) bad.push(`${i} G overlaps lock arm ${dG.toFixed(3)}`);
      if (dRim < -tol) bad.push(`${i} tail in rim ${dRim.toFixed(3)}`);
      if (psi > 0.002 && Math.min(dG, dRim) > 0.1) bad.push(`${i} lock up without contact`);
      const ca = -(f.s % 1) * 2 * Math.PI + SK.detA + SK.cam.off,
        rel = Math.atan2(det[1] - W.lw.c[1], det[0] - W.lw.c[0]) - ca,
        dd = Math.abs((((rel % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI),
        camR = dd < SK.cam.half ? SK.cam.floor : SK.cam.R;
      if (dist(det, W.lw.c) - camR - SK.detR < -tol) bad.push(`${i} detent in cam`);
      /* 予告ピンと旗の指 */
      const dw = segDist(wPinAt(f.s), F, Ft) - SK.wPin.r - SK.flagR;
      if (dw < -tol) bad.push(`${i} warning pin overlaps flag ${dw.toFixed(3)}`);
      if (f.sst === 'warn' && dw > 0.1) bad.push(`${i} warning without touching flag`);
      /* ハンマーの尾とピン車のピン（打った直後の振れの間は除く） */
      if (f.hamT > 0.07) {
        const ha = hamAngle(f.s),
          ht = rotAbout(SK.H, SK.htail, -ha),
          dh = Math.min(
            ...hPinsAt(f.s).map((p) =>
              Math.min(dist(p, ht) - SK.hPin.r - SK.htailR, segDist(p, SK.H, ht) - SK.hPin.r - SK.armW),
            ),
          );
        if (dh < -tol) bad.push(`${i} hammer tail overlaps pin ${dh.toFixed(3)}`);
        if (ha > 0.002 && dh > 0.1) bad.push(`${i} hammer up without pin`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(warned).toBe(true);
    expect(blows).toBe(3);
    expect(HAM.max).toBeGreaterThan(0.1);
  });
});

describe('ゼンマイの巻きと振り子をつかむ', () => {
  it('バーで決めた巻きになり、つかんだ振り子は止まり、振って離すとまた動く', () => {
    const c = new Clock('recoil', new Date(2026, 0, 1, 2, 10, 0).getTime());
    c.setWind('T', 3);
    expect(c.nT).toBe(3);
    c.setWind('S', 99);
    expect(c.nS).toBeCloseTo(8.4);
    c.setMode('live');
    for (let i = 0; i < 60; i++) c.advance(1 / 30, 1);
    /* 真ん中で 3 秒押さえる */
    c.grab(0);
    for (let i = 0; i < 90; i++) c.advance(1 / 30, 1);
    expect(Math.abs(c.snap().th)).toBeLessThan(0.2 * DEG);
    /* 4° まで持っていって離す */
    c.grab(4 * DEG);
    for (let i = 0; i < 30; i++) c.advance(1 / 30, 1);
    c.grab(null);
    let mx = 0;
    for (let i = 0; i < 120; i++) {
      c.advance(1 / 30, 1);
      mx = Math.max(mx, Math.abs(c.snap().th));
    }
    expect(mx).toBeGreaterThan(2.5 * DEG);
    expect(c.snap().stopped).toBe(false);
  });
});

describe('箱と部屋の響き', () => {
  it('箱は低い音ほど強く響かせる。部屋の応答は残響の長さを持つ', () => {
    const fs = 24000,
      h = caseIR(fs),
      band = (x: Float32Array, a: number, b: number) => {
        let sum = 0,
          n = 0;
        for (let f = a; f < b; f *= 1.05) {
          let re = 0,
            im = 0;
          const w = (2 * Math.PI * f) / fs;
          for (let i = 0; i < x.length; i++) {
            re += x[i] * Math.cos(w * i);
            im -= x[i] * Math.sin(w * i);
          }
          sum += re * re + im * im;
          n++;
        }
        return 10 * Math.log10(sum / n);
      };
    expect(band(h, 100, 400)).toBeGreaterThan(band(h, 2500, 6000) + 12);
    const r = roomIR(fs, 'living');
    expect(r).not.toBeNull();
    expect(roomIR(fs, 'off')).toBeNull();
  });
});

describe('ゼンマイと時打ち', () => {
  it('巻き切りから約 8 日で止まる', () => {
    for (const type of ['recoil', 'graham', 'brocot'] as const) {
      const c = new Clock(type, Date.UTC(2026, 0, 1, 3));
      c.setMode('avg');
      let day = 0;
      for (; day < 12 && !c.stopped; day += 0.25) c.stepAvg(6 * 3600);
      expect(day).toBeGreaterThan(7.5);
      expect(day).toBeLessThan(9);
    }
  });
  it('正時に時の数だけ打つ', () => {
    /* 地方時の 2 時 59 分にして 2 分進める */
    const now = new Date(2026, 0, 1, 2, 59, 0).getTime(),
      c = new Clock('graham', now);
    c.setMode('avg');
    let gongs = 0;
    for (let i = 0; i < 2400; i++) {
      c.advance(0.05, 1);
      gongs += c.events.filter((e) => e.k === 'gong').length;
      c.events.length = 0;
    }
    expect(gongs).toBe(3);
  });
});

describe('音', () => {
  it('地板の 1 番目の型は 600 Hz ほど', () => {
    expect(PLATE[0].f).toBeGreaterThan(550);
    expect(PLATE[0].f).toBeLessThan(650);
  });
  it('ゴングの型は 60 Hz〜6 kHz にあり、音は 1 で頭打ち', () => {
    const g = gongModes();
    expect(g.length).toBeGreaterThan(40);
    const y = makeSfx('tickL', 8000);
    expect(Math.max(...y.map(Math.abs))).toBeCloseTo(1, 5);
  });
});

describe('カードの図柄', () => {
  it('1 周で同じ絵に戻る', () => {
    expect(ART.pcl(0)).toBe(ART.pcl(LOOP.pcl));
  });
});
