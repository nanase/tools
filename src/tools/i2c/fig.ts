/** I2C のページの図（canvas）: 配線図・波形・解読の帯。色はサイトとページの変数から読む */
import { surface } from '../pcm/fig';
import { bin, DEVS, devState, type Frame, hex, idxAt, type Role, roleOf, type Sim, SLAVE0 } from './bus';
import { drawIcon, type IconId } from './icons';

const COL = {
  ch1: '',
  ch2: '',
  ink: '',
  ink3: '',
  screen: '',
  grid: '',
  grid2: '',
  sink: '',
  warn: '',
  surface: '',
  m: '',
  s: '',
  m2: '',
  low: '',
  onm: '',
  ons: '',
  mono: 'monospace',
  sans: 'sans-serif',
};
export function readCols(root: Element): void {
  const c = getComputedStyle(root),
    v = (k: string) => c.getPropertyValue(k).trim();
  Object.assign(COL, {
    ch1: v('--ch1'),
    ch2: v('--ch2'),
    ink: v('--ink'),
    ink3: v('--ink-3'),
    screen: v('--screen'),
    grid: v('--grid'),
    grid2: v('--grid-2'),
    sink: v('--screen-ink'),
    warn: v('--warn'),
    surface: v('--surface'),
    m: v('--i2-m'),
    s: v('--i2-s'),
    m2: v('--i2-m2'),
    low: v('--i2-low'),
    onm: v('--i2-on-m'),
    ons: v('--i2-on-s'),
    mono: v('--mono') || 'monospace',
    sans: v('--sans') || 'sans-serif',
  });
}
const font = (g: CanvasRenderingContext2D, px: number, w = 500, mono = false) => {
  g.font = `${w} ${px}px ${mono ? COL.mono : COL.sans}`;
};
export const roleColor = (r: Role | 'x'): string =>
  r === 'm' ? COL.m : r === 'm2' ? COL.m2 : r === 's' ? COL.s : r === 'x' ? COL.warn : COL.sink;
/** a と b を u で混ぜる（#rrggbb） */
function mix(a: string, b: string, u: number): string {
  const p = (h: string) => {
    const x = h.replace('#', '');
    return x.length === 3
      ? [...x].map((ch) => Number.parseInt(ch + ch, 16))
      : [0, 2, 4].map((i) => Number.parseInt(x.slice(i, i + 2), 16));
  };
  const A = p(a),
    B = p(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * u)).join(',')})`;
}

/* ---------- 波形 ---------- */
interface Row {
  k: 'scl' | 'sda';
  y: number;
  h: number;
}
interface WaveOpt {
  rows: Row[];
  /** 今の位置。これより後は薄く描く */
  pt: number;
  /** VIH・VIL の点線 */
  thr?: boolean;
  /** 線を下げている機器の色の帯 */
  who?: boolean;
  /** 1 クロックごとの縦線 */
  grid?: boolean;
  /** ビットの値の行の y */
  bits?: number;
  /** 解読の帯 */
  band?: { y: number; h: number };
  /** 拡大している範囲の枠 */
  win?: { tA: number; tB: number };
}
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const LEFT = 44;

function wave(g: CanvasRenderingContext2D, s: Sim, box: Box, tA: number, tB: number, o: WaveOpt): void {
  const X = (t: number) => box.x + ((t - tA) / (tB - tA)) * box.w,
    vdd = s.c.vdd;
  if (o.grid && (tB - tA) / s.T < 40) {
    g.strokeStyle = COL.grid;
    g.lineWidth = 1;
    g.beginPath();
    for (let k = Math.ceil(tA / s.T); k * s.T < tB; k++) {
      const x = Math.round(X(k * s.T)) + 0.5;
      g.moveTo(x, box.y);
      g.lineTo(x, box.y + box.h);
    }
    g.stroke();
  }
  const xp = Math.max(box.x, Math.min(box.x + box.w, X(o.pt)));
  for (const row of o.rows) {
    const arr = row.k === 'scl' ? s.vScl : s.vSda,
      drv = row.k === 'scl' ? s.dScl : s.dSda,
      col = row.k === 'scl' ? COL.ch1 : COL.ch2;
    const Y = (v: number) => row.y + row.h - (v / vdd) * row.h;
    if (o.thr) {
      g.setLineDash([3, 4]);
      g.strokeStyle = COL.grid2;
      g.lineWidth = 1;
      g.beginPath();
      for (const v of [s.E.vih, s.E.vil]) {
        const y = Math.round(Y(v)) + 0.5;
        g.moveTo(box.x, y);
        g.lineTo(box.x + box.w, y);
      }
      g.stroke();
      g.setLineDash([]);
      font(g, 12);
      g.fillStyle = COL.sink;
      g.textAlign = 'right';
      g.textBaseline = 'bottom';
      g.fillText('VIH', box.x + box.w - 2, Y(s.E.vih) - 1);
      g.textBaseline = 'top';
      g.fillText('VIL', box.x + box.w - 2, Y(s.E.vil) + 1);
    }
    font(g, 13, 700, true);
    g.fillStyle = col;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(row.k.toUpperCase(), 4, row.y + row.h / 2);
    const at = (i: number) => (i < 0 ? vdd : i >= s.len ? arr[s.len - 1] : arr[i]);
    const path = () => {
      g.beginPath();
      const i0 = Math.floor(tA / s.dt),
        i1 = Math.ceil(tB / s.dt),
        spp = (i1 - i0) / box.w;
      if (spp > 1.5) {
        /* 1 画素に何点も入るときは、その画素の最小と最大を結ぶ */
        for (let px = 0; px <= box.w; px++) {
          const a = i0 + Math.floor(px * spp),
            b = Math.max(a + 1, i0 + Math.floor((px + 1) * spp));
          let lo = Infinity,
            hi = -Infinity;
          for (let i = a; i < b; i++) {
            const v = at(i);
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
          const x = box.x + px;
          if (px === 0) g.moveTo(x, Y(at(a)));
          g.lineTo(x, Y(hi));
          g.lineTo(x, Y(lo));
        }
      } else
        for (let i = i0; i <= i1; i++) {
          const x = X(i * s.dt),
            y = Y(at(i));
          if (i === i0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
    };
    g.strokeStyle = col;
    g.lineWidth = 2;
    g.lineJoin = 'round';
    for (const [x0, x1, a] of [
      [box.x, xp, 1],
      [xp, box.x + box.w, 0.22],
    ] as const) {
      if (x1 <= x0) continue;
      g.save();
      g.globalAlpha = a;
      g.beginPath();
      g.rect(x0, row.y - 4, x1 - x0, row.h + 8);
      g.clip();
      path();
      g.stroke();
      g.restore();
    }
    if (o.who) {
      const yb = row.y + row.h + 4;
      for (let px = 0; px < box.w; px++) {
        const t = tA + ((px + 0.5) / box.w) * (tB - tA);
        if (t > o.pt) break;
        const i = Math.round(t / s.dt);
        if (i < 0 || i >= s.len) continue;
        const r = roleOf(drv[i]);
        if (!r) continue;
        g.fillStyle = roleColor(r);
        g.fillRect(box.x + px, yb, 1.2, 4);
      }
    }
  }
  if (o.bits !== undefined) drawBits(g, s, X, tA, tB, o.bits, o.pt);
  if (o.band) band(g, s, X, tA, tB, o.band, o.pt, box);
  if (o.win) {
    const a = Math.max(box.x, X(o.win.tA)),
      b = Math.min(box.x + box.w, X(o.win.tB));
    g.strokeStyle = COL.ink;
    g.lineWidth = 1.5;
    g.setLineDash([4, 3]);
    g.strokeRect(a + 0.5, box.y + 2.5, Math.max(2, b - a - 1), box.h - 5);
    g.setLineDash([]);
  }
  const x = Math.round(X(o.pt)) + 0.5;
  if (x >= box.x && x <= box.x + box.w) {
    g.strokeStyle = COL.ink;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, box.y);
    g.lineTo(x, box.y + box.h);
    g.stroke();
  }
}

function drawBits(
  g: CanvasRenderingContext2D,
  s: Sim,
  X: (t: number) => number,
  tA: number,
  tB: number,
  y: number,
  pt: number,
): void {
  font(g, 13, 700, true);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  s.frames.forEach((f, i) => {
    if (f.t1 < tA || f.t0 > tB) return;
    if (f.bits)
      for (const b of f.bits) {
        if (b.t < tA || b.t > tB || b.t > pt) continue;
        g.fillStyle = roleColor(f.role ?? 'm');
        g.fillText(String(b.v), X(b.t), y);
      }
    if ((f.k === 'A' || f.k === 'N') && s.frames[i - 1]?.bits) {
      const tb = (f.t0 + f.t1) / 2;
      if (tb > pt) return;
      g.fillStyle = f.k === 'N' ? COL.warn : roleColor(f.role ?? 's');
      g.fillText(f.k === 'A' ? '0' : '1', X(tb), y);
    }
  });
}

/** 解読の帯。終わっていない区切りは破線の枠だけ */
function band(
  g: CanvasRenderingContext2D,
  s: Sim,
  X: (t: number) => number,
  tA: number,
  tB: number,
  b: { y: number; h: number },
  pt: number,
  box: Box,
): void {
  for (const f of s.frames) {
    if (f.t1 < tA || f.t0 > tB || f.t0 > pt) continue;
    if (f.k === 'S' || f.k === 'Sr' || f.k === 'P') {
      const x = X(f.t0);
      if (x < box.x - 12 || x > box.x + box.w + 12) continue;
      g.fillStyle = COL.m;
      g.beginPath();
      g.arc(x, b.y + b.h / 2, b.h / 2 - 1, 0, 2 * Math.PI);
      g.fill();
      font(g, 13, 700);
      g.fillStyle = COL.onm;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(f.k, x, b.y + b.h / 2 + 0.5);
      continue;
    }
    const x0 = Math.max(box.x, X(f.t0)),
      x1 = Math.min(box.x + box.w, X(f.t1)),
      col = f.k === 'junk' || f.k === 'N' ? COL.warn : roleColor(f.role ?? 'm');
    if (pt < f.t1) {
      const xe = Math.min(x1, X(pt));
      if (xe - x0 > 3) {
        g.strokeStyle = col;
        g.lineWidth = 1.5;
        g.setLineDash([3, 3]);
        g.strokeRect(x0 + 1.5, b.y + 1, xe - x0 - 2, b.h - 2);
        g.setLineDash([]);
      }
      continue;
    }
    const w = x1 - x0 - 2;
    if (w < 3) continue;
    if (f.k === 'N') {
      g.strokeStyle = COL.warn;
      g.lineWidth = 2;
      g.strokeRect(x0 + 2, b.y + 1, w - 2, b.h - 2);
    } else {
      g.fillStyle = col;
      g.fillRect(x0 + 1, b.y, w, b.h);
    }
    font(g, 15, 700, f.k === 'addr' || f.k === 'data');
    const t = labels(f).find((x) => g.measureText(x).width < w - 6) ?? '';
    g.fillStyle = f.k === 'N' ? COL.warn : f.k === 'junk' ? COL.surface : f.role === 's' ? COL.ons : COL.onm;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.save();
    g.beginPath();
    g.rect(x0, b.y, x1 - x0, b.h);
    g.clip();
    g.fillText(t, (x0 + x1) / 2, b.y + b.h / 2 + 0.5);
    g.restore();
  }
}
/** 区切りの札（長い順。入る最初のものを使う） */
function labels(f: Frame): string[] {
  const v = f.v ?? 0;
  switch (f.k) {
    case 'addr':
      return [`${hex(v >> 1)} ${v & 1 ? '読み出し' : '書き込み'}`, `${hex(v >> 1)} ${v & 1 ? 'R' : 'W'}`, hex(v >> 1)];
    case 'data':
      return [hex(v)];
    case 'A':
      return ['ACK', 'A'];
    case 'N':
      return ['NACK', 'N'];
    default:
      return ['?'];
  }
}

/** 拡大の範囲。幅 95 px に 1 クロックを目安に 6〜14 クロック、今の位置は左から 55 % */
export function zoomWin(s: Sim, pt: number, w: number): { tA: number; tB: number } {
  const span = Math.max(6, Math.min(14, Math.round(w / 95))) * s.T,
    tA = pt - span * 0.55;
  return { tA, tB: tA + span };
}

/** 通信全体の波形と解読。拡大している範囲を破線の枠で示す */
export function drawWhole(c: HTMLCanvasElement, s: Sim, pt: number, zoomW: number): void {
  const sf = surface(c);
  if (!sf) return;
  sf.g.clearRect(0, 0, sf.w, sf.h);
  /* 2 本の波形は低く描き、下に解読の帯を置く */
  const { g, w, h } = sf,
    rh = (h - 44) / 2;
  wave(g, s, { x: LEFT, y: 0, w: w - LEFT - 8, h }, 0, s.dur, {
    rows: [
      { k: 'scl', y: 6, h: rh - 8 },
      { k: 'sda', y: rh + 6, h: rh - 8 },
    ],
    pt,
    who: true,
    band: { y: h - 30, h: 24 },
    win: zoomWin(s, pt, zoomW),
  });
}
/** 全体の図で押した位置の時刻 */
export const wholeAt = (c: HTMLCanvasElement, s: Sim, clientX: number): number => {
  const r = c.getBoundingClientRect();
  return Math.max(0, Math.min(1, (clientX - r.left - LEFT) / (r.width - LEFT - 8))) * s.dur;
};

/** 今の位置の前後の拡大。VIH・VIL とビットの値つき */
export function drawZoom(c: HTMLCanvasElement, s: Sim, pt: number): void {
  const sf = surface(c);
  if (!sf) return;
  sf.g.clearRect(0, 0, sf.w, sf.h);
  const { g, w, h } = sf,
    { tA, tB } = zoomWin(s, pt, w),
    rh = (h - 76) / 2;
  wave(g, s, { x: LEFT, y: 0, w: w - LEFT - 8, h }, tA, tB, {
    rows: [
      { k: 'scl', y: 10, h: rh - 6 },
      { k: 'sda', y: 14 + rh, h: rh - 6 },
    ],
    pt,
    thr: true,
    who: true,
    grid: true,
    bits: h - 50,
    band: { y: h - 36, h: 26 },
  });
}

/* ---------- 配線図 ---------- */
/** 宛先の照合に使う、今の区切りまでに受け取ったビット */
function heard(s: Sim, pt: number, addrOnly: boolean): { bits: number[]; addr: boolean } {
  let f: Frame | null = null;
  for (const x of s.frames) {
    if (x.t0 > pt) break;
    if (x.k === 'addr' || (!addrOnly && (x.k === 'data' || x.k === 'junk'))) f = x;
    if (x.k === 'S' || x.k === 'Sr') f = null;
  }
  return { bits: (f?.bits ?? []).filter((b) => b.t <= pt).map((b) => b.v), addr: f?.k === 'addr' };
}

/**
 * 電源・プルアップ抵抗・2 本の線と、線にぶら下がる機器。機器ごとに 2 つのスイッチ（オープンドレインの出力）があり、
 * 閉じると線を Low へ下げる。線の色は電圧（High で明るく、Low で暗く）
 */
export function drawBus(c: HTMLCanvasElement, s: Sim, pt: number): void {
  const sf = surface(c);
  if (!sf) return;
  sf.g.clearRect(0, 0, sf.w, sf.h);
  const { g, w, h } = sf,
    i = idxAt(s, pt),
    vdd = s.c.vdd,
    narrow = w < 560;
  const Y = { rail: 18, sda: 42, scl: 60, box: 74 },
    bh = h - Y.box - 2;
  const devs: { i: number; icon: IconId; label: string; name: string; a?: number }[] = [
    { i: 0, icon: 'm', label: `→${hex(s.c.addr)}`, name: s.c.multi ? 'マスタ 1' : 'マスタ' },
  ];
  if (s.c.multi) devs.push({ i: 1, icon: 'm', label: `→${hex(s.masters[1]?.addr ?? 0)}`, name: 'マスタ 2' });
  DEVS.forEach((d, j) => {
    devs.push({ i: SLAVE0 + j, icon: d.k, label: hex(d.a), name: d.name, a: d.a });
  });
  const xL = 52,
    xR = w - 6,
    gap = narrow ? 5 : 10,
    bw = (xR - xL - gap * (devs.length - 1)) / devs.length;
  const vA = s.vSda[i] ?? vdd,
    vC = s.vScl[i] ?? vdd,
    mA = s.dSda[i] ?? 0,
    mC = s.dScl[i] ?? 0;
  const lineCol = (v: number, col: string) => mix(COL.low, col, Math.max(0, Math.min(1, v / vdd)));

  /* 電源とプルアップ抵抗 */
  g.strokeStyle = COL.sink;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(6, Y.rail);
  g.lineTo(xR, Y.rail);
  g.stroke();
  font(g, 12, 700);
  g.fillStyle = COL.sink;
  g.textAlign = 'left';
  g.textBaseline = 'bottom';
  g.fillText(`VDD ${vdd} V`, 6, Y.rail - 3);
  const res = (x: number, y1: number, col: string) => {
    const a = Y.rail + 4,
      b = y1 - 4,
      n = 6;
    g.strokeStyle = col;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, Y.rail);
    g.lineTo(x, a);
    for (let k = 0; k < n; k++) g.lineTo(x + (k % 2 ? -4 : 4), a + ((k + 0.5) / n) * (b - a));
    g.lineTo(x, b);
    g.lineTo(x, y1);
    g.stroke();
  };
  res(14, Y.sda, lineCol(vA, COL.ch2));
  res(30, Y.scl, lineCol(vC, COL.ch1));
  for (const [k, y, v, col, x0] of [
    ['SDA', Y.sda, vA, COL.ch2, 14],
    ['SCL', Y.scl, vC, COL.ch1, 30],
  ] as const) {
    g.strokeStyle = lineCol(v, col);
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(xR, y);
    g.stroke();
    font(g, 13, 700, true);
    g.fillStyle = col;
    g.textAlign = 'left';
    g.textBaseline = 'bottom';
    g.fillText(k, 36, y - 3);
    g.textAlign = 'right';
    g.fillText(`${v.toFixed(2)} V`, xR, y - 3);
  }

  const hd = heard(s, pt, false),
    ha = heard(s, pt, true);
  devs.forEach((d, k) => {
    const bx = xL + k * (bw + gap),
      by = Y.box,
      st = devState(s, d.i, pt),
      isM = d.i < SLAVE0,
      role: Role = d.i === 1 ? 'm2' : isM ? 'm' : 's',
      rc = roleColor(role);
    const off = st === 'skip' || st === 'lost';
    g.globalAlpha = off ? 0.45 : 1;
    /* 通信している機器（宛先のスレーブと、送っているマスタ）は枠を太くし、地を薄く塗る */
    const hot = st === 'match' || st === 'hold' || (isM && st === 'busy');
    g.fillStyle = hot ? mix(COL.surface, rc, 0.14) : COL.surface;
    g.fillRect(bx, by, bw, bh);
    g.strokeStyle = hot ? rc : COL.grid2;
    g.lineWidth = hot ? 2.5 : 1.2;
    if (st === 'skip') g.setLineDash([4, 3]);
    g.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    g.setLineDash([]);
    /* スイッチ: 線から下りて、閉じると地（GND）へつながる */
    const sw = (sx: number, ly: number, pulled: boolean, v: number, col: string) => {
      const lc = lineCol(v, col),
        p = by + 5,
        q = by + 17;
      if (pulled) {
        /* 線を下げている経路（線→スイッチ→地）を機器の色で囲む */
        g.save();
        g.globalAlpha *= 0.3;
        g.fillStyle = rc;
        g.beginPath();
        g.roundRect(sx - 8, ly - 7, 16, q + 13 - ly, 5);
        g.fill();
        g.restore();
      }
      g.fillStyle = pulled ? rc : lc;
      g.beginPath();
      g.arc(sx, ly, pulled ? 5 : 3.5, 0, 2 * Math.PI);
      g.fill();
      g.strokeStyle = pulled ? rc : lc;
      g.lineWidth = pulled ? 3 : 2;
      g.beginPath();
      g.moveTo(sx, ly);
      g.lineTo(sx, p);
      g.stroke();
      g.strokeStyle = pulled ? rc : COL.sink;
      g.lineWidth = pulled ? 3.5 : 2;
      g.beginPath();
      g.moveTo(sx, p);
      if (pulled) g.lineTo(sx, q);
      else g.lineTo(sx + 7, q - 2);
      g.stroke();
      g.strokeStyle = pulled ? rc : COL.sink;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(sx - 6, q + 1);
      g.lineTo(sx + 6, q + 1);
      g.moveTo(sx - 3, q + 5);
      g.lineTo(sx + 3, q + 5);
      g.stroke();
    };
    sw(bx + bw * 0.3, Y.sda, ((mA >> d.i) & 1) === 1, vA, COL.ch2);
    sw(bx + bw * 0.7, Y.scl, ((mC >> d.i) & 1) === 1, vC, COL.ch1);
    /* 図柄とアドレス */
    const iy = by + 27,
      is = narrow ? 18 : 22;
    drawIcon(g, d.icon, bx + 6, iy, is, isM ? rc : COL.ink);
    if (d.i === 1) {
      font(g, 11, 700);
      g.fillStyle = rc;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('2', bx + 6 + is / 2, iy + is / 2);
    }
    font(g, narrow ? 12 : 15, 700, true);
    g.fillStyle = isM ? rc : COL.ink;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    /* アドレス（入らなければ文字を縮める） */
    const lw = g.measureText(d.label).width,
      lroom = bw - is - 14;
    g.save();
    g.translate(bx + 10 + is, iy + is / 2);
    if (lw > lroom) g.scale(lroom / lw, 1);
    g.fillText(d.label, 0, 0);
    g.restore();
    /* 機器の名前（入らなければ文字を縮める） */
    font(g, narrow ? 12 : 13, 700);
    const nw = g.measureText(d.name).width,
      room = bw - 12;
    g.fillStyle = isM ? rc : COL.ink;
    g.save();
    g.translate(bx + 6, iy + is + 10);
    if (nw > room) g.scale(room / nw, 1);
    g.fillText(d.name, 0, 0);
    g.restore();
    /* 状態の印（右上） */
    const badge: [IconId, string] | null =
      st === 'match'
        ? ['ok', COL.s]
        : st === 'hold'
          ? ['hold', COL.s]
          : st === 'lost'
            ? ['lost', COL.warn]
            : st === 'done'
              ? s.res === 'ok' || d.i === 1
                ? ['ok', rc]
                : ['lost', COL.warn]
              : null;
    if (badge && bw > 60) drawIcon(g, badge[0], bx + bw - (narrow ? 16 : 20), by + 4, narrow ? 12 : 15, badge[1], 2.4);
    /* ビットの列: スレーブは自分のアドレスを薄く置き、届いたビットで上書きする（違えば赤） */
    const n = 8,
      cw = Math.min(17, (bw - 10) / n),
      cy = by + bh - 26,
      x0 = bx + (bw - cw * n) / 2,
      digits = cw >= 12;
    const mine = d.a !== undefined ? bin(d.a, 7) : '';
    const bits = !isM && st === 'skip' ? ha.bits : hd.bits,
      cmp = !isM && (hd.addr || st === 'skip');
    for (let b = 0; b < n; b++) {
      const cx = x0 + b * cw,
        has = b < bits.length,
        exp = cmp && b < 7 ? Number(mine[b]) : null,
        bad = has && exp !== null && bits[b] !== exp;
      g.strokeStyle = bad ? COL.warn : COL.grid2;
      g.lineWidth = 1;
      g.strokeRect(cx + 0.5, cy + 0.5, cw - 2, 20);
      if (digits) {
        font(g, 13, 700, true);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        if (has) {
          g.fillStyle = bad ? COL.warn : COL.ink;
          g.fillText(String(bits[b]), cx + cw / 2 - 0.5, cy + 11);
        } else if (exp !== null || (!isM && b < 7 && st === 'idle' && !hd.bits.length)) {
          g.fillStyle = COL.grid2;
          g.fillText(mine[b] ?? '', cx + cw / 2 - 0.5, cy + 11);
        }
      } else if (has && bits[b]) {
        g.fillStyle = bad ? COL.warn : COL.ink;
        g.fillRect(cx + 2, cy + 3, cw - 6, 15);
      } else if (has && bad) {
        g.strokeStyle = COL.warn;
        g.lineWidth = 2;
        g.strokeRect(cx + 2.5, cy + 3.5, cw - 7, 13);
      }
    }
    g.globalAlpha = 1;
  });
}
