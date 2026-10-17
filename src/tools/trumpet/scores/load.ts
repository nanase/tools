/** 曲の音符のデータを読み込む（主スレッドで使い、計算用の Worker へは読み込んだデータを渡す） */
import type { PieceData } from '../score';
import type { ScoreNote } from './types';

type Mod = { voices: () => ScoreNote[][]; bars: () => number[] };
const data = (m: Mod): PieceData => ({ voices: m.voices(), bars: m.bars() });

const LOADERS: Record<string, () => Promise<Mod>> = {
  hwv351: () => import('./hwv351'),
  'bwv-anh114': () => import('./bwv-anh114'),
  'ave-maria': () => import('./ave-maria'),
  bwv508: () => import('./bwv508'),
  napolitaine: () => import('./napolitaine'),
  hwv56: () => import('./hwv56'),
  taps: () => import('./taps'),
};

/** scores/ の名前 file のデータ */
export const loadScore = (file: string): Promise<PieceData> => {
  const f = LOADERS[file];
  if (!f) return Promise.reject(new Error(`曲のデータ ${file} がありません`));
  return f().then(data);
};
