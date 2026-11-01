/**
 * 土星のページの「すべての衛星」のデータ（public/saturn/moons.json と src/tools/saturn/phoebe.ts）を作る。
 *
 *   bun scripts/saturn-moons.ts [置き場]
 *
 * 置き場（リポジトリの外のディレクトリ。省略すると OS の一時ディレクトリの nanase-tools-saturn）に
 * 取得した状態ベクトルを残し、なければ JPL Horizons から取る。
 *
 * - 外側の衛星: 2015-01-01 から 180 日おきの土星中心の状態（ICRF、km と km/日）を持つ。位置は 100 km、速度は 10 km/日 に丸める。
 *   間は両端の状態から 2 体で進めて混ぜる（src/lib/planet/moons.ts）。取得は 90 日おきで、間の時点で差を測って表示する
 * - 環のすぐ外の 15 個: 周期が短く 2 体では追えないので、土星の赤道の面の円軌道（半径と平均運動）を当てはめ、値を表示する。
 *   src/tools/saturn/model.ts の INNER に写す
 * - フェーベ: 軌道の図で 1900〜2100 年に出すので、1460 日おきの状態を src/tools/saturn/phoebe.ts に書く
 * - 名前と群: ウィキペディア日本語版「土星の衛星」の一覧（版を固定）。一覧にない衛星の群は軌道から決める
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tablePos } from '../src/lib/planet/moons';
import { pole } from '../src/tools/saturn/model';

const HZ = 'https://ssd.jpl.nasa.gov/api/horizons.api?';
const WIKI =
  'https://ja.wikipedia.org/w/index.php?title=%E5%9C%9F%E6%98%9F%E3%81%AE%E8%A1%9B%E6%98%9F&action=raw&oldid=111388335';
const OUT = new URL('../public/saturn/moons.json', import.meta.url);
const OUT_PH = new URL('../src/tools/saturn/phoebe.ts', import.meta.url);

/** 取得する時点: 2015-01-01 から 90 日おき。表には 1 つおきに持つ */
const J0 = 2457023.5;
const STEP = 90;
const KNOTS = 45;
const COUNT = 2 * KNOTS - 1;
/** 環のすぐ外の衛星は 45 日おきで当てはめる */
const STEP_IN = 45;
const COUNT_IN = 209;
/** フェーベの表: 1900-01-01 から 1460 日おき */
const PH_J0 = 2415020.5;
const PH_STEP = 1460;
const PH_N = 51;

const GROUPS = ['環のすぐ外', '主な衛星', 'イヌイット群', 'ガリア群', '北欧群'];
const MAIN = ['601', '602', '603', '604', '605', '606', '607', '608'];
/** 環のすぐ外の衛星（土星に近い順） */
const INNER = ['618', '635', '615', '616', '617', '611', '610', '653', '632', '649', '633', '612', '613', '614', '634'];
/** 土星の重力定数 [km³/日²]（JPL の SAT441） */
const GM = 37931206.2 * 86400 ** 2;

const dir = process.argv[2] ?? join(tmpdir(), 'nanase-tools-saturn');
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
async function states(id: string, tag: string, jds: number[]): Promise<number[][]> {
  const s = await cached(`moon-${id}-${tag}.json`, async () => {
    const rows: number[][] = [];
    let list = jds;
    for (let a = 0; a < list.length; a += 50) {
      const r = await fetch(
        query({
          COMMAND: id,
          EPHEM_TYPE: 'VECTORS',
          CENTER: '500@699',
          TLIST: list
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
      /* 暦の範囲が短い衛星は、範囲の中だけ取る */
      const lim = /No ephemeris for target .* (after|prior to) A\.D\. (\d+)-([A-Z]{3})-(\d+)/.exec(t);
      if (lim) {
        const edge = Date.parse(`${lim[3]} ${lim[4]} ${lim[2]} UTC`) / 86400000 + 2440587.5;
        list = list.filter((j) => (lim[1] === 'after' ? j < edge : j > edge));
        rows.length = 0;
        a = -50;
        console.log(`${id}: 暦は ${lim[2]}-${lim[3]}-${lim[4]} ${lim[1] === 'after' ? 'まで' : 'から'}`);
        continue;
      }
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
const seq = (j0: number, step: number, n: number) => Array.from({ length: n }, (_, k) => j0 + step * k);

/* ---------- 衛星の一覧 ---------- */
const mb = await cached('mb.txt', async () => (await fetch(`${HZ}format=text&COMMAND=%27MB%27`)).text());
const rows = mb
  .split('\n')
  .filter((l) => /^\s*(6\d\d|65\d{3})\s/.test(l) && l.trim().split(/\s+/)[0] !== '699')
  .map((l) => {
    const id = l.trim().split(/\s+/)[0];
    const m = /S(\d{4})_S(\d+)/.exec(l);
    return { id, des: m ? `S/${m[1]} S ${Number(m[2])}` : '' };
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
/** ウィキペディアの一覧: 土星の番号または仮符号 → [名前, 直径 [km], 群] */
type Row = [string, number, number];
const byNum = new Map<number, Row>();
const byDes = new Map<string, Row>();
for (const l of wiki.split('\n')) {
  if (!/^\| \{\{sort\|/.test(l)) continue;
  const c = l.split('||').map((x) => x.trim());
  if (c.length < 8) continue;
  const name = /\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/.exec(c[1])?.[1] ?? '';
  if (!name) continue;
  const num = /\{\{sort\|\d+\|([IVXL]+)\}\}/.exec(c[0])?.[1];
  const g = l.includes('北欧群') ? 4 : l.includes('ガリア群') ? 3 : l.includes('イヌイット群') ? 2 : -1;
  const size = Number.parseFloat(/\{\{sort\|([\d.]+)/.exec(c[4])?.[1] ?? c[4].replace(/[≈\s]/g, '')) || 1;
  const e: Row = [name.replace(/ \(衛星\)$/, ''), size, g];
  if (name.startsWith('S/')) byDes.set(name, e);
  else if (num) byNum.set(roman(num), e);
}

/* ---------- 平均の軌道（群を決める） ---------- */
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
function groupOf(i: number): number {
  if (i > 90) return 4;
  return i < 40 ? 3 : 2;
}

/* ---------- 環のすぐ外の 15 個: 円軌道の当てはめ ---------- */
const [ra, dec] = pole(0.27).map((v) => (v * Math.PI) / 180);
const z = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
const q = [-Math.sin(ra), Math.cos(ra), 0];
const e = [z[1] * q[2] - z[2] * q[1], z[2] * q[0] - z[0] * q[2], z[0] * q[1] - z[1] * q[0]];
const dot3 = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const namesOf = (id: string) => byNum.get(Number(id) - 600);
const innerLines: string[] = [];
for (const id of INNER) {
  const st = await states(id, 'in', seq(J0, STEP_IN, COUNT_IN));
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
  /*
   * 経度の残りをつないでから、定数・傾き・正弦波を当てはめる（ヤヌスとエピメテウスの入れ替わり、トロヤ衛星の秤動など）。
   * ヤヌスとエピメテウスは折れ線に近い形なので 3 倍の周期の項も足す
   */
  const res: number[] = [];
  th.forEach((v, k) => {
    const raw = v - bp - bn * ds[k];
    const prev = k ? res[k - 1] : 0;
    res.push(raw - 2 * Math.PI * Math.round((raw - prev) / (2 * Math.PI)));
  });
  const three = id === '610' || id === '611';
  const basis = (t: number, per: number) => {
    const om = (2 * Math.PI) / per;
    const b0 = [1, t / 1e4, Math.cos(om * t), Math.sin(om * t)];
    return three ? [...b0, Math.cos(3 * om * t), Math.sin(3 * om * t)] : b0;
  };
  let fit = { err: Number.POSITIVE_INFINITY, c: [] as number[], per: 1000 };
  for (let per = three ? 2500 : 100; per < (three ? 3400 : 5000); per *= 1.002) {
    const n = three ? 6 : 4;
    const A = Array.from({ length: n }, () => new Array(n + 1).fill(0) as number[]);
    ds.forEach((t, k) => {
      const v = basis(t, per);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) A[i][j] += v[i] * v[j];
        A[i][n] += v[i] * res[k];
      }
    });
    for (let i = 0; i < n; i++) {
      let pv = i;
      for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[pv][i])) pv = r;
      [A[i], A[pv]] = [A[pv], A[i]];
      for (let r = 0; r < n; r++) {
        if (r === i) continue;
        const f = A[r][i] / A[i][i];
        for (let c = i; c <= n; c++) A[r][c] -= f * A[i][c];
      }
    }
    const c = A.map((row, i) => row[n] / row[i]);
    let err = 0;
    ds.forEach((t, k) => {
      const v = basis(t, per);
      err += (res[k] - v.reduce((z, x, i) => z + x * c[i], 0)) ** 2;
    });
    if (err < fit.err) fit = { err, c, per };
  }
  const longOf = (t: number) => bp + bn * t + basis(t, fit.per).reduce((z, x, i) => z + x * fit.c[i], 0);
  let mx = 0;
  const at = (ph: number) => [0, 1, 2].map((i) => a * (Math.cos(ph) * q[i] + Math.sin(ph) * e[i]));
  for (let k = 0; k < th.length; k++) {
    const w = st[k].slice(1, 4);
    const m = at(longOf(ds[k]));
    mx = Math.max(mx, Math.hypot(m[0] - w[0], m[1] - w[1], m[2] - w[2]));
  }
  const nm = namesOf(id);
  const DG = 180 / Math.PI;
  const tail = fit.c.slice(2).map((v) => (v * DG).toFixed(4));
  innerLines.push(
    `  ['${nm?.[0] ?? id}', ${nm?.[1] ?? 1}, ${a.toFixed(0)}, ${((bp + fit.c[0]) * DG).toFixed(4)}, ${((bn + fit.c[1] / 1e4) * DG).toFixed(7)}, ${fit.per.toFixed(1)}, ${tail.join(', ')}], // 差 ${mx.toFixed(0)} km`,
  );
}
console.log(innerLines.join('\n'));

/* ---------- 外側の衛星 ---------- */
const moons: { n: string; g: number; d: number; s: number[] }[] = [];
const fulls: number[][][] = [];
const disagree: string[] = [];
const failed: string[] = [];
for (const { id, des } of rows) {
  if (INNER.includes(id) || MAIN.includes(id)) continue;
  let st: number[][];
  try {
    st = await states(id, 'out', seq(J0, STEP, COUNT));
  } catch (err) {
    failed.push(`${id} ${des}: ${String(err).slice(0, 200)}`);
    continue;
  }
  const num = Number(id) < 700 ? Number(id) - 600 : 0;
  const w = (des && byDes.get(des)) || (num ? byNum.get(num) : undefined);
  const name = w?.[0] ?? des ?? id;
  const o = meanOrbit(st);
  const og = groupOf(o.i);
  const wg = w?.[2] ?? -1;
  if (wg >= 0 && wg !== og) disagree.push(`${name}: 一覧 ${GROUPS[wg]}・軌道 ${GROUPS[og]}`);
  const s: number[] = [];
  for (let k = 0; k < KNOTS && 2 * k < st.length; k++) {
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
  moons.push({ n: name, g: wg >= 0 ? wg : og, d: w?.[1] ?? 1, s });
  fulls.push(st);
  if (!w) console.log(`一覧にない: ${name} a=${(o.a / 1e6).toFixed(1)}M i=${o.i.toFixed(0)} → ${GROUPS[og]}`);
}
const table = { t0: J0, dt: 2 * STEP, n: KNOTS, groups: GROUPS, moons };

/* 間の時点で Horizons との差を測る */
const errs: number[] = [];
const named: string[] = [];
fulls.forEach((st, k) => {
  let mx = 0;
  for (let i = 1; i < st.length; i += 2) {
    const p = tablePos(table, k, st[i][0], GM);
    if (p) mx = Math.max(mx, Math.hypot(p[0] - st[i][1], p[1] - st[i][2], p[2] - st[i][3]));
  }
  errs.push(mx);
  named.push(`${moons[k].n} ${(mx / 1e3).toFixed(0)}`);
});
const sorted = [...errs].sort((a, b) => a - b);
console.log(
  `間の時点の差 [千 km]: 中央値 ${(sorted[sorted.length >> 1] / 1e3).toFixed(0)}、最大 ${(sorted[sorted.length - 1] / 1e3).toFixed(0)}`,
);
console.log(
  named
    .map((s, i) => [errs[i], s] as const)
    .sort((a, b) => b[0] - a[0])
    .slice(0, 8)
    .map((x) => x[1])
    .join(' · '),
);

/* 名前を出す順: 大きな衛星から */
const order = moons.map((_, i) => i).sort((a, b) => moons[b].d - moons[a].d);
table.moons = order.map((i) => moons[i]);
console.log(disagree.length ? `群の違い:\n${disagree.join('\n')}` : '群の違いなし');
if (failed.length) console.log(`取れなかった衛星:\n${failed.join('\n')}`);
writeFileSync(OUT, JSON.stringify(table));
console.log(`moons.json: ${moons.length} 個、${Math.round(readFileSync(OUT).length / 1024)} KB`);

/* ---------- フェーベの長い表 ---------- */
const ph = await states('609', 'long', seq(PH_J0, PH_STEP, PH_N));
const s: number[] = [];
for (const [, x, y, zz, vx, vy, vz] of ph)
  s.push(
    Math.round(x / 1000),
    Math.round(y / 1000),
    Math.round(zz / 1000),
    Math.round(vx),
    Math.round(vy),
    Math.round(vz),
  );
writeFileSync(
  OUT_PH,
  `/**
 * フェーベの土星中心の状態（JPL Horizons、ICRF）。1900-01-01 から ${PH_STEP} 日おきの ${PH_N} 時点で、
 * 位置は 1000 km、速度は km/日 の単位に丸めた。作り直しは scripts/saturn-moons.ts
 */
// biome-ignore format: 表
export const PHOEBE = { t0: ${PH_J0}, dt: ${PH_STEP}, n: ${PH_N}, s: [${s.join(', ')}] };
`,
);
