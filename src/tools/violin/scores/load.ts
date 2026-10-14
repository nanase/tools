/** 曲の音符のデータを読み込む（主スレッドで使い、計算用の Worker へは読み込んだデータを渡す） */
import type { PieceData } from '../score';
import type { ScoreNote } from './types';

type Mod = { voices: () => ScoreNote[][]; bars: () => number[] };
const data = (m: Mod): PieceData => ({ voices: m.voices(), bars: m.bars() });

const LOADERS: Record<string, () => Promise<Mod>> = {
  'bwv1004-1': () => import('./bwv1004-1'),
  'bwv1004-2': () => import('./bwv1004-2'),
  'bwv1004-3': () => import('./bwv1004-3'),
  'bwv1004-4': () => import('./bwv1004-4'),
  'bwv1004-5': () => import('./bwv1004-5'),
  'bwv1006-1': () => import('./bwv1006-1'),
  'bwv1001-1': () => import('./bwv1001-1'),
  'eccles-1': () => import('./eccles-1'),
  'eccles-3': () => import('./eccles-3'),
};

/** scores/ の名前 file のデータ */
export const loadScore = (file: string): Promise<PieceData> => {
  const f = LOADERS[file];
  if (!f) return Promise.reject(new Error(`曲のデータ ${file} がありません`));
  return f().then(data);
};
