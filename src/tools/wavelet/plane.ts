/**
 * 時間と周波数の平面の箱（DOM に依存しない）。時間は長さ N の区間を 0〜1、周波数はナイキストを 1 とする。
 * STFT は L 点ごとに同じ大きさの箱、DWT は係数 1 つにつき 1 つの箱（低い段ほど横長）
 */
import { type Coeffs, type Wav, wavedec, waverec } from './dwt';
import { stftWindow } from './tf';

export interface Tile {
  t0: number;
  t1: number;
  f0: number;
  f1: number;
  /** 係数の大きさ */
  v: number;
  /** DWT の段（詳細は 1〜J、近似は J + 1）。STFT は 0 */
  j: number;
  /** 段の中の番号（STFT は列 × L/2 + 周波数の番号） */
  k: number;
}

/**
 * STFT の箱: 長さ L のハン窓を L/4 ずつずらし、箱の中に中心がある 4 つの窓の最大を箱の値にする
 * （窓の裾にかかる箱の端の出来事を見落とさない）。周波数の番号 k の箱は [k, k+1)·fs/L で、中心の周波数で変換する
 */
export function stftTiles(x: ArrayLike<number>, L: number): Tile[] {
  const N = x.length,
    win = stftWindow(L, 'hann'),
    out: Tile[] = [];
  for (let c = 0; c < N / L; c++)
    for (let k = 0; k < L / 2; k++) {
      let best = 0;
      for (let m = 0; m < 4; m++) {
        const o = c * L + ((m + 0.5) * L) / 4 - L / 2;
        let re = 0,
          im = 0;
        for (let i = 0; i < L; i++) {
          const n = Math.round(o + i);
          if (n < 0 || n >= N) continue;
          const v = x[n] * win[i],
            ph = (-2 * Math.PI * (k + 0.5) * i) / L;
          re += v * Math.cos(ph);
          im += v * Math.sin(ph);
        }
        best = Math.max(best, Math.hypot(re, im));
      }
      out.push({
        t0: (c * L) / N,
        t1: ((c + 1) * L) / N,
        f0: (2 * k) / L,
        f1: (2 * (k + 1)) / L,
        v: best / Math.sqrt(L),
        j: 0,
        k: c * (L / 2) + k,
      });
    }
  return out;
}

/** DWT の箱: 段 j の詳細は周波数 [2^−j, 2^(1−j))、近似は [0, 2^−J) */
export function dwtTiles(c: Coeffs): Tile[] {
  const J = c.d.length,
    out: Tile[] = [];
  for (let j = 1; j <= J + 1; j++) {
    const v = j <= J ? c.d[j - 1] : c.a,
      n = v.length,
      f0 = j <= J ? 2 ** -j : 0,
      f1 = j <= J ? 2 ** (1 - j) : 2 ** -J;
    for (let k = 0; k < n; k++) out.push({ t0: k / n, t1: (k + 1) / n, f0, f1, v: Math.abs(v[k]), j, k });
  }
  return out;
}

/** 箱の波形（原子）。STFT は箱の中のハン窓 × 中心の周波数の余弦、DWT は係数 1 つだけを 1 にして戻した波形 */
export function atom(t: Tile, N: number, opt: { L: number } | { c: Coeffs }): Float64Array {
  if ('L' in opt) {
    const L = opt.L,
      win = stftWindow(L, 'hann'),
      col = Math.floor(t.k / (L / 2)),
      k = t.k % (L / 2),
      a = new Float64Array(N);
    for (let i = 0; i < L; i++) a[col * L + i] = win[i] * Math.cos((2 * Math.PI * (k + 0.5) * i) / L);
    return a;
  }
  const c = opt.c,
    J = c.d.length,
    z: Coeffs = { w: c.w, a: new Float64Array(c.a.length), d: c.d.map((v) => new Float64Array(v.length)) };
  if (t.j > J) z.a[t.k] = 1;
  else z.d[t.j - 1][t.k] = 1;
  return waverec(z);
}

/** 箱の名前（d3・a5・STFT は空） */
export const tileName = (t: Tile, J: number): string => (t.j === 0 ? '' : t.j > J ? `a${J}` : `d${t.j}`);

/** 平面の DWT（長さ N を、使えるだけの段まで分ける） */
export const planeDwt = (x: ArrayLike<number>, w: Wav, J = 8): Coeffs => wavedec(x, w, J);
