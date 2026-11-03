/** サンプル音源（44.1 kHz・4 秒）。音は PCM のページと共有する */
import { MUSIC, type MusicName, makeMusic } from '../pcm/music';
import { FS } from './encoder';

export type SrcName = MusicName;
export const SOURCES = MUSIC;
export const DUR = 4;

/** サンプル音源を作る（1 または 2 チャンネル） */
export const makeSource = (name: SrcName, dur = DUR): Float32Array[] => makeMusic(name, FS, dur);
