/** 例の場面を模型にして進める（画面とテストで共有） */
import { Siphon } from './model';
import { PARAMS } from './params';
import { type PKey, type Scene, sceneOf } from './scenes';

export type Vals = Record<PKey, number>;
export const DEFAULTS = Object.fromEntries(PARAMS.map((d) => [d.k, d.v])) as Vals;

export function makeSim(sc: Scene, v: Vals = DEFAULTS): Siphon {
  return new Siphon(sc.src(v), sc.dst(v), sc.tube(v), sc.cond(v), sc.init(v), sc.burstQ ?? 0);
}

/** 条件だけを変える（形が変わらない行: 流入・標高・水温・洗浄水量・注ぐ量） */
export function retune(S: Siphon, sc: Scene, v: Vals, pour = true): void {
  S.c = sc.cond(v);
  if (!pour) S.c.qin = 0;
}

/**
 * 形が変わる行（台の高さ・管の内径・頂上の高さなど）のあとで作り直す。
 * 水の量・管の満ち具合・時刻・記録は引き継ぐ
 */
export function rebuild(old: Siphon, sc: Scene, v: Vals, pour = true): Siphon {
  const S = makeSim(sc, v);
  S.v1 = Math.min(old.v1, S.src.cap);
  if (S.dst) S.v2 = Math.min(old.v2, S.dst.cap);
  S.step(0);
  S.phi = old.phi;
  S.broken = old.broken;
  S.t = old.t;
  S.out = old.out;
  S.qmax = old.qmax;
  S.flushT = old.flushT;
  S.hist.push(...old.hist);
  S.bursts.push(...old.bursts);
  S.ev.push(...old.ev);
  if (!pour) S.c.qin = 0;
  return S;
}

/** 自動の操作（開いてすぐ動くように）: 決まった時刻の呼び水と、くり返しの水洗 */
function auto(S: Siphon, sc: Scene, dt: number): void {
  if (sc.autoPrime !== undefined && S.t < sc.autoPrime && S.t + dt >= sc.autoPrime) S.prime();
  if (sc.flushEvery && S.flushT < 0 && (S.t + dt - 1) % sc.flushEvery < dt && S.t + dt >= 1) S.flush();
}

/** T 秒進める */
export function run(S: Siphon, sc: Scene, T: number): void {
  let t = 0;
  while (t < T - 1e-9) {
    const h = Math.min(sc.every, T - t);
    auto(S, sc, h);
    S.advance(h, sc.dt, sc.every, sc.win * 1.05);
    t += h;
  }
}

/** 開いたときの状態（草間などは湧き出しの手前まで進めておく） */
export function start(id: string, v: Vals = DEFAULTS, pour = true): Siphon {
  const sc = sceneOf(id),
    S = makeSim(sc, v);
  if (!pour) S.c.qin = 0;
  if (sc.warm) run(S, sc, sc.warm);
  return S;
}
