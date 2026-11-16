/**
 * サンプルのコード進行（このツールのために書いたもの。記法は song.ts の parseChords）。
 * どれも一般に知られた進行の型で、特定の曲を写したものではない
 */
import { type GtrId, type KeysId, type Meter, parseChords, parseKey, type Song, type StyleId } from './song';

export interface Sample {
  id: string;
  name: string;
  key: string;
  meter: Meter;
  bpm: number;
  style: StyleId;
  keys: KeysId;
  gtr: GtrId;
  src: string;
}
export const SAMPLES: readonly Sample[] = [
  {
    id: 'canon',
    name: 'カノン進行',
    key: 'C',
    meter: 4,
    bpm: 92,
    style: 'pop',
    keys: 'pf',
    gtr: 'gtr',
    src: 'C G Am Em F C F G',
  },
  {
    id: 'oudou',
    name: '王道進行',
    key: 'C',
    meter: 4,
    bpm: 120,
    style: 'rock',
    keys: 'ep',
    gtr: 'gtr',
    src: 'F G Em Am F G Em Am',
  },
  {
    id: 'komuro',
    name: '小室進行',
    key: 'Am',
    meter: 4,
    bpm: 128,
    style: 'pop',
    keys: 'pad',
    gtr: 'gtr',
    src: 'Am F G C',
  },
  {
    id: 'marusa',
    name: '丸サ進行',
    key: 'D',
    meter: 4,
    bpm: 96,
    style: 'bossa',
    keys: 'ep',
    gtr: 'cgt',
    src: 'GM7 F#7 Bm7 D7',
  },
  {
    id: 'cycle',
    name: '循環進行',
    key: 'F',
    meter: 4,
    bpm: 112,
    style: 'pop',
    keys: 'mar',
    gtr: 'gtr',
    src: 'F Dm Gm C7',
  },
  {
    id: 'two-five',
    name: 'ツーファイブワン',
    key: 'Bb',
    meter: 4,
    bpm: 132,
    style: 'jazz',
    keys: 'vib',
    gtr: 'cgt',
    src: 'Cm7 F7 BbM7 BbM7 >Gm Am7b5 D7 Gm7 Gm7',
  },
  {
    id: 'blues',
    name: '12 小節のブルース',
    key: 'A',
    meter: 4,
    bpm: 104,
    style: 'shuffle',
    keys: 'org',
    gtr: 'gtr',
    src: 'A7 D7 A7 A7 D7 D7 A7 A7 E7 D7 A7 E7',
  },
  {
    id: 'cadence',
    name: '3 つの終止',
    key: 'C',
    meter: 4,
    bpm: 72,
    style: 'ballad',
    keys: 'org',
    gtr: 'cgt',
    src: 'C F G7 C C Am F G C F C:8',
  },
  {
    id: 'waltz',
    name: 'ワルツ',
    key: 'F',
    meter: 3,
    bpm: 144,
    style: 'pop',
    keys: 'pf',
    gtr: 'cgt',
    src: 'F F C7 C7 C7 C7 F F Bb Bb F F C7 C7 F F',
  },
  {
    id: 'modulation',
    name: '全音上へ転調',
    key: 'C',
    meter: 4,
    bpm: 116,
    style: 'pop',
    keys: 'str',
    gtr: 'gtr',
    src: 'F G Em Am F G E7 Am >D G A F#m Bm G A D:8',
  },
];
export const SAMPLE0 = 'canon';
export function sampleSong(id: string): Song {
  const s = SAMPLES.find((x) => x.id === id) ?? SAMPLES[0];
  return {
    name: s.name,
    key: parseKey(s.key),
    meter: s.meter,
    bpm: s.bpm,
    style: s.style,
    keys: s.keys,
    gtr: s.gtr,
    chords: parseChords(s.src),
  };
}
