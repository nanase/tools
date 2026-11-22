import { describe, expect, it } from 'vitest';
import { ART } from '../src/lib/card-art';
import { diamAt, distance, IDS, type Id, look, MAX_DIAM, nextClosest } from '../src/tools/solar/model';
import { STEPS } from '../src/tools/solar/steps';

/**
 * JPL Horizons（2026-11-22 取得）の地心の値: 惑星、日時（UT の JD）、照らされた割合 [%]、視直径 [″]、距離 [au]
 */
// biome-ignore format: 表
const HZ: [Id, number, number, number, number][] = [
  ['me', 2461366.5, 63.81072, 6.56021, 1.02587896640583],
  ['ve', 2461366.5, 19.8749, 45.2167, 0.36907565015302],
  ['ma', 2461456.5, 99.94604, 13.81478, 0.67791881744057],
  ['ur', 2461366.5, 99.99966, 3.820845, 18.4465075764579],
  ['ne', 2461366.5, 99.98038, 2.327407, 29.3412175786525],
  ['ve', 2461337.5, 0.61663, 61.13679, 0.27296796847035],
  ['ma', 2452878.5, 99.80129, 25.1262, 0.37273052028265],
];
const jdOf = (iso: string) => Date.parse(iso) / 86400000 + 2440587.5;

describe('太陽系', () => {
  it('大きさ・欠け・距離が Horizons と合う', () => {
    for (const [id, jd, ill, diam, delta] of HZ) {
      const L = look(id, jd);
      expect(L.diam / diam - 1, `${id} ${jd}`).toBeCloseTo(0, 3);
      expect(L.illum * 100 - ill, `${id} ${jd}`).toBeLessThan(0.2);
      expect(Math.abs(L.delta / delta - 1), `${id} ${jd}`).toBeLessThan(1e-5);
    }
  });

  it('1900〜2100 年の最大の大きさは表の値に収まる', () => {
    for (const id of IDS) {
      let m = 0;
      for (let jd = 2415020.5; jd < 2488069.5; jd += id === 'me' || id === 've' ? 1 : 3)
        m = Math.max(m, diamAt(id, distance(id, jd)));
      expect(m, id).toBeLessThanOrEqual(MAX_DIAM[id]);
      expect(m, id).toBeGreaterThan(MAX_DIAM[id] * 0.98);
    }
  }, 30000);

  it('次の最接近: 2003 年の火星の大接近', () => {
    const t = nextClosest('ma', jdOf('2003-07-01T00:00Z'));
    expect(Math.abs(t - jdOf('2003-08-27T09:51Z'))).toBeLessThan(0.5);
  });

  it('次の最接近は今より後で、そこで距離が極小になる', () => {
    const now = jdOf('2026-11-22T00:00Z');
    for (const id of IDS) {
      const t = nextClosest(id, now);
      expect(t, id).toBeGreaterThan(now);
      expect(distance(id, t), id).toBeLessThan(distance(id, t - 1));
      expect(distance(id, t), id).toBeLessThan(distance(id, t + 1));
    }
  });

  it('夜空での見え方', () => {
    // 2026-01-10 は木星の衝、2026-12 の金星は明けの明星
    expect(look('ju', jdOf('2026-01-10T00:00Z')).sky).toBe('al');
    expect(look('ve', jdOf('2026-12-15T00:00Z')).sky).toBe('mo');
    // 2026-10-24 は金星の内合（太陽の近く）
    expect(look('ve', jdOf('2026-10-24T00:00Z')).sky).toBe('no');
  });

  it('しくみの工程とカードの図柄がある', () => {
    expect(STEPS.length).toBe(4);
    expect(ART.ss(0)).toMatch(/<circle/);
  });
});
