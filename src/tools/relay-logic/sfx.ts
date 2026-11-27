/**
 * リレーのカチッという音の合成（画面にも AudioContext にも触らない。標本の列を返す）。
 * 樹脂のケースに入った小形のリレーの音にする（4 案からユーザーが選んだ、2026-11-27）。
 * 当たった部品がいくつかの高さで鳴って減っていく音（減衰する正弦波の和）に、当たりの瞬間の短い雑音を足し、
 * ケースでこもった音にするため高い音を落とす。
 * 出来事は 4 つ: on 接極子が鉄心に当たる・off ばねで戻って止まる・tick と tick2 は跳ねた接点が当たり直す
 */
import type { ClickKind } from './relay';
import { hs } from './relay';

/** 決まった種から −1〜1 の雑音を出す（xorshift） */
function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return (s / 4294967296) * 2 - 1;
  };
}

/** 1 次の低域通過 */
function lowpass(y: Float32Array, sr: number, f: number): void {
  const k = 1 - Math.exp((-2 * Math.PI * f) / sr);
  let z = 0;
  for (let i = 0; i < y.length; i++) {
    z += k * (y[i] - z);
    y[i] = z;
  }
}
/** 減衰する正弦波 [周波数 Hz, 振幅, 時定数 s] の和を足す。初めの位相は ph で決める */
function modes(
  y: Float32Array,
  sr: number,
  ms: readonly (readonly [number, number, number])[],
  ph: () => number,
): void {
  for (const [f, a, tau] of ms) {
    const p0 = ph() * Math.PI,
      w = (2 * Math.PI * f) / sr,
      d = Math.exp(-1 / (tau * sr));
    let e = a;
    for (let i = 0; i < y.length && e > 1e-5; i++) {
      y[i] += e * Math.sin(w * i + p0);
      e *= d;
    }
  }
}
/** 当たりの瞬間の短い雑音（大きさ a、時定数 tau s） */
function burst(y: Float32Array, sr: number, a: number, tau: number, r: () => number): void {
  const d = Math.exp(-1 / (tau * sr));
  let e = a;
  for (let i = 0; i < y.length && e > 1e-5; i++) {
    y[i] += e * r();
    e *= d;
  }
}

/** 音の長さ [s] */
const LEN = 0.05;

/** 1 回分の音。seed はリレーごとの番号（高さと大きさを少しずつ変える） */
export function click(kind: ClickKind, seed: number, sr: number): Float32Array {
  const fv = 1 + 0.08 * hs(seed * 3 + 11),
    av = 1 + 0.2 * hs(seed * 5 + 17);
  const r = rng(seed * 31 + kind.length * 7 + (kind === 'off' ? 3 : 0));
  const n = Math.round(LEN * sr),
    y = new Float32Array(n);
  if (kind === 'on') {
    /* ケースの低い「コッ」と、こもった当たり */
    modes(
      y,
      sr,
      [
        [880 * fv, 0.75 * av, 0.006],
        [1720 * fv, 0.45 * av, 0.004],
        [2900 * fv, 0.2 * av, 0.0025],
      ],
      r,
    );
    burst(y, sr, 0.6 * av, 0.0006, r);
  } else if (kind === 'off') {
    /* 戻る音は軽く高い */
    modes(
      y,
      sr,
      [
        [1250 * fv, 0.4 * av, 0.004],
        [2350 * fv, 0.25 * av, 0.0025],
      ],
      r,
    );
    burst(y, sr, 0.3 * av, 0.0004, r);
  } else burst(y, sr, kind === 'tick' ? 0.15 : 0.1, 0.0003, r);
  lowpass(y, sr, 3200);
  lowpass(y, sr, 4500);
  /* 頭と尻を滑らかに（はじめの 0.1 ms と終わりの 3 ms） */
  const a0 = Math.max(1, Math.round(0.0001 * sr)),
    a1 = Math.round(0.003 * sr);
  for (let i = 0; i < a0 && i < n; i++) y[i] *= i / a0;
  for (let i = 0; i < a1 && i < n; i++) y[n - 1 - i] *= i / a1;
  if (kind === 'tick' || kind === 'tick2') for (let i = 0; i < n; i++) y[i] *= 0.9;
  return y;
}

/** 大きさの倍率（全加算器の入力を 0.5 秒ごとに数え上げて −26 LUFS） */
export const GAIN = 1.13;
