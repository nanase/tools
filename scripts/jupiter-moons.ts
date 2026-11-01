/**
 * 木星のページの「すべての衛星」のデータ（public/jupiter/moons.json）を作る。
 *
 *   bun scripts/jupiter-moons.ts [置き場]
 *
 * 置き場（リポジトリの外のディレクトリ。省略すると OS の一時ディレクトリの nanase-tools-jupiter）に
 * 取得した状態ベクトルを残し、なければ JPL Horizons から取る。
 *
 * - 外側の衛星: 2015-01-01 から 90 日おきの木星中心の状態（ICRF、km と km/日）を持つ。位置は 100 km、速度は 10 km/日 に丸める。
 *   間は両端の状態から 2 体で進めて混ぜる（src/lib/planet/moons.ts）
 * - 内側の 4 個（メティス・アドラステア・アマルテア・テーベ）: 周期が短く 2 体では追えないので、
 *   木星の赤道の面の円軌道（半径と平均運動）を当てはめ、値を表示する。src/tools/jupiter/model.ts の INNER に写す
 * - 名前と群: ウィキペディア日本語版「木星の衛星」の一覧（版を固定）。一覧にない衛星の群は軌道から決める
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pole } from '../src/tools/jupiter/model';

const HZ = 'https://ssd.jpl.nasa.gov/api/horizons.api?';
const WIKI =
  'https://ja.wikipedia.org/w/index.php?title=%E6%9C%A8%E6%98%9F%E3%81%AE%E8%A1%9B%E6%98%9F&action=raw&oldid=109799938';
const OUT = new URL('../public/jupiter/moons.json', import.meta.url);

/** 取得する時点: 2015-01-01 から 45 日おき（内側の当てはめに使う）。外側は 1 つおきに持つ */
const J0 = 2457023.5;
const STEP = 45;
const COUNT = 209;
/** 外側の衛星のデータの終わり（2037 年の初めまで） */
const KNOTS = 90;

const GROUPS = [
  'アマルテア群',
  'ガリレオ衛星',
  'ヒマリア群',
  'そのほかの順行',
  'アナンケ群',
  'カルメ群',
  'パシファエ群',
];
const INNER = ['516', '515', '505', '514'];
const GALILEAN = ['501', '502', '503', '504'];

const dir = process.argv[2] ?? join(tmpdir(), 'nanase-tools-jupiter');
mkdirSync(dir, { recursive: true });

const query = (p: Record<string, string>) =>
  HZ +
  new URLSearchParams({
    format: 'text',
    MAKE_EPHEM: 'YES',
    OBJ_DATA: 'NO',
    ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, `'${v}'`])),
  });

async function cached(name: string, make: () => Promise<string>): Promise<string> {
  const f = join(dir, name);
  if (existsSync(f)) return readFileSync(f, 'utf8');
  const s = await make();
  writeFileSync(f, s);
  return s;
}

/** 衛星の状態の列（JD, x, y, z, vx, vy, vz） */
async function states(id: string): Promise<number[][]> {
  const s = await cached(`moon-${id}.json`, async () => {
    const jds = Array.from({ length: COUNT }, (_, k) => J0 + STEP * k);
    const rows: number[][] = [];
    for (let a = 0; a < jds.length; a += 50) {
      const r = await fetch(
        query({
          COMMAND: id,
          EPHEM_TYPE: 'VECTORS',
          CENTER: '500@599',
          TLIST: jds
            .slice(a, a + 50)
            .map((j) => j.toFixed(1))
            .join(' '),
          TLIST_TYPE: 'JD',
          REF_SYSTEM: 'ICRF',
          REF_PLANE: 'FRAME',
          OUT_UNITS: 'KM-D',
          VEC_TABLE: '2',
          VEC_CORR: 'NONE',
          CSV_FORMAT: 'YES',
        }),
      );
      const t = await r.text();
      if (!t.includes('$$SOE')) throw new Error(`${id}: ${t.slice(-300)}`);
      for (const l of t.split('$$SOE')[1].split('$$EOE')[0].trim().split('\n')) {
        const f = l.split(',').map((x) => x.trim());
        rows.push([Number(f[0]), ...f.slice(2, 8).map(Number)]);
      }
    }
    return JSON.stringify(rows);
  });
  return JSON.parse(s);
}

/* ---------- 衛星の一覧 ---------- */
const mb = await cached('mb.txt', async () => (await fetch(`${HZ}format=text&COMMAND=%27MB%27`)).text());
const rows = mb
  .split('\n')
  .filter((l) => /^\s*(5\d\d|55\d{3})\s/.test(l) && l.trim().split(/\s+/)[0] !== '599')
  .map((l) => {
    const id = l.trim().split(/\s+/)[0];
    const m = /S(\d{4})_J(\d+)/.exec(l);
    return { id, des: m ? `S/${m[1]} J ${m[2]}` : '' };
  });

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50 };
const roman = (s: string) => {
  let v = 0;
  for (let i = 0; i < s.length; i++) {
    const a = ROMAN[s[i]],
      b = ROMAN[s[i + 1]] ?? 0;
    v += a < b ? -a : a;
  }
  return v;
};

const wiki = await cached('wiki.txt', async () =>
  (await fetch(WIKI, { headers: { 'User-Agent': 'nanase-tools' } })).text(),
);
/** ウィキペディアの一覧: 木星の番号または仮符号 → [名前, 直径 [km], 群] */
const WIKI_G: Record<string, number> = {
  アマルテア群: 0,
  ガリレオ衛星: 1,
  ヒマリア群: 2,
  アナンケ群: 4,
  カルメ群: 5,
  パシファエ群: 6,
};
const byNum = new Map<number, [string, number, number]>();
const byDes = new Map<string, [string, number, number]>();
for (const l of wiki.split('\n')) {
  if (!/^\| \d+ \|\|/.test(l)) continue;
  const c = l.split('||').map((x) => x.trim());
  const name = /\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/.exec(c[2])?.[1] ?? '';
  const num = /\{\{sort\|\d+\|([IVXL]+)\}\}/.exec(c[1])?.[1];
  const gt = c[c.length - 1];
  const g = Object.entries(WIKI_G).find(([k]) => gt.includes(k))?.[1] ?? (gt.includes('ガリレオ') ? 1 : 3);
  const size = Number.parseFloat(c[3]) || 1;
  const e: [string, number, number] = [name, size, g];
  if (name.startsWith('S/')) byDes.set(name, e);
  else if (num) byNum.set(roman(num), e);
}

/* ---------- 平均の軌道（群を決める） ---------- */
const GM = 126686531.9 * 86400 ** 2;
const E = (23.4393 * Math.PI) / 180;
function meanOrbit(st: number[][]): { a: number; i: number } {
  let sa = 0,
    si = 0;
  for (const [, x, y, z, vx, vy, vz] of st) {
    const r = Math.hypot(x, y, z);
    sa += 1 / (2 / r - (vx * vx + vy * vy + vz * vz) / GM);
    const hx = y * vz - z * vy,
      hy = z * vx - x * vz,
      hz = x * vy - y * vx;
    /* 黄道の北極に対する傾き */
    const c = (-Math.sin(E) * hy + Math.cos(E) * hz) / Math.hypot(hx, hy, hz);
    si += (Math.acos(c) * 180) / Math.PI;
  }
  return { a: sa / st.length, i: si / st.length };
}
function groupOf(a: number, i: number): number {
  if (i < 90) return a < 13e6 ? 2 : 3;
  if (i > 160) return 5;
  return a < 22.2e6 ? 4 : 6;
}

/* ---------- 内側の 4 個: 円軌道の当てはめ ---------- */
const [ra, dec] = pole(0.27).map((v) => (v * Math.PI) / 180);
const z = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
const q = [-Math.sin(ra), Math.cos(ra), 0];
const e = [z[1] * q[2] - z[2] * q[1], z[2] * q[0] - z[0] * q[2], z[0] * q[1] - z[1] * q[0]];
const dot3 = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
for (const id of INNER) {
  const st = await states(id);
  const th = st.map((s) => Math.atan2(dot3(s.slice(1, 4), e), dot3(s.slice(1, 4), q)));
  const ds = st.map((s) => s[0] - 2451545);
  const a = st.reduce((v, s) => v + Math.hypot(s[1], s[2], s[3]), 0) / st.length;
  const n0 =
    st.reduce((v, s) => {
      const [, x, y, zz, vx, vy, vz] = s;
      return v + Math.hypot(y * vz - zz * vy, zz * vx - x * vz, x * vy - y * vx) / (x * x + y * y + zz * zz);
    }, 0) / st.length;
  /* 位相がそろう平均運動を探す（45 日おきなので ±4°/日 の中で 1 つに決まる） */
  let best = 0,
    bn = n0,
    bp = 0;
  const scan = (c: number, w: number, dn: number) => {
    for (let n = c - w; n <= c + w; n += dn) {
      let sx = 0,
        sy = 0;
      for (let k = 0; k < th.length; k++) {
        const p = th[k] - n * ds[k];
        sx += Math.cos(p);
        sy += Math.sin(p);
      }
      const v = Math.hypot(sx, sy);
      if (v > best) {
        best = v;
        bn = n;
        bp = Math.atan2(sy, sx);
      }
    }
  };
  scan(n0, (4 * Math.PI) / 180, 1e-4);
  scan(bn, 2e-4, 1e-7);
  scan(bn, 2e-7, 1e-10);
  let mx = 0;
  for (let k = 0; k < th.length; k++) {
    const p = bp + bn * ds[k];
    const w = st[k].slice(1, 4);
    const m = [0, 1, 2].map((i) => a * (Math.cos(p) * q[i] + Math.sin(p) * e[i]));
    mx = Math.max(mx, Math.hypot(m[0] - w[0], m[1] - w[1], m[2] - w[2]));
  }
  console.log(
    `${id} a=${a.toFixed(0)} λ0=${((bp * 180) / Math.PI).toFixed(4)} n=${((bn * 180) / Math.PI).toFixed(7)} 位相の揃い=${(best / th.length).toFixed(3)} 最大の差=${mx.toFixed(0)} km`,
  );
}

/* ---------- 外側の衛星 ---------- */
const moons: { n: string; g: number; d: number; s: number[] }[] = [];
const disagree: string[] = [];
for (const { id, des } of rows) {
  if (INNER.includes(id) || GALILEAN.includes(id)) continue;
  const st = await states(id);
  const num = Number(id) < 600 ? Number(id) - 500 : 0;
  const w = (des && byDes.get(des)) || (num ? byNum.get(num) : undefined);
  const name = w?.[0] ?? des ?? id;
  const o = meanOrbit(st);
  const og = groupOf(o.a, o.i);
  if (w && w[2] !== og) disagree.push(`${name}: 一覧 ${GROUPS[w[2]]}・軌道 ${GROUPS[og]}`);
  const s: number[] = [];
  for (let k = 0; k < KNOTS; k++) {
    const [, x, y, zz, vx, vy, vz] = st[2 * k];
    s.push(
      Math.round(x / 100),
      Math.round(y / 100),
      Math.round(zz / 100),
      Math.round(vx / 10),
      Math.round(vy / 10),
      Math.round(vz / 10),
    );
  }
  moons.push({ n: name, g: w?.[2] ?? og, d: w?.[1] ?? 1, s });
  if (!w) console.log(`一覧にない: ${name} a=${(o.a / 1e6).toFixed(1)}M i=${o.i.toFixed(0)} → ${GROUPS[og]}`);
}
/* 名前を出す順: 大きな衛星から */
moons.sort((a, b) => b.d - a.d);
console.log(disagree.length ? `群の違い:\n${disagree.join('\n')}` : '群の違いなし');
writeFileSync(OUT, JSON.stringify({ t0: J0, dt: 2 * STEP, n: KNOTS, groups: GROUPS, moons }));
console.log(`moons.json: ${moons.length} 個、${Math.round(readFileSync(OUT).length / 1024)} KB`);
