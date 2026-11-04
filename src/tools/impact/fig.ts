/**
 * 断面の図。天体は実際の円で描き、計算の範囲の中は岩の粒子をつないでなめらかに描く。飛ぶ物は粒で描く。
 * 引いていくと天体全体が見え、さらに引くと飛び去る物まで追える。テーマに依らず同じ色で描く
 */
import { BODIES, type BodyKey, type TargetKey } from './model';
import { fmtLen } from './params';
import { type Run, smooth } from './run';

type RGB = readonly [number, number, number];

const PALS: Record<TargetKey, readonly RGB[]> = {
  rock: [
    [172, 148, 112],
    [140, 120, 94],
    [192, 166, 124],
    [120, 104, 86],
    [160, 136, 102],
    [182, 156, 118],
  ],
  sand: [
    [222, 198, 150],
    [204, 180, 132],
    [232, 210, 164],
    [192, 168, 122],
    [214, 190, 142],
    [226, 202, 156],
  ],
  water: [
    [28, 92, 150],
    [24, 82, 136],
    [34, 104, 164],
    [22, 76, 128],
    [28, 90, 146],
    [32, 98, 156],
  ],
};
const IMPACTOR: RGB = [255, 84, 56];
const SKY: Record<BodyKey, RGB> = {
  earth: [66, 104, 152],
  moon: [6, 7, 11],
  mars: [132, 92, 68],
  venus: [160, 126, 66],
};
const SPACE: RGB = [6, 7, 11];
/** 地殻の下の色（マントルの上と下、核）と、核の始まる深さ（半径に対する割合）。計算は一様な密度で解き、色だけ変える */
const MANTLE_TOP: RGB = [82, 56, 44];
const MANTLE_BOT: RGB = [128, 72, 44];
const CORE: RGB = [176, 108, 56];
const CORE_DEPTH: Record<BodyKey, number> = { earth: 0.455, moon: 0.8, mars: 0.47, venus: 0.5 };
/** 図の高さと幅の比 */
export const RATIO = 0.56;
/** 衝突の前に飛んでくる様子のコマ数 */
export const PRE_N = 12;
/** 圧力の色を出す下限と不透明度。波が通ったあとの小さな揺れは出さない */
const P_MIN = 0.06;
const pressAlpha = (pp: number): number => {
  const u = Math.min(1, (pp - P_MIN) / 0.1);
  return pp <= P_MIN ? 0 : Math.min(0.95, pp ** 0.8 * 1.15) * u * u * (3 - 2 * u);
};
/** 衝突地点の印の色（LED と同じオレンジ） */
const MARK = '#ff8a4c';
/** 大気の上端の目安（スケールハイトの倍数。地球で 100 km） */
const ATM_TOP = 12.5;

/** 表示の範囲: w は横幅 [m]、cx・cy は中心 [m]（衝突点が原点） */
export interface View {
  w: number;
  cx: number;
  cy: number;
}
export const defaultView = (run: Run): View => {
  const D = run.pl.size,
    w = Math.min(3.2 * D, 3.6 * BODIES[run.c.body].R);
  return { w, cx: 0.05 * D * Math.cos((run.c.th * Math.PI) / 180), cy: 0.14 * w * RATIO };
};
export const craterView = (run: Run): View => {
  const v = defaultView(run);
  return { ...v, w: 1.5 * run.pl.size, cy: 0.075 * run.pl.size };
};
export const bodyView = (run: Run): View => {
  const R = BODIES[run.c.body].R;
  return { w: 3.6 * R, cx: 0, cy: -0.55 * R };
};
/** 表示できる横幅の範囲 [m] */
export const zoomLimits = (run: Run): [number, number] => [0.25 * run.pl.size, 400 * BODIES[run.c.body].R];

/** 温度の色と混ぜる割合（0–255 の値ごと） */
const HEAT = (() => {
  const stops = [
    [800, 150, 30, 10],
    [1500, 255, 110, 20],
    [2500, 255, 190, 70],
    [4300, 255, 245, 210],
  ];
  const lut = new Float32Array(256 * 4);
  for (let v = 0; v < 256; v++) {
    const T = 293 + (v / 255) * 4000;
    let [, r, g, b] = stops[0];
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i],
        c = stops[i + 1];
      if (T >= a[0]) {
        const u = Math.min(1, (T - a[0]) / (c[0] - a[0]));
        r = a[1] + (c[1] - a[1]) * u;
        g = a[2] + (c[2] - a[2]) * u;
        b = a[3] + (c[3] - a[3]) * u;
      }
    }
    const w = Math.max(0, Math.min(1, (T - 800) / 700));
    lut.set([r, g, b, w * w * (3 - 2 * w)], v * 4);
  }
  return lut;
})();

/**
 * 時刻 t で温度の値（0–255）がいくつになるか。大きさ s の岩が放射で冷めるとして
 * T = (T0⁻³ + 3kt)^(−1/3)、k = 6εσ / (ρ c s)
 */
function coolTable(t: number, s: number): Uint8Array {
  const k = (6 * 0.9 * 5.67e-8) / (2700 * 1000 * s),
    a = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    const T0 = 293 + (v / 255) * 4000,
      T = (T0 ** -3 + 3 * k * t) ** (-1 / 3);
    a[v] = Math.max(0, Math.round(((T - 293) / 4000) * 255));
  }
  return a;
}

/**
 * 温度の値（0–255）ごとの光の強さ。熱い岩は目に見える光を放つ。放射は T⁴ で強くなる（2000 K で 1、4 で頭打ち）。
 * 約 800 K より低いと目に見えない
 */
const EMIT = (() => {
  const a = new Float32Array(256);
  for (let v = 0; v < 256; v++) {
    const T = 293 + (v / 255) * 4000,
      u = Math.max(0, Math.min(1, (T - 700) / 200));
    a[v] = Math.min(4, (T / 2000) ** 4) * u * u * (3 - 2 * u);
  }
  return a;
})();

/** にじむ光の明るさの上限（0–1）。下の粒が透けて見える程度に抑える */
const GLOW_MAX = 0.42;

/** 粒子ごとの色（少しだけばらつかせる） */
function particleColors(run: Run): Float32Array {
  if (run.col) return run.col;
  const I = run.info;
  if (!I) return new Float32Array(0);
  const pal = PALS[run.c.tgt],
    col = new Float32Array(I.n * 3);
  let seed = 7;
  for (let p = 0; p < I.n; p++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const c = I.band[p] === 8 ? IMPACTOR : pal[I.band[p]],
      j = 1 + (seed / 4294967296 - 0.5) * 0.09;
    col[p * 3] = c[0] * j;
    col[p * 3 + 1] = c[1] * j;
    col[p * 3 + 2] = c[2] * j;
  }
  run.col = col;
  return col;
}

export interface FigOpt {
  /** 圧力の色 */
  showP: boolean;
  /** 一時的なクレーターと文献の式の形の線 */
  showLines: boolean;
  /** 衝突の閃光 */
  flash: boolean;
}

interface Bg {
  key: string;
  rgb: Uint8ClampedArray;
  /** 地下の暗さ */
  dk: Float32Array;
  /** 地殻の下の色と混ぜる割合 */
  mx: Float32Array;
  /** 地殻の下の色（RGB の順） */
  deep: Uint8Array;
  /** 計算の範囲の端で岩を背景へ溶かす割合（1 は粒子だけ） */
  fd: Float32Array;
}
interface Buf {
  n: number;
  cov: Float32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  p: Float32Array;
}

export class CrossFig {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly scr = document.createElement('canvas');
  private readonly wcv = document.createElement('canvas');
  /** にじむ光の画像（図の 4 分の 1 の大きさ） */
  private readonly gcv = document.createElement('canvas');
  private glow: { n: number; r: Float32Array; g: Float32Array; b: Float32Array; t: Float32Array } | null = null;
  private buf: Buf | null = null;
  private bg: Bg | null = null;

  constructor(private readonly cv: HTMLCanvasElement) {
    this.ctx = cv.getContext('2d') as CanvasRenderingContext2D;
  }

  private size(): { W: number; H: number; dpr: number } {
    const w = Math.max(280, Math.round(this.cv.clientWidth || 800)),
      dpr = Math.min(window.devicePixelRatio || 1, 2),
      W = Math.round(w * dpr),
      H = Math.round(W * RATIO);
    if (this.cv.width !== W || this.cv.height !== H) {
      this.cv.width = W;
      this.cv.height = H;
    }
    return { W, H, dpr };
  }

  /** 計算しない条件のとき（図は空だけ） */
  clear(): void {
    const { W, H } = this.size();
    this.ctx.fillStyle = `rgb(${SPACE})`;
    this.ctx.fillRect(0, 0, W, H);
  }

  private buildBg(run: Run, rw: number, rh: number, s: number, Ox: number, Oy: number, key: string): Bg {
    const I = run.info as NonNullable<Run['info']>,
      body = BODIES[run.c.body],
      airy = run.pl.e.kind !== 'none',
      sky = airy ? SKY[run.c.body] : SPACE,
      pal = PALS[run.c.tgt],
      { bandH, D, R } = I,
      hw = I.Rw / 2,
      dep = I.nyB * I.dx,
      /* 範囲の外側の部分は下に岩を描いて、粒子を溶かす */
      holeW = hw - 0.7 * I.swW,
      holeD = dep - 0.7 * I.swD,
      fadeW = 0.7 * I.swW,
      fadeD = 0.7 * I.swD,
      sub = I.dx / 2,
      smallB = bandH * s < 1.6,
      grain = sub * s >= 1,
      avg = [0, 1, 2].map((k) => pal.reduce((a, c) => a + c[k], 0) / pal.length) as unknown as RGB,
      rgb = new Uint8ClampedArray(rw * rh * 3),
      dk = new Float32Array(rw * rh),
      mx = new Float32Array(rw * rh),
      deep = new Uint8Array(rw * rh * 3),
      fd = new Float32Array(rw * rh).fill(1),
      dR = 0.05 * R,
      coreD = CORE_DEPTH[run.c.body] * R,
      /* 引いて見ても大気が見える厚さを保つ */
      atmS = Math.max(2.5 * body.H, 2 / s),
      inner = Math.min(D, R);
    for (let y = 0; y < rh; y++) {
      const wy = (Oy - y - 0.5) / s,
        yc = wy + R,
        row = y * rw;
      for (let x = 0; x < rw; x++) {
        const wx = (x + 0.5 - Ox) / s,
          h = Math.sqrt(wx * wx + yc * yc) - R,
          id = row + x,
          o = id * 3,
          dd = -h;
        dk[id] = h < 0 ? 1 - 0.42 * (dd > 0.6 * inner ? 1 : dd / (0.6 * inner)) : 1;
        mx[id] = h < 0 ? (dd > dR ? 1 : dd / dR) : 0;
        if (h < 0) {
          /* 核の境はなだらかにする */
          const u = Math.min(1, dd / coreD),
            cm = Math.max(0, Math.min(1, (dd - coreD) / (0.03 * R) + 0.5));
          for (let k = 0; k < 3; k++) {
            const mantle = MANTLE_TOP[k] + (MANTLE_BOT[k] - MANTLE_TOP[k]) * u;
            deep[o + k] = mantle + (CORE[k] - mantle) * cm;
          }
        }
        /* 計算の範囲の中は粒子で描く */
        const inside = wx > -holeW && wx < holeW && wy > -holeD;
        if (h < 2 * I.dx && !inside) {
          const a = Math.min(1, Math.max(0, (hw - Math.abs(wx)) / fadeW)),
            b = Math.min(1, Math.max(0, (dep + wy) / fadeD)),
            m = Math.min(a, b);
          fd[id] = m * m * (3 - 2 * m);
        }
        if (h > 0 || inside) {
          const a = airy ? (h > 0 ? Math.exp(-h / atmS) : 1) : 0,
            /* 地面より深い穴の中は空の色にしない */
            hole = h < 0 ? Math.min(1, -h / (ATM_TOP * body.H)) : 0;
          rgb[o] = (SPACE[0] + (sky[0] - SPACE[0]) * a) * (1 - hole) + 22 * hole;
          rgb[o + 1] = (SPACE[1] + (sky[1] - SPACE[1]) * a) * (1 - hole) + 12 * hole;
          rgb[o + 2] = (SPACE[2] + (sky[2] - SPACE[2]) * a) * (1 - hole) + 10 * hole;
        } else {
          let j = 1,
            off = 0;
          if (grain) {
            const hs = ((Math.floor(wx / sub) * 73856093) ^ (Math.floor(dd / sub) * 19349663)) >>> 0,
              nz = ((hs * 2654435761) >>> 0) / 4294967296 - 0.5;
            j = 1 + nz * 0.09;
            off = nz * sub;
          }
          const c = smallB ? avg : pal[((Math.floor((dd + off) / bandH) % 6) + 6) % 6],
            m = mx[id],
            sh = dk[id] * j;
          rgb[o] = c[0] * sh * (1 - m) + deep[o] * m;
          rgb[o + 1] = c[1] * sh * (1 - m) + deep[o + 1] * m;
          rgb[o + 2] = c[2] * sh * (1 - m) + deep[o + 2] * m;
        }
      }
    }
    return { key, rgb, dk, mx, deep, fd };
  }

  /** 範囲の外まで伝わる波を小さな画像にする（上が地面の側） */
  private drawWave(run: Run, wf: Uint8Array, pFade: number): void {
    const I = run.info as NonNullable<Run['info']>,
      w = I.wave as NonNullable<NonNullable<Run['info']>['wave']>,
      hw = I.Rw / 2,
      dep = I.nyB * I.dx,
      fW = 0.7 * I.swW,
      fD = 0.7 * I.swD;
    if (this.wcv.width !== w.nx || this.wcv.height !== w.ny) {
      this.wcv.width = w.nx;
      this.wcv.height = w.ny;
    }
    const ctx = this.wcv.getContext('2d') as CanvasRenderingContext2D,
      img = ctx.createImageData(w.nx, w.ny),
      d = img.data;
    for (let j = 0; j < w.ny; j++) {
      /* 配列は下から上へ、画像は上から下へ */
      const y = w.y0 + (j + 0.5) * w.dg,
        row = (w.ny - 1 - j) * w.nx;
      for (let i = 0; i < w.nx; i++) {
        const lv = wf[j * w.nx + i];
        if (!lv) continue;
        const x = w.x0 + (i + 0.5) * w.dg,
          /* 範囲の内側は粒子の色に任せる */
          a0 = Math.min(1, Math.max(0, (hw - Math.abs(x)) / fW)),
          b0 = Math.min(1, Math.max(0, (dep + y) / fD)),
          m = Math.min(a0, b0),
          inner = m * m * (3 - 2 * m),
          pp = (lv / 63) * pFade,
          al = pressAlpha(pp) * (1 - inner),
          o = (row + i) * 4;
        d[o] = pp < 0.5 ? 40 + 100 * pp : 90 + 330 * (pp - 0.5);
        d[o + 1] = pp < 0.5 ? 90 + 220 * pp : 200 + 110 * (pp - 0.5);
        d[o + 2] = pp < 0.5 ? 190 + 130 * pp : 255;
        d[o + 3] = al * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /** fi はコマの番号（小数はコマの間を補う。負は衝突の前） */
  draw(run: Run, fi: number, view: View, opt: FigOpt): void {
    const I = run.info;
    if (!I) return;
    const { W, H, dpr } = this.size(),
      ctx = this.ctx,
      rw = Math.min(W, 900),
      rh = Math.round(rw * RATIO),
      nb = rw * rh;
    if (!this.buf || this.buf.n !== nb)
      this.buf = {
        n: nb,
        cov: new Float32Array(nb),
        r: new Float32Array(nb),
        g: new Float32Array(nb),
        b: new Float32Array(nb),
        p: new Float32Array(nb),
      };
    const { cov, r: br, g: bg, b: bb, p: bp } = this.buf;
    cov.fill(0);
    br.fill(0);
    bg.fill(0);
    bb.fill(0);
    bp.fill(0);
    const scr = this.scr;
    if (scr.width !== rw || scr.height !== rh) {
      scr.width = rw;
      scr.height = rh;
    }
    const s = rw / view.w,
      Ox = rw / 2 - view.cx * s,
      Oy = rh / 2 + view.cy * s,
      frames = run.frames,
      i0 = Math.max(0, Math.min(frames.length - 1, Math.floor(fi))),
      i1 = Math.min(frames.length - 1, i0 + 1),
      u = fi < 0 ? 0 : Math.max(0, Math.min(1, fi - i0)),
      f = frames[i0],
      g = frames[i1],
      Rk = Math.max(1.5, I.dx * s * 0.62),
      spacing = (I.dx / 2) * s,
      thr = 0.45 * Math.max((Math.PI * Rk * Rk) / (3 * spacing * spacing), 0.45),
      col = particleColors(run),
      D = I.D,
      airy = run.pl.e.kind !== 'none',
      tNow = fi < 0 || !f ? 0 : f.t + (g.t - f.t) * u,
      /* 粒子の圧力の色は波が範囲を抜けたら消す。外へ伝わる波はもう少し残す */
      pFade = tNow < 0.25 * I.Tg ? 1 : Math.max(0, 1 - (tNow - 0.25 * I.Tg) / (0.35 * I.Tg)),
      wFade = tNow < 0.8 * I.Tg ? 1 : Math.max(0, 1 - (tNow - 0.8 * I.Tg) / (0.7 * I.Tg)),
      /* 温度の冷め方: 破片と溶けた岩は放射で冷める */
      coolDust = coolTable(tNow, Math.max(run.pl.size / 300, 0.5)),
      coolRock = coolTable(tNow, run.pl.size / 10),
      dust: number[] = [],
      gw = Math.ceil(rw / 4),
      gh = Math.ceil(rh / 4);
    if (!this.glow || this.glow.n !== gw * gh)
      this.glow = {
        n: gw * gh,
        r: new Float32Array(gw * gh),
        g: new Float32Array(gw * gh),
        b: new Float32Array(gw * gh),
        t: new Float32Array(gw * gh),
      };
    const { r: lr, g: lg, b: lb, t: lt } = this.glow;
    lr.fill(0);
    lg.fill(0);
    lb.fill(0);
    let lit = false;
    /** 熱い物の光を足す。v は温度の値の 4 倍 */
    const shine = (X: number, Y: number, v: number, gainE: number) => {
      const e = EMIT[v >> 2];
      if (e === 0) return;
      const cx = Math.floor(X / 4),
        cy = Math.floor(Y / 4);
      if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) return;
      const id = cy * gw + cx,
        k = (e * gainE) / 255;
      lr[id] += HEAT[v] * k;
      lg[id] += HEAT[v + 1] * k;
      lb[id] += HEAT[v + 2] * k;
      lit = true;
    };
    const splat = (X: number, Y: number, Rp: number, cr: number, cg: number, cb: number, pl: number) => {
      const iR = Math.ceil(Rp),
        iR2 = 1 / (Rp * Rp);
      if (X < -iR || Y < -iR || X > rw + iR || Y > rh + iR) return;
      const x0 = Math.max(0, Math.floor(X - iR)),
        x1 = Math.min(rw - 1, Math.ceil(X + iR)),
        y0 = Math.max(0, Math.floor(Y - iR)),
        y1 = Math.min(rh - 1, Math.ceil(Y + iR));
      for (let yy = y0; yy <= y1; yy++) {
        const dy = yy + 0.5 - Y,
          row = yy * rw;
        for (let xx = x0; xx <= x1; xx++) {
          const dxx = xx + 0.5 - X,
            d = (dxx * dxx + dy * dy) * iR2;
          if (d >= 1) continue;
          const k = (1 - d) * (1 - d),
            id = row + xx;
          cov[id] += k;
          br[id] += k * cr;
          bg[id] += k * cg;
          bb[id] += k * cb;
          bp[id] += k * pl;
        }
      }
    };
    if (f) {
      const q = I.dx / 16,
        { xy: xa, heat: ht, pr, jv, landN } = f,
        xb = g.xy,
        band = I.band,
        same = xa === xb;
      for (let p = 0; p < I.n; p++) {
        const ax = xa[p * 2];
        if (ax === -32768 || (fi < 0 && band[p] === 8)) continue;
        let sx = ax,
          hy = xa[p * 2 + 1];
        if (!same && xb[p * 2] !== -32768) {
          sx += (xb[p * 2] - ax) * u;
          hy += (xb[p * 2 + 1] - hy) * u;
        }
        const X = Ox + sx * q * s,
          Y = Oy - hy * q * s,
          sized = I.coarse[p] ? 2 : 1,
          v = coolRock[ht[p]] * 4,
          w = HEAT[v + 3],
          cr = col[p * 3] * (1 - w) + HEAT[v] * w,
          cg = col[p * 3 + 1] * (1 - w) + HEAT[v + 1] * w,
          cb = col[p * 3 + 2] * (1 - w) + HEAT[v + 2] * w;
        if (pr[p] >> 6) {
          shine(X, Y, v, 5);
          dust.push(X, Y, cr, cg, cb, v);
          continue;
        }
        shine(X, Y, v, 0.5);
        /* ふくらんだ岩は半径を広げ、すき間を出さない */
        const grow = jv[p] > 64 ? Math.sqrt(Math.sqrt(jv[p] / 64)) : 1;
        splat(X, Y, Rk * grow * sized, cr, cg, cb, ((pr[p] & 63) / 63) * pFade);
      }
      const near = I.dx * s > 2.5,
        land = run.land;
      for (let i = 0; i < landN; i += 4) {
        const id = land[i],
          small = id >= I.n,
          p = small ? I.fragPar[id - I.n] : id,
          X = Ox + land[i + 1] * s,
          Y = Oy - land[i + 2] * s,
          v = coolDust[land[i + 3] | 0] * 4,
          w = HEAT[v + 3],
          cr = col[p * 3] * (1 - w) + HEAT[v] * w,
          cg = col[p * 3 + 1] * (1 - w) + HEAT[v + 1] * w,
          cb = col[p * 3 + 2] * (1 - w) + HEAT[v + 2] * w;
        shine(X, Y, v, 2);
        if (near && !small) splat(X, Y, Rk * 1.1, cr, cg, cb, 0);
        else dust.push(X, Y, cr, cg, cb, v);
      }
    }
    const key = `${view.w}:${view.cx}:${view.cy}:${rw}:${run.c.body}:${run.c.tgt}:${airy}:${D}:${I.dx}`;
    if (!this.bg || this.bg.key !== key) this.bg = this.buildBg(run, rw, rh, s, Ox, Oy, key);
    const img = new ImageData(rw, rh),
      d = img.data,
      { rgb, dk, mx, deep, fd } = this.bg,
      lo = thr * 0.7,
      hiInv = 1 / (thr * 0.5);
    for (let id = 0; id < nb; id++) {
      const c = cov[id],
        o = id * 4,
        o3 = id * 3,
        sr = rgb[o3],
        sg = rgb[o3 + 1],
        sb = rgb[o3 + 2];
      d[o + 3] = 255;
      if (c <= lo) {
        d[o] = sr;
        d[o + 1] = sg;
        d[o + 2] = sb;
        continue;
      }
      const a = Math.min(1, (c - lo) * hiInv) * fd[id],
        ic = 1 / c,
        sh = dk[id],
        m = mx[id];
      let rr = br[id] * ic * sh * (1 - m) + deep[o3] * m,
        gg = bg[id] * ic * sh * (1 - m) + deep[o3 + 1] * m,
        bl = bb[id] * ic * sh * (1 - m) + deep[o3 + 2] * m;
      if (opt.showP) {
        const pp = bp[id] * ic;
        if (pp > P_MIN) {
          /* 濃い青 → 水色 → 白 */
          const al = pressAlpha(pp),
            qr = pp < 0.5 ? 40 + 100 * pp : 90 + 330 * (pp - 0.5),
            qg = pp < 0.5 ? 90 + 220 * pp : 200 + 110 * (pp - 0.5),
            qb = pp < 0.5 ? 190 + 130 * pp : 255;
          rr += (qr - rr) * al;
          gg += (qg - gg) * al;
          bl += (qb - bl) * al;
        }
      }
      d[o] = sr + (rr - sr) * a;
      d[o + 1] = sg + (gg - sg) * a;
      d[o + 2] = sb + (bl - sb) * a;
    }
    /* 飛ぶ物: 粒。引いて見ても見えるように大きさの下限を 2 画素にして、明るくする */
    const far = I.dx * s < 1.5,
      sz = far ? 2 : Math.max(2, Math.min(3, Math.round(Rk * 0.38))),
      gain = far ? 1.5 : 1,
      dot = (X0: number, Y0: number, cr0: number, cg0: number, cb0: number, v: number) => {
        /* 熱いほど明るく、大きく描く */
        const e = EMIT[v >> 2],
          sz2 = e > 1 ? sz + 1 : sz,
          /* 引いた図の持ち上げは光らない粒だけ。光る粒に掛けると温度の差が白く飛ぶ */
          lum = e > 0.05 ? 1 + 0.2 * Math.min(e, 2) : gain,
          X = Math.round(X0),
          Y = Math.round(Y0);
        if (X < 0 || Y < 0 || X + sz2 >= rw || Y + sz2 >= rh) return;
        for (let yy = Y; yy < Y + sz2; yy++) {
          for (let xx = X; xx < X + sz2; xx++) {
            const o = (yy * rw + xx) * 4;
            d[o] += (cr0 * lum - d[o]) * 0.85;
            d[o + 1] += (cg0 * lum - d[o + 1]) * 0.85;
            d[o + 2] += (cb0 * lum - d[o + 2]) * 0.85;
          }
        }
      };
    for (let i = 0; i < dust.length; i += 6)
      dot(dust[i], dust[i + 1], dust[i + 2], dust[i + 3], dust[i + 4], dust[i + 5]);
    if (f && fi >= 0) {
      const A = f.air,
        Bl = g.air,
        VR = Math.max(3, I.dx * s * 1.5),
        iV = 1 / (VR * VR);
      let j = 0;
      for (let i = 0; i < A.length; i += 5) {
        const pid = A[i],
          p = pid >= I.n ? I.fragPar[pid - I.n] : pid;
        while (j < Bl.length && Bl[j] < pid) j += 5;
        let wx = A[i + 1],
          wy = A[i + 2],
          mx0 = 0,
          my0 = 0;
        if (j < Bl.length && Bl[j] === pid) {
          mx0 = (Bl[j + 1] - wx) * s;
          my0 = -(Bl[j + 2] - wy) * s;
          wx += (Bl[j + 1] - wx) * u;
          wy += (Bl[j + 2] - wy) * u;
        }
        const X = Ox + wx * s,
          Y = Oy - wy * s;
        if (A[i + 3] === 1) {
          const v = coolDust[A[i + 4] | 0] * 4,
            w = HEAT[v + 3],
            e = EMIT[v >> 2],
            ml = Math.hypot(mx0, my0);
          /* 熱い破片は飛んできた跡に光の筋を引く */
          if (e > 0.05 && ml > 0.5 && X > 16 && Y > 16 && X < rw - 16 && Y < rh - 16) {
            const len = Math.min(14, 2 + ml * 0.6),
              ux = mx0 / ml,
              uy = my0 / ml,
              br2 = Math.min(1, e);
            for (let m = 1; m <= len; m++) {
              const o = (Math.round(Y - uy * m) * rw + Math.round(X - ux * m)) * 4,
                k = br2 * (1 - m / len) * 0.8;
              d[o] += HEAT[v] * k;
              d[o + 1] += HEAT[v + 1] * k;
              d[o + 2] += HEAT[v + 2] * k;
            }
          }
          shine(X, Y, v, 5);
          dot(
            X,
            Y,
            col[p * 3] * (1 - w) + HEAT[v] * w,
            col[p * 3 + 1] * (1 - w) + HEAT[v + 1] * w,
            col[p * 3 + 2] * (1 - w) + HEAT[v + 2] * w,
            v,
          );
          continue;
        }
        /* 蒸発した物: 光を足す */
        if (X < -VR || Y < -VR || X > rw + VR || Y > rh + VR) continue;
        const fade = 1 / (1 + (Math.hypot(wx, wy) / (0.12 * D)) ** 2),
          x0 = Math.max(0, Math.floor(X - VR)),
          x1 = Math.min(rw - 1, Math.ceil(X + VR)),
          y0 = Math.max(0, Math.floor(Y - VR)),
          y1 = Math.min(rh - 1, Math.ceil(Y + VR));
        for (let yy = y0; yy <= y1; yy++) {
          for (let xx = x0; xx <= x1; xx++) {
            const dd = ((xx - X) ** 2 + (yy - Y) ** 2) * iV;
            if (dd >= 1) continue;
            const k = (1 - dd) * (1 - dd) * fade,
              o = (yy * rw + xx) * 4;
            d[o] += 70 * k;
            d[o + 1] += 44 * k;
            d[o + 2] += 18 * k;
          }
        }
      }
    }
    scr.getContext('2d')?.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(scr, 0, 0, W, H);
    /* 熱い物のまわりににじむ光 */
    if (lit) {
      const blur = (a: Float32Array) => {
        for (let pass = 0; pass < 2; pass++) {
          for (let y = 0; y < gh; y++) {
            const row = y * gw;
            for (let x = 0; x < gw; x++) {
              let sum = 0;
              for (let k = -2; k <= 2; k++) sum += a[row + Math.max(0, Math.min(gw - 1, x + k))];
              lt[row + x] = sum / 5;
            }
          }
          for (let x = 0; x < gw; x++) {
            for (let y = 0; y < gh; y++) {
              let sum = 0;
              for (let k = -2; k <= 2; k++) sum += lt[Math.max(0, Math.min(gh - 1, y + k)) * gw + x];
              a[y * gw + x] = sum / 5;
            }
          }
        }
      };
      blur(lr);
      blur(lg);
      blur(lb);
      const gcv = this.gcv;
      if (gcv.width !== gw || gcv.height !== gh) {
        gcv.width = gw;
        gcv.height = gh;
      }
      const gc = gcv.getContext('2d') as CanvasRenderingContext2D,
        gi = gc.createImageData(gw, gh),
        gd = gi.data;
      for (let id = 0; id < gw * gh; id++) {
        const o = id * 4,
          m = Math.max(lr[id], lg[id], lb[id]);
        gd[o + 3] = 255;
        if (m <= 0) continue;
        /* 重なっても白く飛ばさず、GLOW_MAX で頭打ちにする。青い空に足しても灰色にならないよう暖色へ寄せる */
        const k = (255 * GLOW_MAX * (1 - Math.exp(-m))) / m;
        gd[o] = lr[id] * k;
        gd[o + 1] = lg[id] * k * 0.8;
        gd[o + 2] = lb[id] * k * 0.3;
      }
      gc.putImageData(gi, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(gcv, 0, 0, (gw * 4 * W) / rw, (gh * 4 * H) / rh);
      ctx.globalCompositeOperation = 'source-over';
    }

    /* 重ねて描く物 */
    const sc = W / view.w,
      ox = W / 2 - view.cx * sc,
      oy = H / 2 + view.cy * sc,
      wave = I.wave,
      wf = f?.wave,
      th = (run.c.th * Math.PI) / 180,
      cth = Math.cos(th),
      sth = Math.sin(th),
      body = BODIES[run.c.body],
      rr = Math.max((run.c.L / 2) * sc, 3 * dpr),
      tPen = run.c.L / run.pl.vS;
    ctx.save();
    /* 計算の範囲の外まで伝わる波。範囲の内側は粒子の圧力の色と入れ替わる */
    if (opt.showP && wave && wf && wFade > 0 && fi >= 0) {
      this.drawWave(run, wf, wFade);
      ctx.save();
      ctx.beginPath();
      ctx.arc(ox, oy + I.R * sc, I.R * sc, 0, 2 * Math.PI);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        this.wcv,
        ox + wave.x0 * sc,
        oy - (wave.y0 + wave.ny * wave.dg) * sc,
        wave.nx * wave.dg * sc,
        wave.ny * wave.dg * sc,
      );
      ctx.restore();
    }
    /* 大気の上端の目安 */
    if (airy) {
      const zTop = ATM_TOP * body.H,
        cy0 = oy + I.R * sc,
        rad = (I.R + zTop) * sc,
        /* 図の上の方に一番近い円の上の点へ札を置く */
        /* 衝突地点の印と重ならないよう、図の上の方の円の上で少しずらす */
        a = Math.atan2(W / 2 - ox + 0.22 * W, cy0 - H * 0.16),
        lx = ox + rad * Math.sin(a),
        ly = cy0 - rad * Math.cos(a);
      if (rad < 1e7 && lx > 0 && lx < W && ly > 0 && ly < H) {
        ctx.strokeStyle = 'rgb(180 210 240 / .55)';
        ctx.lineWidth = dpr;
        ctx.setLineDash([5 * dpr, 5 * dpr]);
        ctx.beginPath();
        ctx.arc(ox, cy0, rad, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgb(200 225 250 / .9)';
        ctx.textAlign = 'center';
        ctx.font = `${11 * dpr}px system-ui,sans-serif`;
        if (rad > 130 * dpr)
          ctx.fillText(
            `大気の上端の目安（高度 ${fmtLen(zTop)}）`,
            Math.max(90 * dpr, Math.min(W - 90 * dpr, lx)),
            ly - 5 * dpr,
          );
      }
    }
    /* 衝突体の尾: 大気の中だけに残る。先が細く、衝突のあとは煙のように広がりながら薄れる */
    if (airy) {
      const zTop = ATM_TOP * body.H,
        path = zTop / Math.max(sth, 0.1),
        dist = fi < 0 ? Math.max(view.w, D * 2) * 0.62 * (-fi / PRE_N) : 0,
        fade = fi < 0 ? 1 : Math.max(0, 1 - tNow / (0.6 * I.Tg));
      if (fade > 0 && dist < path) {
        /* 見える長さ: 図の幅より長くても、先の方は図の外へ細く消える */
        const len = Math.min(path - dist, Math.max(view.w * 0.9, 12 * run.c.L)),
          bx = ox - cth * dist * sc,
          by = oy - sth * dist * sc,
          tx = bx - cth * len * sc,
          ty = by - sth * len * sc,
          nx = sth,
          ny = -cth,
          spread = 1 + 3 * (1 - fade),
          w0 = rr * 0.9 * spread,
          w1 = rr * 0.12 * (1 + 8 * (1 - fade)),
          gr = ctx.createLinearGradient(bx, by, tx, ty),
          al = fade * fade,
          /* 衝突の前は熱い色、あとは灰色の煙へ */
          k = 1 - fade,
          r0 = Math.round(255 - 70 * k),
          g0 = Math.round(205 - 30 * k),
          b0 = Math.round(140 + 30 * k);
        if (fi >= 0) {
          /* 衝突のあとは地面の近くから消える */
          gr.addColorStop(0, `rgb(${r0} ${g0} ${b0} / 0)`);
          gr.addColorStop(0.1, `rgb(${r0} ${g0} ${b0} / ${0.5 * al})`);
        } else gr.addColorStop(0, `rgb(${r0} ${g0} ${b0} / ${0.5 * al})`);
        gr.addColorStop(0.4, `rgb(${r0} ${Math.round(g0 * 0.8)} ${Math.round(b0 * 0.75)} / ${0.22 * al})`);
        gr.addColorStop(1, `rgb(${r0} ${Math.round(g0 * 0.7)} ${Math.round(b0 * 0.6)} / 0)`);
        ctx.fillStyle = gr;
        /* 幅を変えて重ね、縁をぼかす */
        for (const m of [1, 0.75, 0.5, 0.25]) {
          ctx.beginPath();
          ctx.moveTo(bx + nx * w0 * m, by + ny * w0 * m);
          ctx.lineTo(tx + nx * w1 * m, ty + ny * w1 * m);
          ctx.lineTo(tx - nx * w1 * m, ty - ny * w1 * m);
          ctx.lineTo(bx - nx * w0 * m, by - ny * w0 * m);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
    if (opt.flash && f && fi >= 0 && run.pl.vS > 3000) {
      const uu = 1 - tNow / (0.05 * I.Tg);
      if (uu > 0) {
        const rad = run.pl.size * sc * (0.32 + 0.8 * (1 - uu)),
          gr = ctx.createRadialGradient(ox, oy, 0, ox, oy, rad);
        gr.addColorStop(0, `rgb(255 244 214 / ${uu})`);
        gr.addColorStop(0.35, `rgb(255 170 70 / ${uu * 0.6})`);
        gr.addColorStop(1, 'rgb(255 110 30 / 0)');
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = gr;
        ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.font = `${11 * dpr}px system-ui,sans-serif`;
    const isLast = run.res && i0 === frames.length - 1;
    if (opt.showLines && run.tr?.surf && f && f.t > run.tr.t) {
      ctx.strokeStyle = '#52c4dd';
      ctx.lineWidth = 1.6 * dpr;
      ctx.beginPath();
      const ss = smooth(run.tr.surf);
      let on = false;
      for (let i = 0; i < ss.length; i++) {
        if (ss[i] < -1e8) {
          on = false;
          continue;
        }
        const X = ox + (-I.Rw / 2 + (i + 0.5) * I.dx) * sc,
          Y = oy - ss[i] * sc;
        if (on) ctx.lineTo(X, Y);
        else ctx.moveTo(X, Y);
        on = true;
      }
      ctx.stroke();
    }
    if (opt.showLines && isLast && run.pl.f.Dfr < I.R) {
      const L = run.pl.f,
        RR = L.Dfr / 2,
        xc = run.mt ? run.mt.xc : 0;
      ctx.strokeStyle = '#f2c230';
      ctx.lineWidth = 1.4 * dpr;
      ctx.beginPath();
      for (let i = -160; i <= 160; i++) {
        const a = i / 100,
          y = Math.abs(a) < 1 ? L.hfr - L.dfr * (1 - a * a) : L.hfr * Math.abs(a) ** -3,
          xw = xc + a * RR,
          X = ox + xw * sc,
          Y = oy - (y - (xw * xw) / (2 * I.R)) * sc;
        if (i === -160) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
      }
      ctx.stroke();
    }
    /* 衝突体: 飛んできて、地面にめり込みながら消える */
    if (fi < 0 || tNow < tPen) {
      const dist = fi < 0 ? Math.max(view.w, D * 2) * 0.62 * (-fi / PRE_N) : -run.pl.vS * tNow,
        bx = ox - cth * dist * sc,
        by = oy - sth * dist * sc;
      ctx.globalAlpha = fi < 0 ? 1 : Math.max(0, 1 - tNow / tPen);
      if (airy) {
        const gl = ctx.createRadialGradient(bx, by, rr * 0.6, bx, by, rr * 2.2);
        gl.addColorStop(0, 'rgb(255 190 110 / .85)');
        gl.addColorStop(1, 'rgb(255 120 40 / 0)');
        ctx.fillStyle = gl;
        ctx.beginPath();
        ctx.arc(bx, by, rr * 2.2, 0, 7);
        ctx.fill();
      }
      ctx.fillStyle = `rgb(${IMPACTOR})`;
      ctx.beginPath();
      ctx.arc(bx, by, rr, 0, 7);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    /* クレーターが小さく見えるときの衝突地点の印 */
    const craterPx = (run.mt ? run.mt.D : run.pl.f.Dfr) * sc;
    if (craterPx < 44 * dpr && fi >= 0) {
      const gap = Math.max(craterPx / 2, 3 * dpr) + 3 * dpr,
        tip = oy - gap;
      ctx.strokeStyle = MARK;
      ctx.fillStyle = MARK;
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.arc(ox, oy, gap, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ox, tip);
      ctx.lineTo(ox, tip - 16 * dpr);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.font = `600 ${11.5 * dpr}px system-ui,sans-serif`;
      ctx.fillText('衝突地点', ox, tip - 21 * dpr);
      ctx.font = `${11 * dpr}px system-ui,sans-serif`;
    }
    /* 縮尺 */
    const e10 = 10 ** Math.floor(Math.log10(view.w * 0.18)),
      m10 = (view.w * 0.18) / e10,
      bar = (m10 < 2 ? 1 : m10 < 5 ? 2 : 5) * e10,
      bw = bar * sc,
      bx0 = W - 14 * dpr - bw,
      by0 = 18 * dpr;
    ctx.fillStyle = '#e8e6df';
    ctx.strokeStyle = '#e8e6df';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(bx0, by0);
    ctx.lineTo(bx0 + bw, by0);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillText(fmtLen(bar), bx0 + bw / 2, by0 + 14 * dpr);
    if (run.c.th < 90 && view.w < 12 * D) {
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgb(232 230 223 / .85)';
      ctx.fillText('← 飛んできた側', 10 * dpr, 44 * dpr);
      ctx.textAlign = 'right';
      ctx.fillText('進む側 →', W - 12 * dpr, 50 * dpr);
    }
    if (run.mt && isLast && view.w < 12 * D) {
      const m = run.mt,
        y = oy - m.rim * sc - 18 * dpr,
        xa = ox + m.xL * sc,
        xb = ox + m.xR * sc;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = dpr;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(xa, y - 4 * dpr);
      ctx.lineTo(xa, y + 4 * dpr);
      ctx.moveTo(xa, y);
      ctx.lineTo(xb, y);
      ctx.moveTo(xb, y - 4 * dpr);
      ctx.lineTo(xb, y + 4 * dpr);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.font = `600 ${12.5 * dpr}px system-ui,sans-serif`;
      ctx.fillText(`直径 ${fmtLen(m.D)}`, (xa + xb) / 2, y - 7 * dpr);
    }
    ctx.restore();
  }
}
