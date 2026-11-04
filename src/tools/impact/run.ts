/** 1 回分の計算の結果と、地表の線から測る寸法 */
import type { Condition, Plan } from './model';
import type { SimFrame, SimInfo, SimResult } from './sim';

export type Frame = SimFrame & { xy: Int16Array; heat: Uint8Array; pr: Uint8Array; jv: Uint8Array; landN: number };

export interface Measure {
  /** 縁の位置 [m] */
  xL: number;
  xR: number;
  /** 縁から縁までの直径 [m] */
  D: number;
  /** 衝突前の地面からの縁の高さ [m] */
  rim: number;
  /** 縁から底までの深さ [m] */
  depth: number;
  /** クレーターの中心 [m] */
  xc: number;
}

export interface Run {
  c: Condition;
  pl: Plan;
  info: SimInfo | null;
  frames: Frame[];
  /** 着地した物 [id, x, y, 温度] を順に足したもの */
  land: number[];
  res: SimResult | null;
  /** 計算にかかった時間 [s] */
  secs: number;
  /** 岩の粒子の最後のコマ（第 3 段階のコマはこれを使う） */
  lastGrid: Frame | null;
  /** 岩の動きが止まって最初のコマの時刻 [s] */
  tFall: number | null;
  /** 穴が最も大きくなったコマ（一時的なクレーター） */
  tr: Frame | null;
  /** 穴が縮み始めたと確かめて、tr を決めたか */
  trFixed: boolean;
  /** 穴の断面積の最大と、調べ終えたコマの数 */
  aMax: number;
  aSeen: number;
  mt: Measure | null;
  /** 工程の始まりの時刻 [s]（接触・掘削・崩壊・噴出物の落下・完成） */
  st: number[];
  col: Float32Array | null;
}

/** 計算から届いたコマを足す。第 3 段階のコマには岩の粒子がないので、最後のコマのものを使う */
export function addFrame(run: Run, f: SimFrame): void {
  const g = run.lastGrid;
  const fr = (
    f.base && g ? { ...f, xy: g.xy, heat: g.heat, pr: g.pr, jv: g.jv, landN: 0 } : { ...f, landN: 0 }
  ) as Frame;
  if (f.base) run.tFall ??= f.t;
  else run.lastGrid = fr;
  for (const v of f.land) run.land.push(v);
  fr.landN = run.land.length;
  run.frames.push(fr);
}

export const smooth = (s0: Float32Array): Float32Array => {
  const n = s0.length,
    s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let c = 0,
      w = 0;
    for (let k = -2; k <= 2; k++) {
      const v = s0[Math.max(0, Math.min(n - 1, i + k))];
      if (v > -1e8) {
        c += v;
        w++;
      }
    }
    s[i] = w ? c / w : -1e9;
  }
  return s;
};

/**
 * 完成した地表の線から寸法を測る。xc0 は衝突点のそばの中心、R0 は文献の式の半径。
 * 縁は中心の左右で最も高い所（内側の起伏を拾わないよう R0 の 0.35〜1.5 倍の範囲）、底はその内側で最も低い所
 */
export function measureCrater(surf: Float32Array, dx: number, Rw: number, xc0: number, R0: number): Measure {
  const n = surf.length,
    s = smooth(surf),
    idx = (x: number) => Math.max(8, Math.min(n - 9, Math.round((x + Rw / 2) / dx)));
  let iL = idx(xc0 - 0.35 * R0),
    iR = idx(xc0 + 0.35 * R0);
  for (let i = iL, e = idx(xc0 - 1.5 * R0); i >= e; i--) if (s[i] > s[iL]) iL = i;
  for (let i = iR, e = idx(xc0 + 1.5 * R0); i <= e; i++) if (s[i] > s[iR]) iR = i;
  let floor = Infinity;
  for (let i = iL; i <= iR; i++) if (s[i] > -1e8 && s[i] < floor) floor = s[i];
  const xL = -Rw / 2 + iL * dx,
    xR = -Rw / 2 + iR * dx;
  return { xL, xR, D: xR - xL, rim: Math.max(s[iL], s[iR]), depth: (s[iL] + s[iR]) / 2 - floor, xc: (xL + xR) / 2 };
}

/** 一時的なクレーターのコマ・工程の時刻・寸法を求め直す */
export function analyze(run: Run): void {
  const I = run.info;
  if (!I || !run.frames.length) return;
  /* 穴の大きさは細かく揺れるので、十分縮んでから一時的なクレーターを決め、あとは動かさない */
  for (; run.aSeen < run.frames.length && !run.trFixed; run.aSeen++) {
    const f = run.frames[run.aSeen];
    if (f.base || !f.surf) continue;
    let a = 0;
    for (const s of f.surf) if (s > -1e8 && s < -I.dx) a -= s + I.dx;
    if (a > run.aMax) {
      run.aMax = a;
      run.tr = f;
    } else if (run.tr && f.t > 1.3 * run.tr.t && a < 0.9 * run.aMax) run.trFixed = true;
  }
  if (run.tFall != null) run.trFixed = true;
  if (run.res)
    run.mt = measureCrater(
      run.res.surf,
      I.dx,
      I.Rw,
      0.05 * I.D * Math.cos((run.c.th * Math.PI) / 180),
      run.pl.f.Dfr / 2,
    );
  const tLast = run.frames[run.frames.length - 1].t,
    tCont = Math.min(((3 * run.pl.Lc) / run.pl.vS) * 2, I.Tg * 0.02);
  run.st = [
    0,
    tCont,
    run.tr && run.trFixed ? run.tr.t : Infinity,
    run.tFall ?? Infinity,
    run.res ? Math.min(run.res.tDone, tLast) : Infinity,
  ];
}
