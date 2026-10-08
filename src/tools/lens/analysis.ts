/**
 * 実光線の追跡による収差の評価（DOM に依存しない）: スポットダイアグラム、球面収差・像面湾曲・歪曲の曲線、
 * 周辺光量、描画用の瞳の範囲の表。長さは mm、波長は µm
 */
import { LC, LD, LF } from './glass';
import { aimChief, fieldU, HALF_DIAG, objRay, type Ray, type State, traceFwd, traceRev } from './optics';

/** 収差の図の 3 波長（F 線・d 線・C 線） */
export const WAVES = [LF, LD, LC] as const;

/* ---------- スポットダイアグラム ---------- */
export interface Spot {
  /** 像の高さ（近軸） */
  h: number;
  /** 波長ごとの点（d 線の重心からの位置 [mm]） */
  pts: [number[], number[], number[]];
  /** 全波長の RMS 半径 [mm] */
  rms: number;
  /** d 線の重心の高さ（実際に写る位置） */
  cy: number;
  /** 通った光線の割合（d 線） */
  pass: number;
}

/** 像の高さ h の物点の光束を、入射瞳の格子（n × n）で追跡する */
export function spot(st: State, h: number, n = 21): Spot {
  const u = fieldU(st, h);
  const pts: Spot['pts'] = [[], [], []];
  const raw: [number, number][][] = [[], [], []];
  let tot = 0,
    ok = 0;
  WAVES.forEach((l, w) => {
    const yc = aimChief(st, u, l),
      R = st.rep * 1.25;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const px = ((2 * i) / (n - 1) - 1) * R,
          py = ((2 * j) / (n - 1) - 1) * R;
        if (px * px + py * py > R * R) continue;
        if (w === 1) tot++;
        const r = objRay(st, u, px, py, yc);
        if (traceFwd(st, r, l) >= 0) continue;
        if (w === 1) ok++;
        raw[w].push([r.x, r.y]);
      }
  });
  const d = raw[1];
  let cx = 0,
    cy = 0;
  for (const [x, y] of d) {
    cx += x;
    cy += y;
  }
  cx /= d.length || 1;
  cy /= d.length || 1;
  let ss = 0,
    m = 0;
  raw.forEach((L, w) => {
    for (const [x, y] of L) {
      pts[w].push(x - cx, y - cy);
      ss += (x - cx) ** 2 + (y - cy) ** 2;
      m++;
    }
  });
  return { h, pts, rms: m ? Math.sqrt(ss / m) : 0, cy, pass: tot ? ok / tot : 0 };
}

/* ---------- 収差の曲線 ---------- */
/** 光線が光軸（y = 0）か子午面（x = 0）を横切る z（最後の面の後ろの直線で求める） */
const crossZ = (r: Ray, k: 'x' | 'y'): number => r.z - (r[k] * r.dz) / (k === 'x' ? r.dx : r.dy);

/** 縦の球面収差: 瞳の高さ ρ（0〜1）ごとに、軸上の光線が光軸を横切る位置のセンサーからのずれ [mm] */
export function sphCurve(st: State, n = 24): [number, number][][] {
  return WAVES.map((l) => {
    const out: [number, number][] = [];
    for (let i = 1; i <= n; i++) {
      const p = i / n,
        r = objRay(st, 0, 0, p * st.rep, 0);
      if (traceFwd(st, r, l) >= 0 || r.dy === 0) continue;
      out.push([p, crossZ(r, 'y') - st.zs]);
    }
    return out;
  });
}

/**
 * 像面湾曲（非点収差）: 像の高さごとに、主光線の近くの子午・球欠の光線が集まる位置のセンサーからのずれ [mm]。
 * 主光線と瞳を少しずらした光線の交わる点で求める（Coddington の式の代わり）
 */
export function fieldCurve(st: State, n = 16): { h: number; t: number; s: number }[] {
  const out: { h: number; t: number; s: number }[] = [];
  const e = st.rep * 0.02;
  for (let i = 0; i <= n; i++) {
    const h = (i / n) * HALF_DIAG,
      u = fieldU(st, h),
      yc = aimChief(st, u, LD);
    const c = objRay(st, u, 0, 0, yc),
      t = objRay(st, u, 0, e, yc),
      s = objRay(st, u, e, 0, yc);
    const o = { noClip: true };
    if (traceFwd(st, c, LD, undefined, o) >= 0 || traceFwd(st, t, LD, undefined, o) >= 0) continue;
    if (traceFwd(st, s, LD, undefined, o) >= 0) continue;
    /* 子午: 2 本の y が等しくなる z。球欠: ずらした光線が子午面に戻る z */
    const zt = c.z + (t.y - c.y) / (c.dy / c.dz - t.dy / t.dz);
    const zs = crossZ(s, 'x');
    out.push({ h, t: zt - st.zs, s: zs - st.zs });
  }
  return out;
}

/** 歪曲: 像の高さ（近軸）ごとの、主光線の像の高さのずれ [%] */
export function distCurve(st: State, n = 16): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i <= n; i++) {
    const h = (i / n) * HALF_DIAG,
      d = distortion(st, h);
    if (Number.isFinite(d)) out.push([h, d]);
  }
  return out;
}

/** 像の高さ h（近軸）での歪曲 [%]。主光線が通らなければ NaN */
export function distortion(st: State, h: number): number {
  const u = fieldU(st, h),
    yc = aimChief(st, u, LD),
    r = objRay(st, u, 0, 0, yc);
  if (traceFwd(st, r, LD, undefined, { noClip: true }) >= 0) return Number.NaN;
  return (r.y / h - 1) * 100;
}

/* ---------- 瞳の範囲の表と周辺光量 ---------- */
/**
 * センサーの点 (h, 0) から射出瞳の面を見たとき、光が通る範囲を囲む長方形（中心の x、半幅 x・y）。
 * 描画はこの長方形の中に光線を一様に置く。nh 点の高さ 0〜hmax について求める
 */
export interface PupilTable {
  hmax: number;
  /** [cx, hx, hy] を高さの順に */
  rows: [number, number, number][];
}

export function pupilTable(st: State, hmax = HALF_DIAG * 1.04, nh = 24): PupilTable {
  const rows: [number, number, number][] = [];
  for (let i = 0; i < nh; i++) rows.push(pupilBox(st, (i / (nh - 1)) * hmax));
  return { hmax, rows };
}

/** センサーの点 (h, 0) から射出瞳の面の点 (qx, qy) へ向けて逆に追跡できるか */
function passes(st: State, h: number, qx: number, qy: number): boolean {
  const dx = qx - h,
    dy = qy,
    dz = st.zxp - st.zs,
    L = Math.hypot(dx, dy, dz);
  const r: Ray = { x: h, y: 0, z: st.zs, dx: dx / L, dy: dy / L, dz: dz / L };
  return traceRev(st, r, LD, st.rc, 0);
}

function pupilBox(st: State, h: number): [number, number, number] {
  let R = st.rxp * 2.5;
  for (let pass = 0; pass < 4; pass++) {
    const b = scan(st, h, -R, R, 0, R, 32);
    if (!b) return [0, 0, 0];
    const edge = Math.max(-b[0], b[1], b[3]) > R * 0.95;
    if (edge && pass < 3) {
      R *= 2;
      continue;
    }
    /* 見つけた範囲を細かい格子で測り直し、格子 1 つぶんと 2 % の余裕を足す */
    const c = (b[1] - b[0]) / 31;
    const f = scan(st, h, b[0] - c, b[1] + c, 0, b[3] + c, 40) ?? b;
    const m = Math.max(f[1] - f[0], f[3]) / 39 + st.rxp * 0.02;
    return [(f[0] + f[1]) / 2, (f[1] - f[0]) / 2 + m, f[3] + m];
  }
  return [0, 0, 0];
}

/** 長方形 x0〜x1・y0〜y1（y は上半分）を n × n で調べ、通る点の範囲 [xmin, xmax, ymin, ymax] */
function scan(st: State, h: number, x0: number, x1: number, y0: number, y1: number, n: number) {
  let a = Infinity,
    b = -Infinity,
    c = Infinity,
    d = -Infinity;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const x = x0 + ((x1 - x0) * i) / (n - 1),
        y = y0 + ((y1 - y0) * j) / (n - 1);
      if (!passes(st, h, x, y)) continue;
      a = Math.min(a, x);
      b = Math.max(b, x);
      c = Math.min(c, y);
      d = Math.max(d, y);
    }
  return Number.isFinite(a) ? ([a, b, c, d] as const) : null;
}

/**
 * センサーの点 (h, 0) の照度の、中心に対する比（周辺光量）。瞳を n × n の格子で逆に追跡し、
 * 射出瞳の面での立体角の重み cos⁴θ を掛けて足す（描画と同じ求め方）
 */
export function illum(st: State, h: number, tb: PupilTable, n = 48): number {
  const e = (hh: number): number => {
    const k = Math.min(tb.rows.length - 1, (hh / tb.hmax) * (tb.rows.length - 1)),
      [cx, hx, hy] = tb.rows[Math.round(k)];
    if (hx <= 0 || hy <= 0) return 0;
    let sum = 0;
    const dz = st.zxp - st.zs;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const qx = cx + hx * (((i + 0.5) / n) * 2 - 1),
          qy = hy * (((j + 0.5) / n) * 2 - 1);
        const dx = qx - hh,
          L = Math.hypot(dx, qy, dz);
        const r: Ray = { x: hh, y: 0, z: st.zs, dx: dx / L, dy: qy / L, dz: dz / L };
        if (!traceRev(st, r, LD)) continue;
        sum += (dz / L) ** 4;
      }
    return (sum / (n * n)) * 4 * hx * hy;
  };
  const e0 = e(0);
  return e0 > 0 ? e(h) / e0 : 0;
}

/* ---------- 被写界深度と画角 ---------- */
export interface Dof {
  /** 近点・遠点（センサーから、Infinity は無限遠）と過焦点距離 [mm] */
  near: number;
  far: number;
  hyper: number;
}

/**
 * 被写界深度（近軸）。センサーの位置はそのままで、物体の面を前後に動かしたときのボケの径
 * 2r′·|z_s − z′|/|z′ − z_XP|（射出瞳の径 2r′、像の位置 z′）が許容錯乱円 c になる距離
 */
export function dof(st: State, c: number): Dof {
  const { f, zH, zH1 } = st.card;
  const zF1 = zH1 + f;
  const blur = (D: number): number => {
    if (!Number.isFinite(D)) return (2 * st.rxp * Math.abs(st.zs - zF1)) / Math.abs(zF1 - st.zxp);
    const so = D - st.zs + zH;
    if (so <= f * 1.0001) return Infinity;
    const zi = zH1 + 1 / (1 / f - 1 / so);
    return (2 * st.rxp * Math.abs(st.zs - zi)) / Math.abs(zi - st.zxp);
  };
  const D0 = Number.isFinite(st.D) ? st.D : Infinity;
  /* 近点: 前側の焦点からピントの面までで二分 */
  let lo = st.zs - zH + f * 1.0002,
    hi = Number.isFinite(D0) ? D0 : 1e12;
  for (let i = 0; i < 80; i++) {
    const m = Math.sqrt(lo * hi);
    if (blur(m) > c) lo = m;
    else hi = m;
  }
  const near = hi;
  /* 遠点: 1/D で二分 */
  let far = Infinity;
  if (Number.isFinite(D0) && blur(Infinity) > c) {
    let a = 1 / D0,
      b = 0;
    for (let i = 0; i < 80; i++) {
      const m = (a + b) / 2;
      if (blur(1 / m) > c) b = m;
      else a = m;
    }
    far = 1 / a;
  }
  /* 過焦点距離: 無限遠のボケが c になるセンサーの位置に合うピントの距離 */
  const zsH = zF1 + (c * Math.abs(zF1 - st.zxp)) / (2 * st.rxp),
    si = zsH - zH1,
    so = 1 / (1 / f - 1 / si);
  return { near, far, hyper: so + si + (zH1 - zH) };
}

/**
 * 実光線の主光線が像の高さ h に届く物点の、入射瞳から見た角度 [rad]（歪曲を含む画角の半分）。
 * 届かなければ近軸の値
 */
export function halfAngle(st: State, h: number): number {
  const ang = (u: number) => (Number.isFinite(st.zo) ? Math.atan(Math.abs(u) / (st.zep - st.zo)) : Math.atan(u));
  const img = (u: number): number => {
    const r = objRay(st, u, 0, 0, aimChief(st, u, LD));
    return traceFwd(st, r, LD, undefined, { noClip: true }) >= 0 ? Number.NaN : r.y;
  };
  let a = fieldU(st, h),
    fa = img(a) - h;
  const p = ang(a);
  if (!Number.isFinite(fa)) return p;
  let b = a * 1.02,
    fb = img(b) - h;
  for (let i = 0; i < 30 && Number.isFinite(fb) && Math.abs(fb) > 1e-7 * h; i++) {
    if (fb === fa) break;
    const c = b - (fb * (b - a)) / (fb - fa);
    a = b;
    fa = fb;
    b = c;
    fb = img(b) - h;
  }
  return Number.isFinite(fb) ? ang(b) : p;
}
