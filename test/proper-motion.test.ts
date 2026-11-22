import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ltpPole } from '../src/lib/astro/ltp';
import type { Vec3 } from '../src/lib/astro/vec';
import { FIXED } from '../src/tools/proper-motion/fixed';
import type { SkyJson } from '../src/tools/proper-motion/format';
import { angDeg, decode, dirAt, magAt, NOW, speeds } from '../src/tools/proper-motion/model';

const D = Math.PI / 180;
const buf = readFileSync(new URL('../public/proper-motion/stars.bin', import.meta.url));
const S = decode(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const SKY = JSON.parse(readFileSync(new URL('../public/proper-motion/sky.json', import.meta.url), 'utf8')) as SkyJson;
const idx = (nm: string): number => Number(Object.keys(SKY.names).find((k) => SKY.names[k] === nm));
const radec = (v: Vec3): [number, number] => [(Math.atan2(v[1], v[0]) / D + 360) % 360, Math.asin(v[2]) / D];

describe('長期の歳差', () => {
  it('SOFA の iauLtpequ の試験値（−2500 年）に合う', () => {
    const v = ltpPole(-2500);
    expect(v[0]).toBeCloseTo(-0.35866525602373267, 12);
    expect(v[1]).toBeCloseTo(-0.19969789107711286, 12);
    expect(v[2]).toBeCloseTo(0.911855244225082, 12);
  });
  it('J2000 では z 軸', () => {
    const v = ltpPole(2000);
    expect(v[2]).toBeCloseTo(1, 9);
  });
  it('紀元前 2800 年頃はトゥバン、西暦 1 万 4 千年頃はベガのそば', () => {
    const near = (nm: string, y0: number, y1: number) => {
      let best = 99;
      for (let y = y0; y <= y1; y += 100) best = Math.min(best, angDeg(ltpPole(y), dirAt(S, idx(nm), y)));
      return best;
    };
    expect(near('トゥバン', -3500, -2000)).toBeLessThan(0.5);
    expect(near('ベガ', 12000, 16000)).toBeLessThan(6);
    expect(near('ポラリス', 2000, 2200)).toBeLessThan(0.5);
  });
});

describe('星の表', () => {
  it('明るい星の位置と等級', () => {
    const [ra, dec] = radec(dirAt(S, idx('シリウス'), 2000));
    expect(ra).toBeCloseTo(101.287, 1);
    expect(dec).toBeCloseTo(-16.716, 1);
    expect(S.mag[idx('シリウス')]).toBeCloseTo(-1.44, 1);
    expect(S.n).toBeGreaterThan(40000);
  });
  it('アルクトゥルスの固有運動は約 2.28″/年', () => {
    const i = idx('アルクトゥルス');
    expect((angDeg(dirAt(S, i, 2000), dirAt(S, i, 3000)) * 3600) / 1000).toBeCloseTo(2.28, 1);
  });
  it('アルタイルは近づき、横にも動く（視線速度 −26 km/s）', () => {
    const f = FIXED.find((x) => x[0] === 'アルタイル');
    if (!f) throw new Error('アルタイルがない');
    const { vr, vt } = speeds([...f[1]] as Vec3, [...f[2]] as Vec3);
    expect(vr).toBeCloseTo(-26.1, 0);
    expect(vt).toBeGreaterThan(10);
    expect(magAt(S, idx('アルタイル'), NOW + 50000)).toBeLessThan(S.mag[idx('アルタイル')] as number);
  });
  it('リゲルは 10 万年でほとんど動かない', () => {
    const i = idx('リゲル');
    expect(angDeg(dirAt(S, i, NOW), dirAt(S, i, NOW + 100000))).toBeLessThan(0.2);
  });
  it('星座線と星の並びの番号は表の中', () => {
    for (const pls of [...Object.values(SKY.lines), ...Object.values(SKY.aster)])
      for (const pl of pls) for (const i of pl) expect(i).toBeLessThan(S.n);
    expect(SKY.cons).toHaveLength(88);
  });
});
