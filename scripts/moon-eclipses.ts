/**
 * 月のページの月食の一覧（public/moon/eclipses.json）を、NASA の五千年月食目録から作る。
 *
 *   bun scripts/moon-eclipses.ts [置き場]
 *
 * 置き場（リポジトリの外のディレクトリ。省略すると OS の一時ディレクトリの nanase-tools-moon）に
 * 5MKLEcatalog.txt がなければダウンロードする。1900〜2100 年の月食を、日付の順に 1 件 1 行で書く。
 * 1 件は [年, 月, 日, 食の最大の時刻（TD、0 時からの秒）, ΔT [s], サロス番号, 種類, γ,
 *   半影食分, 本影食分, 半影食の時間, 部分食の時間, 皆既食の時間]。時間は分で、ない食は null。
 * 種類は目録のまま（N・Nx・Nb・Ne・P・T・T+・T-）。
 *
 * 元データ（許諾・出典表記は src/tools/moon/SOURCES.md）: F. Espenak & J. Meeus,
 * Five Millennium Catalog of Lunar Eclipses: −1999 to +3000（NASA/TP-2009-214173）
 * https://eclipse.gsfc.nasa.gov/5MCLE/5MKLEcatalog.txt
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_CAT = 'https://eclipse.gsfc.nasa.gov/5MCLE/5MKLEcatalog.txt';
const OUT = new URL('../public/moon/eclipses.json', import.meta.url);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TYPES = new Set(['N', 'Nx', 'Nb', 'Ne', 'P', 'T', 'T+', 'T-']);

/** 列の型は上のコメントのとおり */
type Row = (number | string | null)[];

const dir = process.argv[2] ?? join(tmpdir(), 'nanase-tools-moon');
mkdirSync(dir, { recursive: true });
const file = join(dir, '5MKLEcatalog.txt');
if (!existsSync(file)) {
  console.log(`${URL_CAT} をダウンロード`);
  const res = await fetch(URL_CAT);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  writeFileSync(file, await res.text());
}

const num = (s: string) => {
  const v = Number(s);
  if (!Number.isFinite(v)) throw new Error(`数ではありません: ${s}`);
  return v;
};
const dur = (s: string) => (s === '-' ? null : num(s));

const rows: Row[] = [];
for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
  if (!/^\d{5} /.test(line)) continue;
  // 番号 年 月 日 時刻 ΔT ルナ番号 サロス 種類 QSE γ 半影食分 本影食分 半影 部分 皆既 緯度 経度
  const f = line.trim().split(/\s+/);
  if (f.length !== 18) throw new Error(`列の数が違います: ${line}`);
  const year = num(f[1]);
  if (year < 1900 || year > 2100) continue;
  const month = MONTHS.indexOf(f[2]) + 1;
  if (!month) throw new Error(`月が読めません: ${line}`);
  const [h, m, s] = f[4].split(':').map(num);
  if (!TYPES.has(f[8])) throw new Error(`種類 ${f[8]} は知りません: ${line}`);
  rows.push([
    year,
    month,
    num(f[3]),
    h * 3600 + m * 60 + s,
    num(f[5]),
    num(f[7]),
    f[8],
    num(f[10]),
    num(f[11]),
    num(f[12]),
    num(f[13]),
    dur(f[14]),
    dur(f[15]),
  ]);
}
const json = `[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`;
writeFileSync(OUT, json);
const count = (t: string) => rows.filter((r) => String(r[6])[0] === t).length;
console.log(
  `${rows.length} 件（皆既 ${count('T')}・部分 ${count('P')}・半影 ${count('N')}）、${Buffer.byteLength(json)} バイト`,
);
