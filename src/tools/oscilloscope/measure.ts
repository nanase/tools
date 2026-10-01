/** オシロスコープの計算（DOM に依存しない）: トリガ、測定（周波数・実効値・ピーク・位相差・相関） */

/** トリガのスロープ: 立ち上がり・立ち下がり・両方向（どちら向きでもレベルを横切れば） */
export type Slope = 'up' | 'down' | 'both';

/**
 * トリガの位置を探す。a がレベル lv を slope の向きに横切った点のうち、
 * lo 以上 hi 以下で最も新しいものを、標本の番号（小数で補間）で返す。なければ −1。
 * hy（ノイズ除去）: 波形がレベルから hy だけ反対側へ離れるまで、その向きの次のトリガを受け付けない
 */
export function findTrig(a: ArrayLike<number>, lv: number, slope: Slope, hy: number, lo: number, hi: number): number {
  const end = Math.min(a.length - 1, Math.floor(hi)),
    up = slope !== 'down',
    dn = slope !== 'up';
  let armUp = false,
    armDn = false,
    best = -1;
  for (let i = 1; i <= end; i++) {
    const x0 = a[i - 1],
      x1 = a[i];
    if (x0 < lv - hy) armUp = true;
    if (x0 > lv + hy) armDn = true;
    let c = -1;
    if (up && armUp && x0 < lv && x1 >= lv) {
      c = i - 1 + (lv - x0) / (x1 - x0);
      armUp = false;
    } else if (dn && armDn && x0 > lv && x1 <= lv) {
      c = i - 1 + (x0 - lv) / (x0 - x1);
      armDn = false;
    }
    if (c >= lo) best = c;
  }
  return best;
}

export interface Stats {
  mean: number;
  rms: number;
  /** 絶対値の最大 */
  pk: number;
}
export function stats(a: ArrayLike<number>): Stats {
  let s = 0,
    s2 = 0,
    pk = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    s += x;
    s2 += x * x;
    const q = Math.abs(x);
    if (q > pk) pk = q;
  }
  return { mean: s / a.length, rms: Math.sqrt(s2 / a.length), pk };
}

/**
 * 周波数: 平均を上向きに横切る点の間隔から求める。横切った点が 3 つ未満、または振れ幅がほぼ 0 なら NaN。
 * ノイズで数え過ぎないよう、交流分の実効値の 0.3 倍だけ下がってから次を数える
 */
export function freqOf(a: ArrayLike<number>, fs: number, st: Stats = stats(a)): number {
  const m = st.mean,
    hy = Math.sqrt(Math.max(0, st.rms ** 2 - m ** 2)) * 0.3;
  if (hy < 3e-5) return Number.NaN;
  let armed = false,
    first = -1,
    last = -1,
    n = 0;
  for (let i = 1; i < a.length; i++) {
    const x0 = a[i - 1] - m,
      x1 = a[i] - m;
    if (x1 < -hy) armed = true;
    if (armed && x0 < 0 && x1 >= 0) {
      const c = i - 1 - x0 / (x1 - x0);
      if (first < 0) first = c;
      last = c;
      n++;
      armed = false;
    }
  }
  return n >= 3 ? ((n - 1) * fs) / (last - first) : Number.NaN;
}

/** 末尾 M 点の、周波数 f の成分の振幅と位相（ラジアン） */
export function tone(a: ArrayLike<number>, f: number, fs: number, M: number): [number, number] {
  let re = 0,
    im = 0;
  const w = (2 * Math.PI * f) / fs,
    s = a.length - M;
  for (let n = 0; n < M; n++) {
    re += a[s + n] * Math.cos(w * n);
    im -= a[s + n] * Math.sin(w * n);
  }
  return [(2 * Math.hypot(re, im)) / M, Math.atan2(im, re)];
}

/**
 * 位相差 CH2 − CH1（度、−180 より大きく 180 以下）。周波数 f の整数周期分で比べる。
 * どちらかの f の成分が小さい（周波数が違う・信号がない）なら NaN
 */
export function phaseDiff(L: ArrayLike<number>, R: ArrayLike<number>, f: number, fs: number): number {
  if (!(f > 0)) return Number.NaN;
  const M = Math.round((Math.floor((L.length * f) / fs) * fs) / f);
  if (M < 4) return Number.NaN;
  const s1 = stats(L),
    s2 = stats(R);
  if (s1.rms < 1e-4 || s2.rms < 1e-4) return Number.NaN;
  const [a1, p1] = tone(L, f, fs, M),
    [a2, p2] = tone(R, f, fs, M);
  if (a1 < s1.rms * 0.5 || a2 < s2.rms * 0.5) return Number.NaN;
  const d = ((p2 - p1) * 180) / Math.PI;
  return 180 - ((((180 - d) % 360) + 360) % 360);
}

/** 相関係数（CH1 と CH2、末尾 M 点）。どちらかが無音なら NaN */
export function corr(L: ArrayLike<number>, R: ArrayLike<number>, M: number): number {
  let ll = 0,
    rr = 0,
    lr = 0;
  for (let i = L.length - M; i < L.length; i++) {
    ll += L[i] * L[i];
    rr += R[i] * R[i];
    lr += L[i] * R[i];
  }
  const q = Math.sqrt(ll * rr);
  return q > 1e-9 ? lr / q : Number.NaN;
}

/** dBFS（フルスケールの正弦波を 0 dBFS とする。rms なら √2 倍してから） */
export const dbfs = (x: number): number => 20 * Math.log10(x + 1e-12);
