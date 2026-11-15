/**
 * サンプルのコード進行（このツールのために書いたもの。記法は song.ts の parseSong）。
 * どれも一般に知られた進行の型で、特定の曲を写したものではない
 */
export interface Sample {
  id: string;
  name: string;
  src: string;
}
export const SAMPLES: readonly Sample[] = [
  {
    id: 'mix',
    name: '転調と拍子の変化',
    src: '[key C maj] [met 4/4] [tmp 96] [pat updown] [vce gtr] [lbl Aメロ] I V vi iii IV I IV V [lbl Bメロ br] IV V iii vi ii7:2 V7:2@strum [lbl サビ br] [key D maj] vi IV V I [lbl 終わり br] [met 3/4] [pat alberti] [vce ep] ii7 V7 IM7:6@whole',
  },
  {
    id: 'canon',
    name: 'カノン進行',
    src: '[key D maj] [met 4/4] [tmp 84] [pat updown] [vce str] |: I V vi iii IV I IV V :|2 I@whole',
  },
  {
    id: 'oudou',
    name: '王道進行',
    src: '[key Eb maj] [met 4/4] [tmp 120] [pat strum] [vce gtr] |: IV V iii vi :|*',
  },
  {
    id: 'komuro',
    name: '小室進行',
    src: '[key A min] [met 4/4] [tmp 132] [pat up] [vce pad] |: i VI VII III :|*',
  },
  {
    id: 'marusa',
    name: '丸サ進行',
    src: '[key D maj] [met 4/4] [tmp 96] [pat three] [vce ep] |: IVM7 III7 vi7 I7 :|*',
  },
  {
    id: 'cycle',
    name: '循環進行',
    src: '[key F maj] [met 4/4] [tmp 112] [pat three] [vce mar] |: I vi ii V7 :|*',
  },
  {
    id: 'two-five',
    name: 'ツーファイブワン',
    src: '[key Bb maj] [met 4/4] [tmp 132] [pat strum] [vce vib] |: ii7 V7 IM7 IM7 :|2 [key G min] |: iiø V7 i7 i7 :|2',
  },
  {
    id: 'blues',
    name: '12 小節のブルース',
    src: '[key A maj] [met 4/4] [tmp 104] [pat strum] [vce brs] |: I7 IV7 I7 I7 IV7 IV7 I7 I7 V7 IV7 I7 V7 :|*',
  },
  {
    id: 'cadence',
    name: '3 つの終止',
    src: '[key C maj] [met 4/4] [tmp 72] [pat whole] [vce org] I IV V7 I I vi IV V I IV I:8 ii V vi:8',
  },
  {
    id: 'waltz',
    name: 'ワルツ',
    src: '[key F maj] [met 3/4] [tmp 144] [pat alberti] [vce pf] |: I I V7 V7 V7 V7 I I IV IV I I V7 V7 I I :|2',
  },
  {
    id: 'ballad',
    name: '6/8 のバラード',
    src: '[key G maj] [met 6/8] [tmp 60] [pat up] [vce harp] |: I iii vi IV I/2 IV Vsus4:3 V:3 :|2 I@whole',
  },
  {
    id: 'minor',
    name: '短調の下行',
    src: '[key E min] [met 4/4] [tmp 100] [pat down] [vce org] |: i VII VI V7 :|*',
  },
];
export const SAMPLE0 = 'mix';
