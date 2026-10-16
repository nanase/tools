/**
 * 日食のページの陸地のデータを作る: Natural Earth の陸地（GeoJSON）を、
 * [経度×100, 緯度×100, …] の整数の並び（輪郭ごと）にして public/solar-eclipse/ へ書く。
 *
 *   bun scripts/solar-eclipse-land.ts <ne_110m_land.geojson> <ne_50m_land.geojson>
 *
 * 元データ: Natural Earth 1:110m・1:50m Physical Vectors の Land（パブリックドメイン）
 * https://www.naturalearthdata.com/downloads/
 */
import { readFileSync, writeFileSync } from 'node:fs';

interface Geo {
  features: { geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] } }[];
}

function rings(file: string): number[][] {
  const g = JSON.parse(readFileSync(file, 'utf8')) as Geo;
  const out: number[][] = [];
  for (const f of g.features) {
    const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][];
    for (const poly of polys)
      for (const ring of poly) out.push(ring.flatMap((c) => [Math.round(c[0] * 100), Math.round(c[1] * 100)]));
  }
  return out;
}

const [f110, f50] = process.argv.slice(2);
if (!f110 || !f50) {
  console.error('使い方: bun scripts/solar-eclipse-land.ts <ne_110m_land.geojson> <ne_50m_land.geojson>');
  process.exit(1);
}
writeFileSync('public/solar-eclipse/land110.json', JSON.stringify(rings(f110)));
writeFileSync('public/solar-eclipse/land50.json', JSON.stringify(rings(f50)));
