/**
 * 図（DOM に依存しない）: 純正の物差し（周波数を等間隔に並べ、和音を純正な比にしたときに部分音が来る位置を目盛りにして、
 * 各音の部分音を目盛りからのずれを拡大して描く）と、音の組ごとの拡大図・うなりの包絡・鍵盤の配置。SVG の文字列と座標を返す
 */
import { type Beat, type Coin, envelope, firstOrder, type Note, noteName, pure } from './tem';

/** 物差しの大きさ */
export const LW = 1100,
  LH = 300;
const X0 = 136,
  X1 = 1084,
  TOP = 46,
  BOT = 252;
/** 目盛りからのずれを描くときの倍率 */
export const KX = 10;

/** 符号つき（0 は ±）。マイナスは U+2212 */
export function sg(v: number, d = 1): string {
  const a = Math.abs(v).toFixed(d);
  return (Number(a) === 0 ? '±' : v < 0 ? '−' : '+') + a;
}
const f1 = (v: number) => v.toFixed(1);
/** 中心 (x, y)・半径 r の円の path */
const dot = (x: number, y: number, r: number) =>
  `M${f1(x - r)} ${f1(y)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
/** 横軸の Hz の目盛りの間隔（3〜9 本になる 1・2・5 の刻み） */
function hzStep(fmax: number): number {
  for (const s of [50, 100, 200, 500, 1000, 2000]) if (fmax / s <= 9) return s;
  return 5000;
}
/** うなりの速さの表記（純正は 0。2 次のうなりは「（2 次）」を添える） */
export const beatLabel = (x: Beat): string =>
  pure(x) ? '0' : `${Math.abs(x.b).toFixed(1)}${firstOrder(x) ? '' : '（2 次）'}`;

/**
 * 物差しの SVG の中身。notes は和音の順（根音から）、ratios はその純正な比（justRatios）。
 * 上ほど高い音の行に、部分音を点（大きさは振幅、下の数字は部分音の番号）で描く。2 つの音の部分音が同じ目盛りに来る所
 * （cs）は縦の帯で結び、うなりの速さと灯り（circle.lmp、data-c は cs の番号）を添える。部分音がない 2 次のうなりは破線。
 * cls(i) は音の組 i の色のクラス（k0〜k2。'' の組は灰色で、速さの数字を書かない）
 */
export function ruler(
  notes: readonly Note[],
  cs: readonly Coin[],
  ratios: readonly number[],
  cls: (i: number) => string,
): string {
  const rows = notes.map((n, i) => ({ n, q: ratios[i] })).sort((a, b) => b.n.m - a.n.m),
    rh = (BOT - TOP) / rows.length,
    y = (m: number) => TOP + rows.findIndex((x) => x.n.m === m) * rh + rh * 0.42,
    q = (m: number) => rows.find((x) => x.n.m === m)?.q ?? 1,
    F0 = notes[0].f / ratios[0];
  /* 横軸の幅（目盛りの単位 F0 の何倍まで）: 一致する所がすべて入り、高い音の第 2 部分音まで見える。第 8 部分音の目盛りまで */
  const rmax = Math.max(...ratios),
    maxU = Math.max(0, ...cs.map((c) => c.nl * q(c.lo))),
    U = Math.min(8.2 * rmax, Math.max(maxU + Math.min(...ratios) * 0.8, rmax * 2.3)),
    ux = (u: number) => X0 + ((X1 - X0) * u) / U;

  /* 目盛り（どれかの音の部分音が純正なら来る位置） */
  let grid = '';
  const seen = new Set<number>();
  for (const { q: r } of rows)
    for (let u = r; u <= U; u += r)
      if (!seen.has(u)) {
        seen.add(u);
        grid += `M${f1(ux(u))} ${TOP - 14}V${BOT}`;
      }

  /* 同じ目盛りに来る部分音（色をつける点） */
  const hot = new Map<string, string>();
  for (const c of cs)
    if (firstOrder(c)) {
      for (const k of [`${c.lo}:${c.nl}`, `${c.hi}:${c.nh}`])
        if (!hot.has(k) || hot.get(k) === '') hot.set(k, cls(c.i));
    }

  /* 帯と、2 次のうなりの部分音があるはずの位置 */
  let band = '',
    txt = '';
  const bands: Record<string, string> = {},
    ears: Record<string, string> = {},
    put: { x: number; y: number }[] = [];
  cs.forEach((c, ci) => {
    const u = c.nl * q(c.lo);
    if (u > U) return;
    const x = ux(u),
      yh = y(c.hi),
      yl = y(c.lo),
      k = cls(c.i),
      key = `${k || 'g'}${firstOrder(c) ? '' : ' e'}`;
    bands[key] = `${bands[key] ?? ''}M${f1(x - 11)} ${f1(yh - 15)}h22V${f1(yl + 15)}h-22Z`;
    if (!firstOrder(c))
      for (const [m, n, f, yy] of [
        [c.lo, c.nl, c.fl, yl],
        [c.hi, c.nh, c.fh, yh],
      ]) {
        const u0 = n * q(m);
        ears[k || 'g'] = (ears[k || 'g'] ?? '') + dot(ux(u0 + (f / F0 - u0) * KX), yy, 6);
        txt += `<text class="pn ${k}" x="${f1(ux(u0))}" y="${f1(yy + 21)}">${n}</text>`;
      }
    if (!k) return;
    /* 速さの数字は帯の上。ほかの数字と重なれば上へずらす */
    let ly = yh - 26;
    while (put.some((p) => Math.abs(p.x - x) < 70 && Math.abs(p.y - ly) < 14)) ly -= 15;
    put.push({ x, y: ly });
    txt +=
      `<circle class="lmp ${k}${firstOrder(c) ? '' : ' e'}" data-c="${ci}" cx="${f1(x - 6)}" cy="${f1(ly - 4)}" r="5"/>` +
      `<text class="bl ${k}" x="${f1(x + 4)}" y="${f1(ly)}">${beatLabel(c)}</text>`;
  });
  for (const [key, d] of Object.entries(bands)) band += `<path class="band ${key}" d="${d}"/>`;

  /* 部分音: 純正の位置に短い縦線、そこから実際の位置（ずれは KX 倍）へ横線と点 */
  let ideal = '',
    dev = '';
  const dots: Record<string, string> = {};
  for (const { n, q: r } of rows) {
    const yy = y(n.m);
    txt +=
      `<text class="nl" x="6" y="${f1(yy - 3)}">${noteName(n.m)}</text>` +
      `<text class="nf" x="6" y="${f1(yy + 13)}">比 ${r} · ${n.f.toFixed(1)} Hz</text>`;
    for (const p of n.parts) {
      const u0 = p.n * r;
      if (u0 > U) continue;
      const xi = ux(u0),
        xd = ux(u0 + (p.f / F0 - u0) * KX),
        k = hot.get(`${n.m}:${p.n}`) ?? 'n';
      ideal += `M${f1(xi)} ${f1(yy - 11)}V${f1(yy + 11)}`;
      if (Math.abs(xd - xi) > 0.6) dev += `M${f1(xi)} ${f1(yy)}H${f1(xd)}`;
      dots[k || 'g'] = (dots[k || 'g'] ?? '') + dot(xd, yy, 3 + 4.5 * Math.sqrt(Math.min(1, p.a)));
      txt += `<text class="pn ${k === 'n' ? '' : k}" x="${f1(xi)}" y="${f1(yy + 23)}">${p.n}</text>`;
    }
  }

  /* 横軸の Hz */
  const fmax = U * F0,
    st = hzStep(fmax);
  let ax = '';
  for (let f = st; f <= fmax; f += st)
    ax += `<text class="m" x="${f1(ux(f / F0))}" y="${BOT + 18}">${f >= 1000 ? `${f / 1000}k` : f}</text>`;

  return (
    `<path class="gl" d="${grid}"/><path class="ax" d="M${X0} ${BOT}H${X1}"/>` +
    band +
    `<path class="idl" d="${ideal}"/><path class="dvl" d="${dev}"/>` +
    Object.entries(dots)
      .map(([k, d]) => `<path class="dt ${k}" d="${d}"/>`)
      .join('') +
    Object.entries(ears)
      .map(([k, d]) => `<path class="ear ${k}" d="${d}"/>`)
      .join('') +
    ax +
    `<text class="r" x="${X1}" y="${LH - 6}">周波数 [Hz]（等間隔）· 目盛りからのずれは ${KX} 倍</text>` +
    txt
  );
}

/** 拡大図の横軸: 一致する部分音どうしのずれ [セント]（±30 を 10〜190） */
export const zoomX = (ct: number): number => 100 + 3 * Math.max(-32, Math.min(32, ct));

/** うなりの包絡のグラフ（幅 W・高さ H、T 秒）。部分音どうしのうなりだけ（2 次のうなりは音量が揺れない） */
export function envPath(p: Beat | null | undefined, W: number, H: number, T: number): string {
  if (!p || !firstOrder(p)) return '';
  let s = '';
  const N = 240;
  for (let i = 0; i <= N; i++) {
    const y = envelope(p, (T * i) / N);
    s += `${i ? 'L' : 'M'}${f1((W * i) / N)} ${f1(H - 4 - (H - 8) * y)}`;
  }
  return s;
}

/**
 * 灯りの明るさ。部分音どうしのうなりは包絡の 2 乗、2 次のうなりは同じ速さで浅く明滅する。
 * 純正（うならない）は灯ったまま、一致する部分音を持たない組（null）は暗いまま
 */
export const lampOpacity = (p: Beat | null, t: number, playing: boolean): number => {
  if (!p) return 0.12;
  if (!playing || pure(p)) return 1;
  if (!firstOrder(p)) return 0.6 + 0.4 * Math.cos(2 * Math.PI * p.b * t);
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
