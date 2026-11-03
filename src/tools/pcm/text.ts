/** 画面の数値の表記 */
import { minus } from '../../lib/format';

/** kHz の数（末尾の 0 を落とす。8000 → 8、11025 → 11.025） */
export const kHzLabel = (v: number): string => String(Number((v / 1000).toFixed(4)));
/** 3 桁区切り */
export const comma = (v: number): string => Math.round(v).toLocaleString('en-US');
export const snrLabel = (v: number): string => (Number.isFinite(v) ? minus(v.toFixed(1)) : '∞');
/** 聴き比べのキーの札 */
export const pcmLabel = (fs: number, bits: number, law: string): string =>
  `${kHzLabel(fs)} kHz・${law === 'lin' ? `${bits} bit` : law === 'mu' ? '8 bit μ-law' : '8 bit A-law'}`;
