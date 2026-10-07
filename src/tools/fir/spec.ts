/**
 * 仕様（応答の種類・カットオフ周波数・遷移帯域幅・リップル・減衰）と帯域（DOM に依存しない）。
 * 周波数は、関数の名前に Hz とあるもの以外は fs で割った値（0 … 0.5）で扱う
 */

export type Resp = 'lowpass' | 'highpass' | 'bandpass' | 'bandstop';

/** 2 つのカットオフ周波数を使う種類 */
export const twoEdges = (t: Resp): boolean => t === 'bandpass' || t === 'bandstop';
/** z = −1（fs/2）で振幅が要る種類。直線位相では N を奇数（タイプ I）にする */
export const needsOdd = (t: Resp): boolean => t === 'highpass' || t === 'bandstop';

/** 通過域のリップル Ap [dB]（ピーク間）から δp。20 log10((1 + δp)/(1 − δp)) = Ap */
export const dpOf = (ap: number): number => {
  const g = 10 ** (ap / 20);
  return (g - 1) / (g + 1);
};
/** δp からリップル Ap [dB]（ピーク間） */
export const apOf = (dp: number): number => 20 * Math.log10((1 + dp) / (1 - dp));
/** 阻止域の減衰 As [dB] から δs */
export const dsOf = (as: number): number => 10 ** (-as / 20);

export interface Band {
  lo: number;
  hi: number;
  /** 通過域か */
  pass: boolean;
}

/**
 * 帯域の並び（低い順）。f1・f2 は遷移帯域の中央、df は遷移帯域幅。
 * LPF: 通過 [0, f1 − df/2]・阻止 [f1 + df/2, 0.5]。BPF・BSF は f1 と f2 の 2 か所に遷移帯域を置く
 */
export function bandsOf(t: Resp, f1: number, f2: number, df: number): Band[] {
  const h = df / 2;
  switch (t) {
    case 'lowpass':
      return [
        { lo: 0, hi: f1 - h, pass: true },
        { lo: f1 + h, hi: 0.5, pass: false },
      ];
    case 'highpass':
      return [
        { lo: 0, hi: f1 - h, pass: false },
        { lo: f1 + h, hi: 0.5, pass: true },
      ];
    case 'bandpass':
      return [
        { lo: 0, hi: f1 - h, pass: false },
        { lo: f1 + h, hi: f2 - h, pass: true },
        { lo: f2 + h, hi: 0.5, pass: false },
      ];
    case 'bandstop':
      return [
        { lo: 0, hi: f1 - h, pass: true },
        { lo: f1 + h, hi: f2 - h, pass: false },
        { lo: f2 + h, hi: 0.5, pass: true },
      ];
  }
}

/* ---------- 入力の範囲 ---------- */
/** 帯域の幅の下限（fs に対する割合）。0 幅の帯域を作らない */
export const GAP = 1e-4;

export interface Freqs {
  f1: number;
  f2: number;
  df: number;
}

/**
 * ほかの値を固定したときの、f1・f2・df それぞれの範囲 [Hz]。すべての帯域の幅が fs·GAP 以上になる範囲
 */
export function rangesHz(t: Resp, fs: number, { f1, f2, df }: Freqs): Record<keyof Freqs, [number, number]> {
  const g = fs * GAP,
    n = fs / 2;
  if (!twoEdges(t))
    return {
      f1: [df / 2 + g, n - df / 2 - g],
      f2: [df / 2 + g, n - df / 2 - g],
      df: [g, 2 * Math.min(f1 - g, n - f1 - g)],
    };
  return {
    f1: [df / 2 + g, f2 - df - g],
    f2: [f1 + df + g, n - df / 2 - g],
    df: [g, Math.min(2 * (f1 - g), f2 - f1 - g, 2 * (n - f2 - g))],
  };
}

/** 仕様が帯域を作れるか */
export function validHz(t: Resp, fs: number, v: Freqs): boolean {
  const b = bandsOf(t, v.f1 / fs, v.f2 / fs, v.df / fs);
  return v.df > 0 && b.every((x) => x.hi - x.lo >= GAP * (1 - 1e-9));
}

/**
 * 帯域を作れない値を直す。df を縮めて収まるなら df だけを、収まらなければ f1・f2 も fs/2 の内側へ寄せる。
 * 直した項目の名前を返す
 */
export function fitHz(t: Resp, fs: number, v: Freqs): { v: Freqs; fixed: (keyof Freqs)[] } {
  if (validHz(t, fs, v)) return { v, fixed: [] };
  const n = fs / 2,
    g = fs * GAP,
    two = twoEdges(t),
    fixed: (keyof Freqs)[] = [];
  let { f1, f2, df } = v;
  const clamp = (x: number, a: number, b: number) => {
    const c = Math.min(b, Math.max(a, x)),
      r = Number(c.toPrecision(3));
    return r >= a && r <= b ? r : c;
  };
  /* df を縮めても帯域を作れないときは、カットオフ周波数を fs/2 の内側へ寄せる */
  if (rangesHz(t, fs, { f1, f2, df }).df[1] <= 4 * g) {
    const a = clamp(f1, n * 0.05, n * (two ? 0.9 : 0.95));
    if (a !== f1) fixed.push('f1');
    f1 = a;
    if (two) {
      const b = clamp(f2, f1 + n * 0.05, n * 0.95);
      if (b !== f2) fixed.push('f2');
      f2 = b;
    }
  }
  const mx = rangesHz(t, fs, { f1, f2, df }).df[1];
  if (df > mx) {
    /* 上限より少し狭い、切りのよい値にする */
    df = Number((mx * 0.9).toPrecision(2));
    fixed.push('df');
  }
  return { v: { f1, f2, df }, fixed };
}
