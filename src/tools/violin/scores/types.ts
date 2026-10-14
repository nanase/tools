/** 楽譜の音（scripts/violin-scores.ts が .ly から作る）。時刻と長さは 4 分音符 = 1 の拍 */
export interface ScoreNote {
  t: number;
  d: number;
  /** 音の高さ（MIDI）。和音なら和音の全部 */
  n: number[];
  /** スラーの始まり・終わり */
  slurOn: boolean;
  slurOff: boolean;
  trill: boolean;
  fermata: boolean;
  /** 強弱の記号（pp … ff、fz） */
  dyn?: string;
  /** 松葉: '<' '>' が始まる、'!' で終わる */
  hair?: '<' | '>' | '!';
}

/** 強弱の記号の並び（データでは 1 から始まる番号で表す） */
export const DYNS = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'fz', 'sf', 'sfz'] as const;
/** 松葉の並び（データでは 1 から始まる番号で表す） */
export const HAIRS = ['<', '>', '!'] as const;

/** 1 拍を分ける数（データの時刻と長さの単位） */
export const TICKS = 960;

/**
 * 声部のデータの文字列を音の列に戻す。1 音は「前の音の始まりからの間,長さ,記号,音の高さ…」（,区切り）で、音は空白で区切る。
 * 記号は 1 = スラーの始まり、2 = スラーの終わり、4 = トリル、8 = フェルマータ、16 × 松葉の番号、64 × 強弱の番号の和
 */
export function decodeVoice(s: string): ScoreNote[] {
  const out: ScoreNote[] = [];
  let t = 0;
  for (const tok of s.split(' ')) {
    if (!tok) continue;
    const [dt, d, f, ...n] = tok.split(',').map(Number);
    t += dt;
    const hair = (f >> 4) & 3,
      dyn = f >> 6;
    out.push({
      t: t / TICKS,
      d: d / TICKS,
      n,
      slurOn: (f & 1) !== 0,
      slurOff: (f & 2) !== 0,
      trill: (f & 4) !== 0,
      fermata: (f & 8) !== 0,
      ...(dyn ? { dyn: DYNS[dyn - 1] } : {}),
      ...(hair ? { hair: HAIRS[hair - 1] } : {}),
    });
  }
  return out;
}
