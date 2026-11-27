/**
 * カウンタと分周のページの図: 水晶と 15 段のランプの列・7 セグメントの時刻・6 段の T フリップフロップと波形。
 * 図の形（幅・速さ・鳴らす段で決まる）は文字列で作って置き、こまごとの値は paint でクラスと波形の d だけを替える。
 * 作り直すのは幅・速さを変えたときだけにし、スピーカーのボタンのフォーカスとホバーを保つ。
 * 水晶は端子が 2 つの部品なので、インバータの入力と出力の間につないだ発振回路（ピアース発振回路）として描き、
 * インバータの出力を 1 段目のクロックへつなぐ
 */
import {
  digits,
  F32,
  fmtDur,
  fmtHz,
  halfT,
  inSecond,
  MIN_CYCLE_PX,
  qv,
  ROWS,
  STAGES,
  stF,
  winSec,
  winTop,
} from './model';

const rd = (v: number): number => Math.round(v * 10) / 10;
/** 点滅が速すぎて、ランプを半分の明るさで出す速さ [回/秒] */
const BLUR_HZ = 6;
/** 鳴らせる段の上限 [Hz]。これより高い段のスピーカーは押せない */
export const AUDIBLE_HZ = 16500;
export const audible = (k: number, sp: number): boolean => stF(k) * sp <= AUDIBLE_HZ;

/** 矢じり: 先端 (x, y)、向き a（ラジアン） */
function ah(x: number, y: number, a: number, cls: string, s = 6): string {
  const c = Math.cos(a),
    n = Math.sin(a);
  const bx = x - c * s,
    by = y - n * s;
  return `<path class="${cls}" d="M${rd(x)} ${rd(y)}L${rd(bx - n * s * 0.5)} ${rd(by + c * s * 0.5)}L${rd(bx + n * s * 0.5)} ${rd(by - c * s * 0.5)}Z"/>`;
}

/* ---------- 7 セグメント ---------- */
const SEG7 = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
/** 7 セグメントの 1 桁（幅 w・高さ h）。区画は data-g（桁）と data-c（区画の名前） */
function digit7(x: number, y: number, w: number, h: number, g: number): string {
  const t = Math.max(3, w * 0.17),
    q = t * 0.35,
    m = h / 2;
  const hz = (k: string, yy: number) =>
    `<path class="seg7" data-g="${g}" data-c="${k}" d="M${rd(x + q + t / 2)} ${rd(yy)}l${rd(t / 2)} ${rd(-t / 2)}H${rd(x + w - q - t)}l${rd(t / 2)} ${rd(t / 2)}l${rd(-t / 2)} ${rd(t / 2)}H${rd(x + q + t)}Z"/>`;
  const vt = (k: string, xx: number, y0: number, y1: number) =>
    `<path class="seg7" data-g="${g}" data-c="${k}" d="M${rd(xx)} ${rd(y0 + q + t / 2)}l${rd(t / 2)} ${rd(t / 2)}V${rd(y1 - q - t)}l${rd(-t / 2)} ${rd(t / 2)}l${rd(-t / 2)} ${rd(-t / 2)}V${rd(y0 + q + t)}Z"/>`;
  return (
    hz('a', y + t / 2) +
    hz('g', y + m) +
    hz('d', y + h - t / 2) +
    vt('f', x + t / 2, y, y + m) +
    vt('b', x + w - t / 2, y, y + m) +
    vt('e', x + t / 2, y + m, y + h) +
    vt('c', x + w - t / 2, y + m, y + h)
  );
}

/**
 * 水晶の発振回路: インバータ（入力の左端 x、中心の高さ y）の入力と出力の間に、抵抗器と水晶（下に dy）をつなぐ。
 * 抵抗器はインバータの出力と水晶の間に入れる。戻り値の xo はインバータの出力の右端、xr は出力の線から分かれる点
 * （分かれる点の丸は、出力の線と同じ色で光らせるため呼ぶ側で描く）
 */
function osc(x: number, y: number, dy: number): { s: string; xo: number; xr: number } {
  const xc = x + 9,
    yx = y + dy,
    xr = x + 26,
    ry = y + dy / 2;
  const s =
    `<path class="w" d="M${x} ${y}H${x - 6}V${yx}H${xc - 6}M${xc + 6} ${yx}H${xr}V${y}"/>` +
    `<rect class="res" x="${xr - 3}" y="${ry - 5}" width="6" height="10"/>` +
    `<path class="xp" d="M${xc - 6} ${yx - 6}V${yx + 6}M${xc + 6} ${yx - 6}V${yx + 6}"/><rect class="xtal" x="${xc - 3}" y="${yx - 5}" width="6" height="10"/>` +
    `<path class="bx" d="M${x} ${y - 8}V${y + 8}L${x + 15} ${y}Z"/><circle class="bub" cx="${x + 17.5}" cy="${y}" r="2.5"/>`;
  return { s, xo: x + 20, xr };
}

/** スピーカーのボタン（図の中）。押せない段は aria-disabled */
const spk = (x: number, y: number, k: number, on: boolean, dis: boolean): string =>
  `<g class="ct-spk${on ? ' on' : ''}${dis ? ' dis' : ''}" data-snd="${k}" role="button" tabindex="${dis ? -1 : 0}" aria-pressed="${on}"${dis ? ' aria-disabled="true"' : ''} aria-label="${k ? `${k} 段目` : '水晶'}の音" transform="translate(${x} ${y})"><rect x="0" y="0" width="28" height="24" rx="4"/><path d="M7 9H10L14 5.5V18.5L10 15H7Z"/><path class="wv" d="M17 9Q19 12 17 15M19.5 7Q23 12 19.5 17"/></g>`;

/* ---------- 水晶と 15 段のランプの列 ---------- */
function lampChain(W: number, top: number, wt: number): { s: string; H: number; end: { x: number; y: number } } {
  const cw = W < 520 ? 52 : 60,
    cols = Math.min(STAGES + 1, Math.max(4, Math.floor((W - 8) / cw)));
  const rows = Math.ceil((STAGES + 1) / cols),
    pitch = 78,
    y0 = top + 14;
  const x0 = (W - cols * cw) / 2 + cw / 2;
  const pos = (i: number) => {
    const r = Math.floor(i / cols),
      c = i % cols;
    return { r, x: x0 + (r % 2 ? cols - 1 - c : c) * cw, y: y0 + r * pitch };
  };
  let s = `<text class="smj" x="${pos(0).x}" y="${top + 6}" text-anchor="middle">水晶発振</text><text class="smj" x="${pos(1).x - cw / 2 + 4}" y="${top + 6}">T フリップフロップ 15 段</text>`;
  for (let i = 0; i <= STAGES; i++) {
    const p = pos(i),
      yc = p.y + 16,
      bx = p.x - cw / 2 + 3;
    if (i >= wt && i < wt + ROWS)
      s += `<rect class="mk" x="${bx}" y="${p.y - 2}" width="${cw - 6}" height="56" rx="4"/>`;
    /* 押すとその段の波形を出す */
    s += `<g class="ct-st" data-st="${i}" role="button" tabindex="0" aria-label="${i ? `${i} 段目` : '水晶発振'}の波形を表示"><rect class="hit" x="${bx}" y="${p.y - 2}" width="${cw - 6}" height="56" rx="4"/><rect class="hl" data-hl="${i}" x="${bx}" y="${p.y - 2}" width="${cw - 6}" height="56" rx="4"/>`;
    if (i === 0) {
      /* 波形の行と同じ形を 85 % に縮め、出力をランプの高さにそろえる */
      const O = osc(p.x - 14, yc, 16),
        S = 0.85,
        X = (v: number) => rd(p.x + (v - p.x) * S);
      s += `<g transform="translate(${p.x} ${yc}) scale(${S}) translate(${-p.x} ${-yc})">${O.s}</g>`;
      s += `<g data-l="0"><path class="w" d="M${X(O.xo)} ${yc}H${p.x + 15}"/><circle class="dot" cx="${X(O.xr)}" cy="${yc}" r="2"/></g>`;
      s += `<text class="sm" x="${p.x}" y="${p.y + 46}" text-anchor="middle">${F32}</text>`;
    } else {
      s += `<circle class="ledc" data-l="${i}" cx="${p.x}" cy="${yc}" r="8.5"/>`;
      s += `<text class="${i === STAGES ? 'v' : 'sm'}" x="${p.x}" y="${p.y + 46}" text-anchor="middle">${i === STAGES ? '1 Hz' : stF(i)}</text>`;
    }
    s += '</g>';
    if (i < STAGES) {
      const q = pos(i + 1);
      if (q.r === p.r) {
        const dir = q.x > p.x ? 1 : -1;
        s += `<path class="w" d="M${p.x + dir * 15} ${yc}H${q.x - dir * 17}"/>${ah(q.x - dir * 12, yc, dir > 0 ? 0 : Math.PI, 'ah ink')}`;
      } else s += `<path class="w" d="M${p.x} ${p.y + 52}V${q.y + 2}"/>${ah(p.x, q.y + 6, Math.PI / 2, 'ah ink')}`;
    }
  }
  const pl = pos(STAGES);
  return { s, H: y0 + rows * pitch - 20, end: { x: pl.x, y: pl.y + 52 } };
}

/* ---------- 7 セグメントの時刻と桁上げ ---------- */
function clockDisplay(W: number, top: number, src: { x: number; y: number }): { s: string; H: number } {
  const dw = Math.min(46, (W - 30) / 8.4),
    pad = Math.round(dw * 0.28),
    dTop = top + 22 + pad,
    dh = dw * 1.75,
    gap = dw * 0.32,
    colW = dw * 0.7;
  const total = 6 * dw + 3 * gap + 2 * colW,
    xs: number[] = [];
  let x = (W - total) / 2;
  for (let k = 0; k < 6; k++) {
    xs.push(x);
    x += dw + (k % 2 === 0 ? gap : k < 5 ? colW : 0);
  }
  const sx = xs[5] + dw / 2,
    pTop = dTop - pad;
  /* 7 セグメントの板（明るいテーマでも消えた区画と点いた区画の差が見えるよう暗くする） */
  let s = `<rect class="plate" x="${rd(xs[0] - pad)}" y="${rd(pTop)}" width="${rd(total + 2 * pad)}" height="${rd(dh + 2 * pad)}" rx="6"/>`;
  s += `<path class="w" data-ck="" d="M${src.x} ${src.y}V${rd(pTop - 12)}H${rd(sx)}V${rd(pTop - 6)}"/>${ah(sx, pTop - 1, Math.PI / 2, 'ah ink')}`;
  for (let k = 0; k < 6; k++) s += digit7(xs[k], dTop, dw, dh, k);
  for (const k of [1, 3]) {
    const cx = xs[k] + dw + colW / 2;
    s += `<circle class="col7" cx="${rd(cx)}" cy="${rd(dTop + dh * 0.32)}" r="${rd(dw * 0.07)}"/><circle class="col7" cx="${rd(cx)}" cy="${rd(dTop + dh * 0.68)}" r="${rd(dw * 0.07)}"/>`;
  }
  const ly = dTop + dh + pad + 20;
  const lb = (xx: number, tx: string) =>
    `<text class="lb" x="${rd(xx)}" y="${rd(ly)}" text-anchor="middle">${tx}</text>`;
  s +=
    lb(xs[0] + dw + gap / 2, '24 進') +
    lb(xs[2] + dw / 2, '6 進') +
    lb(xs[3] + dw / 2, '10 進') +
    lb(xs[4] + dw / 2, '6 進') +
    lb(xs[5] + dw / 2, '10 進');
  /* 桁上げの矢印: 秒の 1 の位 → 10 の位 → 分の 1 の位 → 10 の位 → 時 */
  const cy = ly + 14;
  (
    [
      [5, 4],
      [4, 3],
      [3, 2],
      [2, 1],
    ] as const
  ).forEach(([a, b], j) => {
    const xa = xs[a] + dw / 2 - 12,
      xb = b === 1 ? xs[0] + dw + gap / 2 + 18 : xs[b] + dw / 2 + 12;
    s += `<g class="cy" data-cy="${j}"><path class="w" d="M${rd(xa)} ${rd(cy)}H${rd(xb + 5)}"/>${ah(xb, cy, Math.PI, 'ah')}</g>`;
  });
  /* この 1 秒の振動回数（15 段のランプが 2 進で数えている値 + 1） */
  const iy = cy + 32;
  /* 数字は右寄せにして、桁が増えても「/ 32768」を動かさない */
  s += `<text class="lb" x="${rd(W / 2 - 14)}" y="${rd(iy)}" text-anchor="end">この 1 秒の振動回数</text><text class="v" data-in="" x="${rd(W / 2 + 36)}" y="${rd(iy)}" text-anchor="end">1</text><text class="sm" x="${rd(W / 2 + 40)}" y="${rd(iy)}">/ ${F32}</text>`;
  return { s, H: iy + 8 - top };
}

/* ---------- 6 段の T フリップフロップと波形 ---------- */
export interface Row {
  k: number;
  yc: number;
  /** 速すぎて斜線の帯にする段 */
  band: boolean;
}
export interface Ladder {
  /** 波形の左端・幅 [px] */
  x0: number;
  ww: number;
  /** 波形の上下の y のずれ（yc から） */
  bh: number;
  /** 見せる長さ（水晶の周期の数） */
  win: number;
  rows: Row[];
}
function ladder(W: number, top: number, sp: number, sndOn: ReadonlySet<number>): { s: string; H: number; geo: Ladder } {
  const narrow = W < 520,
    o = narrow ? 32 : 0,
    rh = 44;
  const LW = 100 - o,
    RC = narrow ? 126 : 172,
    xe = W - RC,
    x0 = LW + 4,
    ww = xe - LW - 10;
  const wt = winTop(sp),
    ks = Array.from({ length: ROWS }, (_, i) => wt + i);
  const sec = winSec(sp, wt, ww),
    win = sec * F32 * sp;
  const H = ks.length * rh + 18,
    bh = Math.min(13, rh / 2 - 4);
  let s = '';
  for (let i = 0; i <= 4; i++) {
    if (narrow && i % 2) continue;
    const x = rd(x0 + (ww * i) / 4);
    s += `<path class="cg" d="M${x} ${top}V${top + ks.length * rh}"/><text class="ca" x="${x}" y="${top + H - 3}" text-anchor="${i === 4 ? 'end' : 'middle'}">${i === 4 ? '今' : `−${fmtDur((sec * (4 - i)) / 4)}`}</text>`;
  }
  const rows: Row[] = [];
  ks.forEach((k, j) => {
    const yc = top + rh / 2 + j * rh,
      f = stF(k),
      pxPer = ((2 * halfT(k)) / win) * ww,
      band = pxPer < MIN_CYCLE_PX;
    rows.push({ k, yc, band });
    s += `<rect class="hl" data-hl="${k}" x="2" y="${yc - rh / 2 + 1}" width="${W - 4}" height="${rh - 2}" rx="4"/>`;
    s += `<g transform="translate(${-o} 0)">`;
    if (!narrow) s += `<text class="lb" x="30" y="${yc + 5}" text-anchor="end">${k ? `${k} 段` : '水晶'}</text>`;
    if (k === 0) {
      const O = osc(50, yc - 8, 18);
      s += `${O.s}<g data-q="0"><path class="w" d="M${O.xo} ${yc - 8}H${LW + o - 4}"/>${ah(LW + o, yc - 8, 0, 'ah')}<circle class="dot" cx="${O.xr}" cy="${yc - 8}" r="2"/><circle class="dot" cx="88" cy="${yc - 8}" r="2"/></g>`;
    } else {
      s += `<g data-q="${k}"><path class="w" d="M84 ${yc - 5}H${LW + o - 4}"/>${ah(LW + o, yc - 5, 0, 'ah')}</g>`;
      s += `<rect class="bx" x="46" y="${yc - bh}" width="38" height="${2 * bh}" rx="2"/><text class="bt" x="62" y="${yc + 1}" text-anchor="middle">T</text>`;
      s += `<path class="tri" d="M46 ${yc + bh - 10}L52 ${yc + bh - 6}L46 ${yc + bh - 2}"/>`;
    }
    /* 次の段のクロックへ（段は反転出力、水晶はそのまま） */
    const nx = ks[j + 1];
    if (nx === k + 1) {
      const cy = yc + rh + bh - 6,
        xq = k ? 92 : 88;
      if (k) s += `<circle class="bub" cx="87" cy="${yc + 5}" r="3"/>`;
      s += `<g data-n="${k}"><path class="w" d="M${k ? 90 : 88} ${k ? yc + 5 : yc - 8}H${xq}V${yc + rh / 2}H36V${cy}H39"/>${ah(45, cy, 0, 'ah')}</g>`;
    }
    /* 先頭の段へは、上の段（図にない段）から入る */
    if (j === 0 && k > 0) {
      const cy = yc + bh - 6;
      s += `<g data-n="${k - 1}"><path class="w" d="M36 ${yc - rh / 2 + 2}V${cy}H39"/>${ah(45, cy, 0, 'ah')}</g>`;
    }
    s += '</g>';
    const yh = yc - bh + 2,
      yl = yc + bh - 2;
    if (band) s += `<rect class="hb" x="${rd(x0)}" y="${yh}" width="${rd(ww)}" height="${yl - yh}"/>`;
    else s += `<path class="cw" data-wv="${k}" d=""/>`;
    /* ランプ・周波数・割る数・音 */
    s += `<circle class="ledc" data-r="${k}" cx="${xe + 12}" cy="${yc}" r="7"/>`;
    s += `<text class="v" x="${xe + 25}" y="${yc - 1}">${fmtHz(f)}<tspan class="u" dx="${narrow ? 2 : 4}">Hz</tspan></text>`;
    s += `<text class="sm" x="${xe + 25}" y="${yc + 16}">${k ? `1/${2 ** k}` : ''}</text>`;
    s += spk(W - 30, yc - 12, k, sndOn.has(k), !(sp > 0 && f * sp <= AUDIBLE_HZ));
  });
  return { s, H, geo: { x0, ww, bh, win, rows } };
}

/** 図の全体。W は幅 [px]、sp は速さ、sndOn は鳴らしている段 */
export function figSvg(W: number, sp: number, sndOn: ReadonlySet<number>): { svg: string; geo: Ladder } {
  const wt = winTop(sp);
  const C = lampChain(W, 8, wt);
  let s = C.s,
    y = C.H;
  const D = clockDisplay(W, y, C.end);
  s += D.s;
  y += D.H + 14;
  const ks = `${wt ? `${wt} 段` : '水晶'}〜${wt + ROWS - 1} 段の波形`;
  s += `<path class="cg" d="M8 ${y}H${W - 8}"/><text class="lb" x="8" y="${y + 24}">${ks}</text>`;
  const L = ladder(W, y + 36, sp, sndOn);
  s += L.s;
  y += 36 + L.H;
  const svg = `<svg class="ct-fg" viewBox="0 0 ${W} ${rd(y)}" width="${W}" height="${rd(y)}" role="group" aria-label="水晶発振から 15 段の T フリップフロップで 1 Hz を作り、時・分・秒を数える時計の図"><defs><pattern id="ct-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path class="hp" d="M0 0V6"/></pattern></defs>${s}</svg>`;
  return { svg, geo: L.geo };
}

/** 段 k の波形の d。右端が時刻 t1 */
export function wavePath(k: number, t1: number, g: Ladder, yc: number): string {
  const t0 = t1 - g.win,
    yh = yc - g.bh + 2,
    yl = yc + g.bh - 2;
  const X = (t: number) => rd(g.x0 + ((t - t0) / g.win) * g.ww);
  const h = halfT(k);
  let d = `M${X(t0)} ${qv(k, t0) ? yh : yl}`;
  for (let e = Math.floor(t0 / h) + 1; e * h <= t1; e++) d += `H${X(e * h)}V${qv(k, e * h + h / 2) ? yh : yl}`;
  return `${d}H${X(t1)}`;
}

/* ---------- こまごとの塗り直し（ブラウザ） ---------- */
/** 桁上げの矢印を光らせる時間 [ms] */
const FLASH_MS = 250;

export class FigView {
  private geo: Ladder | null = null;
  private sp = 1;
  private lamps: (SVGElement | null)[] = [];
  private segs: SVGElement[][] = [];
  private carries: SVGElement[] = [];
  private flashAt = [0, 0, 0, 0];
  private prev: number[] | null = null;
  private ck: SVGElement | null = null;
  private rowEls: { k: number; yc: number; wv: SVGPathElement | null; led: SVGElement; q: SVGElement | null }[] = [];
  private nexts: { k: number; el: SVGElement }[] = [];
  private inEl: SVGTextElement | null = null;
  private inV = -1;

  constructor(private readonly host: HTMLElement) {}

  /** 図を作り直す。スピーカーのフォーカスは同じ段へ戻す */
  build(W: number, sp: number, sndOn: ReadonlySet<number>): void {
    const fk = (document.activeElement as HTMLElement | null)?.closest?.('[data-snd]')?.getAttribute('data-snd');
    const { svg, geo } = figSvg(W, sp, sndOn);
    this.host.innerHTML = svg;
    this.geo = geo;
    this.sp = sp;
    const q = <T extends Element = SVGElement>(s: string) => this.host.querySelector<T>(s);
    this.lamps = Array.from({ length: STAGES + 1 }, (_, i) => q(`[data-l="${i}"]`));
    this.segs = Array.from({ length: 6 }, (_, g) => [...this.host.querySelectorAll<SVGElement>(`[data-g="${g}"]`)]);
    this.carries = [...this.host.querySelectorAll<SVGElement>('[data-cy]')];
    this.ck = q('[data-ck]');
    this.rowEls = geo.rows.map((r) => ({
      k: r.k,
      yc: r.yc,
      wv: q<SVGPathElement>(`[data-wv="${r.k}"]`),
      led: q(`[data-r="${r.k}"]`) as SVGElement,
      q: q(`[data-q="${r.k}"]`),
    }));
    this.nexts = [...this.host.querySelectorAll<SVGElement>('[data-n]')].map((el) => ({ k: Number(el.dataset.n), el }));
    this.inEl = q<SVGTextElement>('[data-in]');
    this.inV = -1;
    this.prev = null;
    if (fk != null) q<SVGGElement>(`[data-snd="${fk}"]`)?.focus();
  }

  /** スピーカーの表示だけ替える */
  setSnd(sndOn: ReadonlySet<number>): void {
    for (const g of this.host.querySelectorAll<SVGGElement>('[data-snd]')) {
      const on = sndOn.has(Number(g.dataset.snd));
      g.classList.toggle('on', on);
      g.setAttribute('aria-pressed', String(on));
    }
  }

  /** 時刻 t の値で塗る。now は performance.now() */
  paint(t: number, now: number): void {
    const g = this.geo;
    if (!g) return;
    const sp = this.sp;
    /* ランプ: 1 秒に 6 回より速い段は半分の明るさ */
    const lit = (el: Element | null, k: number) => {
      if (!el) return;
      const blur = stF(k) * sp > BLUR_HZ;
      el.classList.toggle('blur', blur);
      el.classList.toggle('on', !blur && qv(k, t) === 1);
    };
    for (const [k, el] of this.lamps.entries()) lit(el, k);
    if (this.ck) this.ck.classList.toggle('on', stF(STAGES) * sp <= BLUR_HZ && qv(STAGES, t) === 1);
    for (const r of this.rowEls) {
      lit(r.led, r.k);
      lit(r.q, r.k);
      if (r.wv) r.wv.setAttribute('d', wavePath(r.k, t, g, r.yc));
    }
    /* 次の段のクロック: 段は反転出力、水晶はそのまま */
    for (const { k, el } of this.nexts) {
      const blur = stF(k) * sp > BLUR_HZ,
        v = k ? 1 - qv(k, t) : qv(0, t);
      el.classList.toggle('blur', blur);
      el.classList.toggle('on', !blur && v === 1);
    }
    /* 7 セグメントと桁上げ */
    const dg = digits(t);
    this.segs.forEach((ps, i) => {
      const on = SEG7[dg[i]];
      for (const p of ps) p.classList.toggle('on', on.includes(p.dataset.c ?? ''));
    });
    if (this.prev)
      for (let j = 0; j < 4; j++) if (dg[5 - j] !== this.prev[5 - j] && dg[5 - j] === 0) this.flashAt[j] = now;
    this.prev = dg;
    this.carries.forEach((el, j) => {
      el.classList.toggle('on', now - this.flashAt[j] < FLASH_MS);
    });
    const n = inSecond(t);
    if (this.inEl && n !== this.inV) {
      this.inV = n;
      this.inEl.textContent = String(n);
    }
  }

  /** 段 k のランプと波形の行を少しの間だけ枠で囲む（CSS のアニメーションで消す） */
  flash(k: number): void {
    for (const el of this.host.querySelectorAll<SVGElement>(`[data-hl="${k}"]`)) {
      el.classList.remove('on');
      void el.getBoundingClientRect();
      el.classList.add('on');
    }
  }
}
