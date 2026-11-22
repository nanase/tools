/**
 * 太陽系のページのデータを作る。画像の変換に ImageMagick（magick）を使う。
 *
 *   bun scripts/solar-data.ts [置き場]
 *
 * 置き場（リポジトリの外のディレクトリ。省略すると OS の一時ディレクトリの nanase-tools-solar）に元のファイルがなければ
 * ダウンロードする。出典と許諾は src/tools/solar/SOURCES.md。
 *
 * - src/tools/solar/vsop.ts: VSOP87D の水星・金星・火星・天王星・海王星の表から、振幅 A × 0.1^p ≥ 3×10⁻⁷ の項だけを残す
 *   （p は τ の次数。1900〜2100 年で |τ| ≤ 0.1。木星・土星のページと同じ基準）
 * - public/solar/mars.webp: Viking の色付きモザイク（経度 −180〜180°）を 512 × 256 にする
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VSOP = 'https://ftp.imcce.fr/pub/ephem/planets/vsop87/VSOP87D.';
const MARS =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Mars_Viking_MDIM21_ClrMosaic_1km.jpg/1280px-Mars_Viking_MDIM21_ClrMosaic_1km.jpg';
const PLANETS = [
  ['mer', 'MERCURY', '水星'],
  ['ven', 'VENUS', '金星'],
  ['mar', 'MARS', '火星'],
  ['ura', 'URANUS', '天王星'],
  ['nep', 'NEPTUNE', '海王星'],
] as const;
const MIN = 3e-7;

const dir = process.argv[2] ?? join(tmpdir(), 'nanase-tools-solar');
mkdirSync(dir, { recursive: true });

async function download(url: string, name: string): Promise<string> {
  const path = join(dir, name);
  if (existsSync(path)) return path;
  const r = await fetch(url, { headers: { 'User-Agent': 'nanase-tools-data/1.0' } });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  writeFileSync(path, Buffer.from(await r.arrayBuffer()));
  return path;
}

/** VSOP87D の 1 惑星を読み、間引いた表と項の数を返す */
function trim(text: string): { tab: Record<string, number[]>; kept: number; all: number } {
  const tab: Record<string, number[]> = {};
  let key = '';
  let p = 0;
  let kept = 0;
  let all = 0;
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/VARIABLE (\d).*\*T\*\*(\d)/);
    if (h) {
      key = 'LBR'[+h[1] - 1] + h[2];
      p = +h[2];
      continue;
    }
    const f = line.trim().split(/\s+/);
    if (!key || f.length < 3) continue;
    const [a, b, c] = f.slice(-3).map(Number);
    all++;
    if (Math.abs(a) * 0.1 ** p < MIN) continue;
    tab[key] ??= [];
    tab[key].push(a, b, c);
    kept++;
  }
  return { tab, kept, all };
}

const num = (v: number): string => (Math.abs(v - Math.PI) < 1e-10 ? 'Math.PI' : String(v));
let ts = `/**
 * 水星・金星・火星・天王星・海王星の日心位置の表（DOM に依存しない）
 *
 * VSOP87D（Bretagnon & Francou 1988、IMCCE の https://ftp.imcce.fr/pub/ephem/planets/vsop87/VSOP87D.*）から、
 * 振幅 A × 0.1^p ≥ 3×10⁻⁷（p は τ の次数）の項だけを scripts/solar-data.ts で残した。表の形は lib/astro/vsop.ts
 */
import type { VsopTable } from '../../lib/astro/vsop';
`;
for (const [ext, name, ja] of PLANETS) {
  const { tab, kept, all } = trim(readFileSync(await download(VSOP + ext, `VSOP87D.${ext}`), 'utf8'));
  console.log(`${ja}: ${all} 項のうち ${kept} 項`);
  ts += `\n/** ${ja}（${all} 項のうち ${kept} 項） */\n// biome-ignore format: 表\nexport const ${name}: VsopTable = {\n`;
  for (const [k, v] of Object.entries(tab)) ts += `  ${k}: [${v.map(num).join(', ')}],\n`;
  ts += '};\n';
}
writeFileSync(fileURLToPath(new URL('../src/tools/solar/vsop.ts', import.meta.url)), ts);

const out = fileURLToPath(new URL('../public/solar/', import.meta.url));
mkdirSync(out, { recursive: true });
const src = await download(MARS, 'mars-1280.jpg');
execFileSync('magick', [src, '-resize', '512x256!', '-quality', '82', join(out, 'mars.webp')]);
console.log('public/solar/mars.webp');
