/** 楽譜の音（scripts/trumpet-scores.ts が .ly から作る）。時刻と長さは 4 分音符 = 1 の拍、音の高さは実音 */
import { DYNS, HAIRS, TICKS } from '../../violin/scores/types';

export { DYNS, HAIRS, TICKS };

export interface ScoreNote {
  t: number;
  d: number;
  /** 音の高さ（MIDI、実音） */
  n: number;
  /** スラーの始まり・終わり */
  slurOn: boolean;
  slurOff: boolean;
  trill: boolean;
  fermata: boolean;
  /** スタッカート・アクセント・テヌート */
  stacc: boolean;
  accent: boolean;
  tenuto: boolean;
  /** 強弱の記号（pp … ff、fz） */
  dyn?: string;
  /** 松葉: '<' '>' が始まる、'!' で終わる */
  hair?: '<' | '>' | '!';
}

/** 記号の桁（強弱の番号は 64 × 11 までなので、その上に置く） */
export const STACC = 1024;
export const ACCENT = 2048;
export const TENUTO = 4096;

/**
 * 声部のデータの文字列を音の列に戻す。1 音は「前の音の始まりからの間,長さ,記号,音の高さ」（,区切り）で、音は空白で区切る。
 * 記号は 1 = スラーの始まり、2 = スラーの終わり、4 = トリル、8 = フェルマータ、16 × 松葉の番号、64 × 強弱の番号、
 * 1024 = スタッカート、2048 = アクセント、4096 = テヌートの和
 */
export function decodeVoice(s: string): ScoreNote[] {
  const out: ScoreNote[] = [];
  let t = 0;
  for (const tok of s.split(' ')) {
    if (!tok) continue;
    const [dt, d, f, n] = tok.split(',').map(Number);
    t += dt;
    const hair = (f >> 4) & 3,
      dyn = (f >> 6) & 15;
    out.push({
      t: t / TICKS,
      d: d / TICKS,
      n,
      slurOn: (f & 1) !== 0,
      slurOff: (f & 2) !== 0,
      trill: (f & 4) !== 0,
      fermata: (f & 8) !== 0,
      stacc: (f & STACC) !== 0,
      accent: (f & ACCENT) !== 0,
      tenuto: (f & TENUTO) !== 0,
      ...(dyn ? { dyn: DYNS[dyn - 1] } : {}),
      ...(hair ? { hair: HAIRS[hair - 1] } : {}),
    });
  }
  return out;
}
