/**
 * 図（DOM に依存しない）: 部分音のはしご（各音の部分音を対数の周波数軸に並べ、一致する部分音を線で結ぶ）と、
 * 音の組ごとの拡大図・うなりの包絡・鍵盤の配置。SVG の文字列と座標を返す
 */
import { audible, envelope, noteName, type Pair, type Timbre } from './tem';

/** はしごの大きさと周波数軸 [Hz] */
export const LW = 1100,
  LH = 340;
const FL = 100,
  FH = 4200,
  X0 = 70,
  X1 = 1080,
  TOP = 18,
  ROWS = 270;
export const ladX = (f: number): number => X0 + ((X1 - X0) * Math.log(f / FL)) / Math.log(FH / FL);
const GRID = [
  [100, '100'],
  [200, '200'],
  [500, '500'],
  [1000, '1k'],
  [2000, '2k'],
  [4000, '4k'],
] as const;

/** 符号つき（0 は ±）。マイナスは U+2212 */
export function sg(v: number, d = 1): string {
  const a = Math.abs(v).toFixed(d);
  return (Number(a) === 0 ? '±' : v < 0 ? '−' : '+') + a;
}
const f1 = (v: number) => v.toFixed(1);

export interface LadderLamp {
  /** 音の組の番号（analyze の pairs の順） */
  i: number;
  x: number;
  y: number;
}
/**
 * はしごの SVG の中身。上ほど高い音の行、行ごとに部分音を縦線（高さは振幅）で描き、一致する部分音は色を変え、
 * 2 つの行を破線で結んでうなりの速さを書く。ピアノでは整数倍の位置を点線で添える。灯りの位置を返す
 */
export function ladder(
  notes: readonly { m: number; f: number; dev: number; parts: readonly { n: number; f: number; a: number }[] }[],
  pairs: readonly Pair[],
  tb: Timbre,
): { svg: string; lamps: LadderLamp[] } {
  const ns = notes.slice().sort((a, b) => b.m - a.m),
    rh = ROWS / ns.length,
    base = (m: number) => TOP + ns.findIndex((x) => x.m === m) * rh + rh * 0.8;
  const hot = new Set<string>();
  for (const p of pairs) if (p.c) hot.add(`${p.lo.m}:${p.c[0]}`).add(`${p.hi.m}:${p.c[1]}`);
  let tick = '',
    hotD = '',
    ideal = '',
    cn = '';
  for (const nt of ns) {
    const yb = base(nt.m);
    for (const p of nt.parts) {
      if (p.f > FH) continue;
      const seg = `M${f1(ladX(p.f))} ${f1(yb)}v-${f1(rh * 0.62 * Math.min(1, p.a))}`;
      if (hot.has(`${nt.m}:${p.n}`)) hotD += seg;
      else tick += seg;
      if (tb === 'piano') ideal += `M${f1(ladX(p.n * nt.f))} ${f1(yb - rh * 0.7)}V${f1(yb)}`;
    }
  }
  const lamps: LadderLamp[] = [];
  let txt = '';
  pairs.forEach((p, i) => {
    if (!p.c || p.fl > FH) return;
    const x = ladX(p.fl),
      y1 = base(p.hi.m),
      y2 = base(p.lo.m),
      ym = (y1 + y2) / 2;
    cn += `M${f1(x)} ${f1(y1)}V${f1(y2)}`;
    lamps.push({ i, x: x + 14, y: ym - 4 });
    txt += `<text class="bl" x="${f1(x + 24)}" y="${f1(ym)}">${audible(p) ? `${Math.abs(p.b).toFixed(1)}/s` : '—'}</text>`;
  });
  let labels = '';
  for (const nt of ns) {
    const y = base(nt.m) - rh * 0.42;
    labels += `<text class="nl" x="6" y="${f1(y)}">${noteName(nt.m)}</text><text x="6" y="${f1(y + 15)}">${sg(nt.dev)}</text>`;
  }
  const gx = GRID.map(([f]) => ladX(f));
  const svg =
    `<path class="gl" d="${gx.map((x) => `M${f1(x)} 10V300`).join('')}"/>` +
    `<path class="ax" d="M${X0} 300H${X1}"/>` +
    `<path class="hm" d="${ideal}"/><path class="pt" d="${tick}"/><path class="cn" d="${cn}"/><path class="pt c" d="${hotD}"/>` +
    GRID.map(([, t], i) => `<text class="m" x="${f1(gx[i])}" y="318">${t}</text>`).join('') +
    `<text class="r" x="${X1}" y="336">周波数 [Hz]</text>` +
    labels +
    txt +
    lamps.map((l) => `<circle class="lmp" data-i="${l.i}" cx="${f1(l.x)}" cy="${f1(l.y)}" r="6"/>`).join('');
  return { svg, lamps };
}

/** 拡大図の横軸: 一致する部分音どうしのずれ [セント]（±30 を 10〜190） */
export const zoomX = (ct: number): number => 100 + 3 * Math.max(-32, Math.min(32, ct));

/** うなりの包絡のグラフ（幅 W・高さ H、T 秒） */
export function envPath(p: Pair | undefined, W: number, H: number, T: number): string {
  if (!p || !audible(p)) return '';
  let s = '';
  const N = 240;
  for (let i = 0; i <= N; i++) {
    const y = envelope(p, (T * i) / N);
    s += `${i ? 'L' : 'M'}${f1((W * i) / N)} ${f1(H - 4 - (H - 8) * y)}`;
  }
  return s;
}

/** 灯りの明るさ（包絡の 2 乗。純正・うならない組は暗いまま） */
export const lampOpacity = (p: Pair, t: number, playing: boolean): number => {
  if (!audible(p)) return 0.12;
  if (!playing || Math.abs(p.ct) < 0.05) return 1;
  const e = envelope(p, t);
  return 0.12 + 0.88 * e * e;
};

/** 鍵盤（C3〜B5）: 白鍵 21 枚の幅を 100 % として、各鍵の左端と幅 [%] */
export const KB_LO = 48,
  KB_HI = 83;
export function keyboard(): { m: number; black: boolean; left: number; width: number }[] {
  const W = 100 / 21,
    out = [];
  let wi = 0;
  for (let m = KB_LO; m <= KB_HI; m++) {
    const black = [1, 3, 6, 8, 10].includes(m % 12);
    out.push({ m, black, left: black ? wi * W - W * 0.3 : wi * W, width: black ? W * 0.6 : W });
    if (!black) wi++;
  }
  return out;
}
