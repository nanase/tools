/**
 * 図の SVG（DOM に依存しない）: 今夜の帯・衛星の動きのグラフ・北から見た軌道・相互食の季節・減光の曲線。
 * 衛星の色は CSS の pn-k1〜pn-k8（線と文字）と pn-f1〜pn-f8（塗り）で、番号は衛星の順。
 * 時刻はすべて UT の JD で受け、表示の文字は呼ぶ側が作って渡す
 */
import type { Phen } from './events';

const f1 = (v: number): string => v.toFixed(1);
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/* ---------- 今夜の帯 ---------- */

export interface BandOpt {
  t0: number;
  t1: number;
  /** 行の名前（衛星の順） */
  rows: string[];
  phen: Phen[];
  /** 大赤斑が中央に来る時刻（行を 1 つ足す）。null なら行を作らない */
  grs: number[] | null;
  /** 暗く塗る範囲（惑星が地平線の下・昼）と、薄く塗る範囲（薄明） */
  dark: [number, number][];
  twi: [number, number][];
  ticks: { t: number; label: string }[];
}

export const BAND_W = 1000;
/** 帯の行の高さと、行 i の中心 */
const ROW = 22;
export const bandRowY = (i: number): number => 34 + ROW * i;
/** 時刻の軸の高さ（行の下端） */
export const bandAxisY = (n: number): number => bandRowY(n - 1) + 12;

export function nightBand(o: BandOpt): string {
  const X = (t: number) => ((t - o.t0) / (o.t1 - o.t0)) * BAND_W;
  const cx = (t: number) => Math.min(BAND_W, Math.max(0, X(t)));
  const n = o.rows.length + (o.grs ? 1 : 0);
  const ay = bandAxisY(n);
  const h: string[] = [];
  for (const [a, b] of o.twi)
    if (b > o.t0 && a < o.t1)
      h.push(`<rect class="pn-tw" x="${f1(cx(a))}" y="8" width="${f1(cx(b) - cx(a))}" height="${ay - 8}"></rect>`);
  for (const [a, b] of o.dark)
    if (b > o.t0 && a < o.t1)
      h.push(`<rect class="pn-dk" x="${f1(cx(a))}" y="8" width="${f1(cx(b) - cx(a))}" height="${ay - 8}"></rect>`);
  o.rows.forEach((r, i) => {
    h.push(`<text class="pn-rl" x="4" y="${bandRowY(i) + 4}">${esc(r)}</text>`);
  });
  if (o.grs) h.push(`<text class="pn-rl" x="4" y="${bandRowY(o.rows.length) + 4}">大赤斑</text>`);
  const cls: Record<Phen['kind'], string> = { TR: 'pn-bt', SH: 'pn-bs', OC: 'pn-bh', EC: 'pn-bh' };
  /* 食・掩蔽を先に、通過と影を上に重ねる */
  const order: Phen['kind'][] = ['OC', 'EC', 'SH', 'TR'];
  for (const kind of order)
    for (const p of o.phen) {
      if (p.kind !== kind || p.t1 < o.t0 || p.t0 > o.t1) continue;
      const y = bandRowY(p.k);
      h.push(`<path class="${cls[kind]} pn-k${p.k + 1}" d="M${f1(cx(p.t0))} ${y}H${f1(cx(p.t1))}"></path>`);
    }
  if (o.grs)
    for (const t of o.grs)
      if (t >= o.t0 && t <= o.t1)
        h.push(`<circle class="pn-grs" cx="${f1(X(t))}" cy="${bandRowY(o.rows.length)}" r="4.5"></circle>`);
  h.push(`<path class="pn-gl" d="M0 ${ay}H${BAND_W}"></path>`);
  let tk = '';
  for (const t of o.ticks) tk += `M${f1(X(t.t))} ${ay}V${ay + 5}`;
  h.push(`<path class="pn-tk" d="${tk}"></path>`);
  o.ticks.forEach((t, i) => {
    const x = X(t.t);
    const a = i === 0 && x < 20 ? 'start' : i === o.ticks.length - 1 && x > BAND_W - 20 ? 'end' : 'middle';
    h.push(`<text x="${f1(x)}" y="${ay + 17}" text-anchor="${a}">${esc(t.label)}</text>`);
  });
  return h.join('');
}

/* ---------- 衛星の動きのグラフ ---------- */

export interface WiggleOpt {
  t0: number;
  t1: number;
  /** 横の範囲（±、惑星の赤道半径） */
  xMax: number;
  /** 衛星ごとの点 [時刻, 東西の離れ（東が正）, 惑星に隠れているか] */
  series: [number, number, boolean][][];
  /** 日付の目盛り */
  days: { t: number; label: string }[];
  /** 印（相互食など） */
  marks: { t: number; x: number; label: string }[];
}

/** グラフの描く範囲（viewBox は -40 0 600 486、中は 0〜560 × 22〜462） */
export const WIG = { w: 560, h: 440, top: 22 };

export function wiggle(o: WiggleOpt): string {
  const sx = WIG.w / 2 / o.xMax;
  /* 東を左に */
  const X = (x: number) => WIG.w / 2 - x * sx;
  const Y = (t: number) => WIG.top + ((t - o.t0) / (o.t1 - o.t0)) * WIG.h;
  const h: string[] = [
    `<rect class="pn-bandc" x="${f1(X(1))}" y="${WIG.top}" width="${f1(2 * sx)}" height="${WIG.h}"></rect>`,
  ];
  let gr = '';
  for (const d of o.days) gr += `M0 ${f1(Y(d.t))}H${WIG.w}`;
  h.push(`<path class="pn-gr" d="${gr}"></path>`);
  for (const d of o.days) h.push(`<text x="-4" y="${f1(Y(d.t) + 4)}" text-anchor="end">${esc(d.label)}</text>`);
  o.series.forEach((s, k) => {
    let d = '';
    let pen = false;
    for (const [t, x, hid] of s) {
      if (hid || Math.abs(x) > o.xMax * 1.02) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${f1(X(x))} ${f1(Y(t))}`;
      pen = true;
    }
    h.push(`<path class="pn-wl pn-k${k + 1}" d="${d}"></path>`);
  });
  for (const m of o.marks)
    h.push(
      `<circle class="pn-pk" cx="${f1(X(m.x))}" cy="${f1(Y(m.t))}" r="4.5"></circle><text class="pn-ts" x="${f1(X(m.x) + 9)}" y="${f1(Y(m.t) + 14)}">${esc(m.label)}</text>`,
    );
  h.push(
    `<text x="0" y="12">← 東</text><text x="${WIG.w}" y="12" text-anchor="end">西 →</text>`,
    `<path class="pn-now" id="wnow" d=""></path><text class="pn-nowt" id="wnowt" x="${WIG.w + 2}"></text>`,
  );
  return h.join('');
}

/** グラフの縦の位置から時刻へ */
export const wiggleTime = (o: { t0: number; t1: number }, y: number): number =>
  o.t0 + ((y - WIG.top) / WIG.h) * (o.t1 - o.t0);

/* ---------- 北から見た軌道 ---------- */

export interface TopOpt {
  /** 衛星の位置（惑星の赤道半径。x は右、y は下が地球の向き） */
  moons: [number, number][];
  names: string[];
  /** 軌道の半径（惑星の赤道半径） */
  orbits: number[];
  /** 太陽への向き（同じ座標の単位ベクトル） */
  sun: [number, number];
}

export function orbitTop(o: TopOpt): string {
  const R = 116;
  const sc = R / Math.max(...o.orbits);
  const c = 150;
  const pr = Math.max(3.4, sc);
  const h: string[] = [];
  /* 惑星の影: 太陽と反対の向きへ、外の軌道の先まで */
  const [ux, uy] = o.sun;
  const L = R + 24;
  const nx = -uy * pr,
    ny = ux * pr;
  h.push(
    `<polygon class="pn-shd" points="${f1(c + nx)},${f1(c + ny)} ${f1(c - nx)},${f1(c - ny)} ${f1(c - nx - ux * L)},${f1(c - ny - uy * L)} ${f1(c + nx - ux * L)},${f1(c + ny - uy * L)}"></polygon>`,
  );
  for (const r of o.orbits) h.push(`<circle class="pn-orb" cx="${c}" cy="${c}" r="${f1(r * sc)}"></circle>`);
  h.push(`<circle class="pn-pl" cx="${c}" cy="${c}" r="${f1(pr)}"></circle>`);
  /* 名前は衛星の外側に置き、重ならないよう少しずらす */
  const used: [number, number][] = [];
  o.moons.forEach(([x, y], k) => {
    const px = c + x * sc,
      py = c + y * sc;
    h.push(`<circle class="pn-f${k + 1}" cx="${f1(px)}" cy="${f1(py)}" r="4"></circle>`);
    const ang = Math.atan2(py - c, px - c);
    let lx = px + Math.cos(ang) * 10,
      ly = py + Math.sin(ang) * 10 + 4;
    while (used.some(([a, b]) => Math.abs(a - lx) < 40 && Math.abs(b - ly) < 12)) ly += 12;
    used.push([lx, ly]);
    const anchor = Math.cos(ang) < -0.3 ? 'end' : Math.cos(ang) > 0.3 ? 'start' : 'middle';
    if (anchor === 'middle') lx = px;
    h.push(`<text class="pn-tn" x="${f1(lx)}" y="${f1(ly)}" text-anchor="${anchor}">${esc(o.names[k])}</text>`);
  });
  /* 地球へ（真下）と太陽へ */
  h.push(
    '<path class="pn-eyar" d="M168 272V296M163 290L168 296L173 290"></path><text class="pn-ts" x="176" y="294">地球へ</text>',
  );
  const sx = 120,
    sy = 284;
  const ex = sx + ux * 13,
    ey = sy + uy * 13,
    bx = sx - ux * 13,
    by = sy - uy * 13;
  const ah = (a: number) =>
    `${f1(ex - 6 * Math.cos(Math.atan2(uy, ux) + a))} ${f1(ey - 6 * Math.sin(Math.atan2(uy, ux) + a))}`;
  h.push(
    `<path class="pn-sunar" d="M${f1(bx)} ${f1(by)}L${f1(ex)} ${f1(ey)}M${ah(0.5)}L${f1(ex)} ${f1(ey)}L${ah(-0.5)}"></path><text class="pn-ts" x="${sx - 18}" y="${sy + 10}" text-anchor="end">太陽へ</text>`,
  );
  h.push(
    '<path class="pn-ax" d="M262 92A124 124 0 0 0 214 42"></path><path class="pn-ax" d="M219 40L213 42L216 48"></path><text class="pn-ts" x="262" y="62" text-anchor="middle">公転の向き</text>',
  );
  return h.join('');
}

/* ---------- 相互食の季節 ---------- */

export interface SeasonOpt {
  d0: number;
  d1: number;
  /** 縦の範囲（夜の時刻、表示の時刻帯の 0 時からの時間。18 → 30 など） */
  h0: number;
  h1: number;
  /** 表示の時刻帯の時差 [時] */
  tz: number;
  events: { t: number; kind: 'occ' | 'ecl'; a: number; depth: number }[];
  /** 夜の見えない時間（日ごとの [見え始め, 見え終わり]、時刻は h0〜h1 の時） */
  vis: { d: number; a: number; b: number }[];
  ticks: { d: number; label: string }[];
  today: number;
  sel: number;
}

export const SEA = { w: 600, h: 200 };

/** 日付と夜の時刻 */
export function seasonXY(o: Pick<SeasonOpt, 'd0' | 'd1' | 'h0' | 'h1' | 'tz'>, t: number): [number, number] {
  const lt = t + o.tz / 24;
  let day = Math.floor(lt + 0.5) - 0.5;
  let hr = (lt - day) * 24;
  if (hr < o.h0) {
    day -= 1;
    hr += 24;
  }
  return [((day - o.tz / 24 - o.d0) / (o.d1 - o.d0)) * SEA.w, ((hr - o.h0) / (o.h1 - o.h0)) * SEA.h];
}

export function season(o: SeasonOpt): string {
  const X = (d: number) => ((d - o.d0) / (o.d1 - o.d0)) * SEA.w;
  const Y = (hr: number) => ((hr - o.h0) / (o.h1 - o.h0)) * SEA.h;
  const h: string[] = [];
  let gr = '';
  for (let k = 0; k <= 4; k++) gr += `M0 ${(k * SEA.h) / 4}H${SEA.w}`;
  for (const t of o.ticks) gr += `M${f1(X(t.d))} 0V${SEA.h}`;
  h.push(`<path class="pn-gr" d="${gr}"></path>`);
  if (o.vis.length) {
    const top = o.vis.map((v) => `${f1(X(v.d))},${f1(Y(Math.max(o.h0, Math.min(o.h1, v.a))))}`);
    const bot = o.vis.map((v) => `${f1(X(v.d))},${f1(Y(Math.max(o.h0, Math.min(o.h1, v.b))))}`);
    h.push(
      `<polygon class="pn-bandc" points="0,0 ${top.join(' ')} ${SEA.w},0"></polygon>`,
      `<polygon class="pn-bandc" points="0,${SEA.h} ${bot.join(' ')} ${SEA.w},${SEA.h}"></polygon>`,
    );
  }
  const hl = (hr: number) => `${((hr % 24) + 24) % 24}:00`;
  for (let k = 0; k <= 2; k++) {
    const hr = o.h0 + ((o.h1 - o.h0) * k) / 2;
    h.push(`<text x="-6" y="${f1(Y(hr) + 4)}" text-anchor="end">${hl(hr)}</text>`);
  }
  for (const t of o.ticks)
    h.push(`<text x="${f1(X(t.d))}" y="${SEA.h + 18}" text-anchor="middle">${esc(t.label)}</text>`);
  if (o.today >= o.d0 && o.today <= o.d1)
    h.push(
      `<path class="pn-now" d="M${f1(X(o.today))} -6V${SEA.h + 6}"></path><text class="pn-nowt" x="${f1(X(o.today))}" y="${SEA.h + 34}" text-anchor="middle">今夜</text>`,
    );
  o.events.forEach((e, i) => {
    const [x, y] = seasonXY(o, e.t);
    if (x < -4 || x > SEA.w + 4 || y < -4 || y > SEA.h + 4) return;
    const r = 3 + Math.min(1, e.depth / 0.4) * 4.5;
    const c = e.kind === 'occ' ? `pn-f${e.a + 1}` : `pn-ring pn-k${e.a + 1}`;
    const on = i === o.sel ? ' pn-sel' : '';
    h.push(
      `<g class="pn-ev${on}" data-i="${i}" tabindex="0" role="button"><circle class="pn-hit" cx="${f1(x)}" cy="${f1(y)}" r="11"></circle><circle class="${c}" cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}"></circle></g>`,
    );
  });
  return h.join('');
}

/** 減光の曲線（viewBox 0 0 300 120）。f は 0〜1 の割合 */
export function lightCurve(pts: [number, number][], labels: { t0: string; t1: string; lo: string }): string {
  if (!pts.length) return '';
  const a = pts[0][0],
    b = pts[pts.length - 1][0];
  const lo = Math.min(...pts.map((p) => p[1]));
  const fl = Math.max(0, Math.floor((lo - 0.02) * 20) / 20);
  const X = (t: number) => ((t - a) / (b - a)) * 300;
  const Y = (f: number) => 12 + ((1 - f) / (1 - fl)) * 96;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${f1(X(p[0]))} ${f1(Y(p[1]))}`).join('');
  return (
    `<path class="pn-gr" d="M0 12H300M0 108H300"></path><path class="pn-wl pn-curve" d="${d}"></path>` +
    `<text x="0" y="8">100 %</text><text x="0" y="120">${Math.round(fl * 100)} %</text>` +
    `<text x="${f1(X(a + (b - a) / 4))}" y="120" text-anchor="middle">${esc(labels.t0)}</text>` +
    `<text x="${f1(X(a + ((b - a) * 3) / 4))}" y="120" text-anchor="middle">${esc(labels.t1)}</text>`
  );
}
