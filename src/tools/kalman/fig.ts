/**
 * カルマンフィルタのページの図（SVG の文字列）: 線路と台車、位置と速度の平面の楕円、位置の分布の山、誤差の時間波形。
 * 図の座標は表示窓 400 × 240（lib/scope の SW・SH）。色は style.css の k-* の class
 */
import { minus } from '../../lib/format';
import { gridSvg, SH, SW } from '../../lib/scope';
import { ellipse, K95, type State } from './kf';
import type { Rec } from './sim';

const r1 = (v: number) => v.toFixed(1);
/** 1・2・5 の刻み（x を超えない最大） */
export function step125(x: number): number {
  const e = 10 ** Math.floor(Math.log10(x)),
    f = x / e;
  return (f < 2 ? 1 : f < 5 ? 2 : 5) * e;
}
/** 目盛りの数（刻みに合わせた桁） */
const tick = (v: number, st: number) => minus(v.toFixed(Math.max(0, -Math.floor(Math.log10(st) + 1e-9))));
const pdf = (x: number, m: number, s: number) => Math.exp(-0.5 * ((x - m) / s) ** 2) / (s * Math.sqrt(2 * Math.PI));
/** 正規分布の山の折れ線（close なら底を閉じた塗りの形） */
function bell(
  m: number,
  s: number,
  X: (x: number) => number,
  Y: (p: number) => number,
  lo: number,
  hi: number,
  close = false,
): string {
  /* 細い山は頂上の近くを細かく取る */
  const a = Math.max(lo, m - 6 * s),
    b = Math.min(hi, m + 6 * s),
    n = 120;
  let d = `M${r1(X(lo))} ${r1(Y(0))}L${r1(X(a))} ${r1(Y(pdf(a, m, s)))}`;
  for (let i = 1; i <= n; i++) {
    const x = a + ((b - a) * i) / n;
    d += `L${r1(X(x))} ${r1(Y(pdf(x, m, s)))}`;
  }
  d += `L${r1(X(hi))} ${r1(Y(0))}`;
  return close ? `${d}Z` : d;
}
const ellPath = (st: State, X: (p: number) => number, Y: (v: number) => number) =>
  `M${ellipse(st.x, st.P, K95)
    .map(([p, v]) => `${r1(X(p))} ${r1(Y(v))}`)
    .join('L')}Z`;

export interface Gauss {
  m: number;
  s: number;
}

/**
 * 位置の分布の図: 予測・観測・推定の山と本当の位置。lo〜hi が横の範囲 m。
 * 縦は pk（定常の推定の山の高さ）か、出している山の最も高いものに合わせる
 */
export function gaussSvg(o: {
  pri: Gauss;
  obs: Gauss | null;
  est: Gauss | null;
  tru: number;
  lo: number;
  hi: number;
  K: number | null;
  pk: number;
}): string {
  const { lo, hi } = o,
    X = (x: number) => ((x - lo) / (hi - lo)) * SW;
  const peaks = [o.pri, o.obs, o.est].filter((c): c is Gauss => !!c).map((c) => pdf(c.m, c.m, c.s));
  const pm = Math.max(o.pk, ...peaks) * 1.22,
    Y = (p: number) => SH - (p / pm) * (SH - 14);
  let g = gridSvg();
  const st = step125((hi - lo) / 4);
  for (let x = Math.ceil(lo / st) * st; x <= hi + 1e-9; x += st)
    g += `<text x="${r1(X(x))}" y="${SH + 17}" text-anchor="middle">${tick(x, st)}</text>`;
  g += `<text x="${SW}" y="${SH + 32}" text-anchor="end">位置 [m]</text>`;
  const xt = X(o.tru);
  if (xt >= 0 && xt <= SW)
    g += `<path class="k-tru" d="M${r1(xt)} 0V${SH}"/><text class="k-lab t-tru" x="${r1(xt + 4)}" y="12">本当の位置</text>`;
  /* 山の名前は頂上の上。推定・観測・予測の順に置き、先に置いた名前と重なれば下へずらす */
  const placed: [number, number][] = [];
  const lab = (c: Gauss, cls: string, t: string) => {
    const x = Math.max(14, Math.min(SW - 14, X(c.m)));
    let y = Math.max(26, Y(pdf(c.m, c.m, c.s)) - 6);
    for (let i = 0; i < 4 && placed.some(([a, b]) => Math.abs(a - x) < 34 && Math.abs(b - y) < 14); i++) y += 15;
    placed.push([x, y]);
    return `<text class="k-lab ${cls}" x="${r1(x)}" y="${r1(y)}" text-anchor="middle">${t}</text>`;
  };
  const curve = (c: Gauss, cls: string) =>
    `<path class="${cls}-f" d="${bell(c.m, c.s, X, Y, lo, hi, true)}"/><path class="${cls}" d="${bell(c.m, c.s, X, Y, lo, hi)}"/>`;
  g += `<g clip-path="url(#k-mgc)">${curve(o.pri, 'k-pri')}`;
  if (o.obs) g += curve(o.obs, 'k-obs');
  if (o.est) g += curve(o.est, 'k-est');
  g += '</g>';
  if (o.est) g += lab(o.est, 't-est', '推定');
  if (o.obs) g += lab(o.obs, 't-obs', '観測');
  g += lab(o.pri, 't-pri', '予測');
  /* 推定が予測から観測へ K の割合だけ寄った位置 */
  if (o.obs && o.est && o.K !== null) {
    const a = X(o.pri.m),
      b = X(o.obs.m),
      c = X(o.est.m),
      y = SH - 12;
    g += `<path class="k-ruler" d="M${r1(a)} ${y}H${r1(b)}M${r1(a)} ${y - 4}v8M${r1(b)} ${y - 4}v8"/><circle class="k-dot-e" cx="${r1(c)}" cy="${y}" r="3.5"/><text class="t-est" x="${r1(Math.max(30, Math.min(SW - 30, c)))}" y="${y - 8}" text-anchor="middle">K = ${o.K.toFixed(2)}</text>`;
  }
  return `<defs><clipPath id="k-mgc"><rect x="0" y="0" width="${SW}" height="${SH}"/></clipPath></defs>${g}`;
}

/**
 * 位置と速度の平面: 予測（点線）と推定（塗り）の 95 % の楕円、観測の帯（±2σ）、推定の跡、本当の状態（＋）。
 * cx・cv が中心、hx・hv が半幅
 */
export function phaseSvg(o: {
  cx: number;
  cv: number;
  hx: number;
  hv: number;
  pri: State;
  post: State | null;
  z: number | null;
  R: number;
  tru: [number, number];
  trail: readonly [number, number][];
}): string {
  const X = (p: number) => SW / 2 + ((p - o.cx) / o.hx) * (SW / 2),
    Y = (v: number) => SH / 2 - ((v - o.cv) / o.hv) * (SH / 2);
  let g = '';
  const sx = step125(o.hx / 1.6),
    sv = step125(o.hv / 1.2);
  for (let p = Math.ceil((o.cx - o.hx) / sx) * sx; p <= o.cx + o.hx; p += sx) {
    const x = X(p);
    g += `<path class="gl" d="M${r1(x)} 0V${SH}"/><text x="${r1(x)}" y="${SH + 17}" text-anchor="middle">${tick(p, sx)}</text>`;
  }
  for (let v = Math.ceil((o.cv - o.hv) / sv) * sv; v <= o.cv + o.hv; v += sv) {
    const y = Y(v);
    g += `<path class="${Math.abs(v) < sv * 1e-6 ? 'gb' : 'gl'}" d="M0 ${r1(y)}H${SW}"/>${y > 12 ? `<text x="-8" y="${r1(y + 4)}" text-anchor="end">${tick(v, sv)}</text>` : ''}`;
  }
  g += `<rect class="gb" x="0" y="0" width="${SW}" height="${SH}" fill="none"/><text x="${SW}" y="${SH + 32}" text-anchor="end">位置 p [m]</text><text x="-46" y="-3">速度 v [m/s]</text>`;
  g += '<g clip-path="url(#k-phc)">';
  if (o.z !== null) {
    const s = 2 * Math.sqrt(o.R),
      a = X(o.z - s),
      b = X(o.z + s);
    g += `<rect class="k-obs-f" x="${r1(a)}" y="0" width="${r1(b - a)}" height="${SH}"/><path class="k-obs k-dash" d="M${r1(X(o.z))} 0V${SH}"/>`;
  }
  const pri = ellPath(o.pri, X, Y);
  g += `<path class="k-pri-f" d="${pri}"/><path class="k-pri" d="${pri}"/>`;
  if (o.post) {
    const e = ellPath(o.post, X, Y);
    g += `<path class="k-est-f" d="${e}"/><path class="k-est" d="${e}"/>`;
  }
  const n = o.trail.length;
  o.trail.forEach(([p, v], i) => {
    g += `<circle class="k-dot-e" cx="${r1(X(p))}" cy="${r1(Y(v))}" r="2" opacity="${(0.15 + (0.55 * i) / n).toFixed(2)}"/>`;
  });
  const m = (o.post ?? o.pri).x;
  g += `<circle class="k-dot-e" cx="${r1(X(m[0]))}" cy="${r1(Y(m[1]))}" r="3.4"/>`;
  const tx = X(o.tru[0]),
    ty = Y(o.tru[1]);
  g += `<path class="k-tru k-cross" d="M${r1(tx - 7)} ${r1(ty)}h14M${r1(tx)} ${r1(ty - 7)}v14"/></g>`;
  return `<defs><clipPath id="k-phc"><rect x="0" y="0" width="${SW}" height="${SH}"/></clipPath></defs>${g}`;
}

/** 線路と台車（本当の位置）、推定の位置と ±2σ、直近の観測。cam が図の中央の位置、span が半幅 m。viewBox は 0 0 800 96 */
export function trackSvg(o: {
  cam: number;
  span: number;
  tru: number;
  est: number;
  sd: number;
  zs: readonly number[];
}): string {
  const W = 800,
    X = (p: number) => W / 2 + ((p - o.cam) / o.span) * (W / 2);
  let g = `<path class="k-rail" d="M0 66H${W}"/>`;
  for (let p = Math.floor(o.cam - o.span - 1); p <= o.cam + o.span + 1; p++) {
    const x = X(p);
    g += `<path class="k-tick" d="M${r1(x)} 66v${p % 5 === 0 ? 9 : 5}"/>`;
    if (p % 2 === 0 && x > 24 && x < W - 24)
      g += `<text x="${r1(x)}" y="89" text-anchor="middle">${minus(String(p))} m</text>`;
  }
  const n = o.zs.length;
  o.zs.forEach((z, i) => {
    const x = X(z);
    g += `<path class="k-dot-o" d="M${r1(x - 4)} 12h8l-4 7z" opacity="${(0.2 + (0.8 * (i + 1)) / n).toFixed(2)}"/>`;
  });
  const c = X(o.tru);
  g += `<rect class="k-cart" x="${r1(c - 22)}" y="40" width="44" height="20" rx="3"/><circle class="k-whl" cx="${r1(c - 12)}" cy="62" r="4"/><circle class="k-whl" cx="${r1(c + 12)}" cy="62" r="4"/><path class="k-tru k-dash" d="M${r1(c)} 40v20"/>`;
  const e = X(o.est),
    a = X(o.est - 2 * o.sd),
    b = X(o.est + 2 * o.sd);
  g += `<path class="k-est" d="M${r1(e)} 23V66M${r1(a)} 28H${r1(b)}M${r1(a)} 24v8M${r1(b)} 24v8"/>`;
  return g;
}

/**
 * 誤差の時間波形: 推定の誤差（線）、フィルタの見積った ±2σ（帯）、観測の誤差（点）。
 * 横は直近 span 秒（右端が今）、縦は 1 div が vd m
 */
export function errSvg(h: readonly Rec[], now: number, span: number, vd: number): string {
  const X = (t: number) => ((t - (now - span)) / span) * SW,
    lim = (vd * SH) / 80,
    Y = (e: number) => Math.max(-3, Math.min(SH + 3, SH / 2 - (e / vd) * 40));
  let g = '';
  for (let j = -3; j <= 3; j++)
    g += `<text x="-8" y="${SH / 2 - j * 40 + 4}" text-anchor="end">${j ? minus(String(Number((j * vd).toPrecision(3)))) : '0'}</text>`;
  for (let i = 0; i <= 10; i += 2)
    g += `<text x="${i * 40}" y="${SH + 17}" text-anchor="middle">${i === 10 ? '0' : `−${minus(String(Number((((10 - i) * span) / 10).toPrecision(3))))} s`}</text>`;
  if (h.length > 1) {
    let up = '',
      dn = '',
      ln = '',
      dots = '';
    h.forEach((r, i) => {
      const x = r1(X(r.t));
      up += `${i ? 'L' : 'M'}${x} ${r1(Y(2 * r.s))}`;
      dn = `L${x} ${r1(Y(-2 * r.s))}${dn}`;
      ln += `${i ? 'L' : 'M'}${x} ${r1(Y(r.e))}`;
      if (Math.abs(r.oz) <= lim) dots += `<circle class="k-dot-o" cx="${x}" cy="${r1(Y(r.oz))}" r="1.8"/>`;
    });
    g += `<path class="k-band" d="${up}${dn}Z"/>${dots}<path class="k-est" d="${ln}"/>`;
  }
  return g;
}
