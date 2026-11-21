import { describe, expect, it } from 'vitest';
import { type Computed, encodeNormal, heightMap, normalize, normalMap, PATS } from '../src/tools/normal-map/heights';
import { imagePattern, MATS, matAt, materialMap } from '../src/tools/normal-map/materials';
import { EL, HS } from '../src/tools/normal-map/params';
import { camera, fitCamera, LIGHT_Y, pickLight, project, type Vec3 } from '../src/tools/normal-map/render';
import { STEPS } from '../src/tools/normal-map/steps';
import { applyView, HOME, wrapAz, ZOOM_MAX, zoomAt } from '../src/tools/normal-map/view';

const R = 64;
const ids = PATS.map(([k]) => k).filter((k): k is Computed => k !== 'text' && k !== 'image');

describe('模様の高さ', () => {
  it('模様の id と名前は重ならない', () => {
    expect(new Set(PATS.map((p) => p[0])).size).toBe(PATS.length);
    expect(new Set(PATS.map((p) => p[1])).size).toBe(PATS.length);
  });

  it('どの模様も 0〜1 に収まり、平らでない', () => {
    for (const id of ids) {
      const h = heightMap(id, R);
      let lo = 1,
        hi = 0;
      for (const v of h) {
        expect(Number.isFinite(v), id).toBe(true);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      expect(lo, id).toBeCloseTo(0, 6);
      expect(hi, id).toBeCloseTo(1, 6);
    }
  });

  it('同じ模様は何度作っても同じ', () => {
    for (const id of ['cobble', 'crater', 'maze', 'pcb'] as const) expect(heightMap(id, R)).toEqual(heightMap(id, R));
  });

  it('平らな高さは 0 にそろえる', () => {
    expect([...normalize(new Float32Array([0.3, 0.3]))]).toEqual([0, 0]);
  });
});

describe('法線マップ', () => {
  const at = (nm: Uint8Array, i: number, j: number) => [...nm.slice((j * R + i) * 4, (j * R + i) * 4 + 3)];

  it('真上を向いた所は (128, 128, 255)', () => {
    expect(encodeNormal(0, 0)).toEqual([128, 128, 255]);
    const nm = normalMap(new Float32Array(R * R), R);
    expect(at(nm, 10, 20)).toEqual([128, 128, 255]);
  });

  it('右へ上る坂は左を向くので赤が減る', () => {
    const h = new Float32Array(R * R);
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) h[j * R + i] = i / 8;
    const [r, g, b] = at(normalMap(h, R), 30, 30);
    expect(r).toBeLessThan(128);
    expect(g).toBe(128);
    expect(b).toBeLessThan(255);
  });

  it('手前（画像の下）へ上る坂は奥（画像の上）を向くので緑が増える', () => {
    const h = new Float32Array(R * R);
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) h[j * R + i] = j / R;
    const [r, g] = at(normalMap(h, R), 30, 30);
    expect(r).toBe(128);
    expect(g).toBeGreaterThan(128);
  });

  it('色を向きに戻すと長さはほぼ 1', () => {
    const nm = normalMap(heightMap('rivet', R), R);
    for (let k = 0; k < R * R; k += 37) {
      const v = [nm[k * 4], nm[k * 4 + 1], nm[k * 4 + 2]].map((c) => (c / 255) * 2 - 1);
      expect(Math.hypot(...v)).toBeCloseTo(1, 1);
      expect(nm[k * 4 + 2]).toBeGreaterThan(128);
    }
  });
});

describe('カメラ', () => {
  const corners: Vec3[] = [];
  for (const x of [-1, 1]) for (const z of [-1, 1]) for (const y of [-0.06, 0.08]) corners.push([x, y, z]);

  it('どの角度と縦横比でも板が画面に収まり、真ん中に来る', () => {
    for (const el of [EL.min, 30, EL.v, 70, EL.max])
      for (const asp of [4 / 3, 16 / 10, 1, 0.75]) {
        const c = fitCamera(el, asp),
          ps = corners.map((p) => project(c, p)),
          xs = ps.map((p) => p[0] - c.ox),
          ys = ps.map((p) => p[1] - c.oy);
        for (const x of xs) expect(Math.abs(x)).toBeLessThanOrEqual(asp * 0.9 + 1e-6);
        for (const y of ys) expect(Math.abs(y)).toBeLessThanOrEqual(0.9 + 1e-6);
        /* 縦か横のどちらかは余白いっぱいまで使う */
        const fill = Math.max((Math.max(...xs) - Math.min(...xs)) / 2 / asp, (Math.max(...ys) - Math.min(...ys)) / 2);
        expect(fill, `${el} ${asp}`).toBeCloseTo(0.9, 3);
        expect(Math.max(...xs) + Math.min(...xs)).toBeCloseTo(0, 6);
        expect(Math.max(...ys) + Math.min(...ys)).toBeCloseTo(0, 6);
      }
  });

  it('指した点を通る光線が、光の高さの面と交わる所に光を置く', () => {
    const asp = 16 / 10,
      c = fitCamera(50, asp);
    for (const [x, y] of [
      [0, 0],
      [0.3, -0.4],
      [-0.5, 0.2],
    ]) {
      const p = pickLight(c, x, y, asp);
      expect(p).not.toBeNull();
      const q = p as Vec3;
      expect(q[1]).toBe(LIGHT_Y);
      const [px, py] = project(c, q);
      expect(px).toBeCloseTo(x * asp + c.ox, 6);
      expect(py).toBeCloseTo(y + c.oy, 6);
    }
  });

  it('光の高さの面より上を指したときは置かない', () => {
    const c = camera(10, 4);
    expect(pickLight(c, 0, 0.99, 1)).toBeNull();
  });
});

describe('入力', () => {
  it('凹凸の高さは 0 から 2 倍、既定は 1 倍', () => {
    expect([HS.min, HS.v, HS.max]).toEqual([0, 1, 2]);
    expect(HS.fix?.(3)?.[0]).toBe(2);
  });
});

describe('しくみ', () => {
  it('5 工程で、文に句点を付けない', () => {
    expect(STEPS).toHaveLength(5);
    for (const s of STEPS) {
      expect(s.h.includes('。'), s.h).toBe(false);
      expect(s.p.includes('。'), s.p).toBe(false);
    }
  });
});

describe('色とつや', () => {
  it('画像のほかのどの模様にも色とつやがあり、段は高さの順', () => {
    for (const [id] of PATS) {
      if (id === 'image') continue;
      const m = MATS[id];
      expect(m, id).toBeDefined();
      for (let k = 1; k < m.stops.length; k++) expect(m.stops[k][0], id).toBeGreaterThanOrEqual(m.stops[k - 1][0]);
      for (const [, c, r] of m.stops) {
        for (const v of c) expect(v >= 0 && v <= 255, id).toBe(true);
        expect(r >= 0 && r <= 1, id).toBe(true);
      }
    }
  });

  it('段の間は直線で混ぜ、端の外は端の値', () => {
    const m = {
      stops: [
        [0, [0, 0, 0], 0],
        [1, [200, 100, 50], 1],
      ] as const,
      vary: 0,
    };
    expect(matAt(m, 0.5)).toEqual([100, 50, 25, 0.5]);
    expect(matAt(m, -1)).toEqual([0, 0, 0, 0]);
    expect(matAt(m, 2)).toEqual([200, 100, 50, 1]);
  });

  it('色とつやの画像は RGBA で、A が粗さ', () => {
    const h = heightMap('brick', R),
      c = materialMap('brick', h, R);
    expect(c).toHaveLength(R * R * 4);
    /* 目地（低い所）はざらざら、レンガ（高い所）はそれより滑らか */
    let lo = 0,
      hi = 0,
      nl = 0,
      nh = 0;
    for (let k = 0; k < R * R; k++)
      if (h[k] < 0.1) {
        lo += c[k * 4 + 3];
        nl++;
      } else if (h[k] > 0.9) {
        hi += c[k * 4 + 3];
        nh++;
      }
    expect(lo / nl).toBeGreaterThan(hi / nh);
  });
});

describe('画像の模様', () => {
  /* 左半分が白、右半分が黒の画像 */
  const px = new Uint8Array(R * R * 4);
  for (let j = 0; j < R; j++)
    for (let i = 0; i < R; i++) {
      const v = i < R / 2 ? 255 : 0;
      px.set([v, v, v, 255], (j * R + i) * 4);
    }

  it('明るい所ほど高い。暗い所を高くすると逆になる', () => {
    const a = imagePattern(px, false, R).h,
      b = imagePattern(px, true, R).h;
    expect(a[10 * R + 5]).toBeCloseTo(1, 6);
    expect(a[10 * R + R - 5]).toBeCloseTo(0, 6);
    expect(b[10 * R + 5]).toBeCloseTo(0, 6);
    expect(b[10 * R + R - 5]).toBeCloseTo(1, 6);
  });

  it('色は画像の色をそのまま使う', () => {
    const { col } = imagePattern(px, false, R);
    expect([...col.slice(0, 3)]).toEqual([255, 255, 255]);
    expect([...col.slice((R - 1) * 4, (R - 1) * 4 + 3)]).toEqual([0, 0, 0]);
  });
});

describe('拡大と回転', () => {
  const asp = 16 / 10;

  it('拡大してもカーソルの下の点は動かない', () => {
    const base = fitCamera(50, asp);
    for (const [sx, sy] of [
      [0, 0],
      [0.7, -0.3],
      [-1.2, 0.6],
    ]) {
      const v = zoomAt(HOME, sx, sy, 2, asp),
        a = applyView(base, HOME),
        b = applyView(base, v);
      /* 同じ光線の向きになる: (画面の点 + ずれ) × 画角 */
      expect((sx + b.ox) * b.th).toBeCloseTo((sx + a.ox) * a.th, 9);
      expect((sy + b.oy) * b.th).toBeCloseTo((sy + a.oy) * a.th, 9);
      expect(v.z).toBe(2);
    }
  });

  it('拡大率は 1〜8 倍で、写る範囲は拡大前の画面の外へ出ない', () => {
    let v = { ...HOME };
    for (let k = 0; k < 20; k++) v = zoomAt(v, asp, 1, 1.5, asp);
    expect(v.z).toBe(ZOOM_MAX);
    expect(v.cx + asp / v.z).toBeLessThanOrEqual(asp + 1e-9);
    expect(v.cy + 1 / v.z).toBeLessThanOrEqual(1 + 1e-9);
    v = zoomAt(v, 0, 0, 1e-3, asp);
    expect(v).toEqual({ ...HOME, cx: 0, cy: 0 });
  });

  it('方位は −180〜180° に収める', () => {
    expect(wrapAz(190)).toBe(-170);
    expect(wrapAz(-190)).toBe(170);
    expect(wrapAz(20)).toBe(20);
  });

  it('どの方位でも板が収まる', () => {
    for (const az of [-150, -60, 0, 45, 120]) expect(fitCamera(50, asp, az).cp[1]).toBeGreaterThan(0);
  });
});
