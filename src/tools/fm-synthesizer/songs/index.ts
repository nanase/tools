/**
 * 同梱の曲（MIDI ファイル。DOM に依存しない）。曲を選んだときに読み込む。
 * .mid は scripts/fm-synthesizer-songs.ts で作る（直接編集しない）
 */
import groove from './fm-groove.mid?url';
import kv525 from './kv525.mid?url';
import pezel24 from './pezel24.mid?url';
import woo29 from './woo29.mid?url';

export interface Song {
  v: string;
  name: string;
  /** 作曲者・作品 */
  by: string;
  /** 出典（曲の出典の枠に出す） */
  credit: string;
  /** 出典のページ（このサイトで作った曲は空） */
  url: string;
  load: () => Promise<ArrayBuffer>;
}

const get = (u: string) => () =>
  fetch(u).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.arrayBuffer();
  });

export const SONGS: readonly Song[] = [
  {
    v: 'groove',
    name: 'FM グルーヴ',
    by: 'このサイトのために作った曲',
    credit:
      'このページのために作った 7 パートの曲です（エレクトリックピアノ・ベース・ストリングス・ブラス・フルート・ビブラフォン・打楽器）。打楽器はパッドの 8 つがどれも鳴るように書きました。',
    url: '',
    load: get(groove),
  },
  {
    v: 'kv525',
    name: 'アイネ・クライネ・ナハトムジーク',
    by: 'W. A. モーツァルト（K. 525 第 1 楽章）',
    credit:
      '音符は Mutopia Project の弦楽四重奏の楽譜（作成者は匿名、底本 IMSLP、Mutopia-2007/01/01-900、パブリックドメイン）の MIDI です。パートごとに第 1・第 2 ヴァイオリン、ヴィオラ、チェロの音色を当てています。',
    url: 'https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=900',
    load: get(kv525),
  },
  {
    v: 'woo29',
    name: '行進曲 WoO 29',
    by: 'L. v. ベートーヴェン',
    credit:
      '音符は Mutopia Project の管楽合奏の楽譜（Stelios Samelis 作成、底本 Breitkopf und Härtel、Mutopia-2007/06/19-991、パブリックドメイン）の MIDI です。音色はもとの MIDI のまま（イングリッシュホルン・ファゴット・クラリネット）です。',
    url: 'https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=991',
    load: get(woo29),
  },
  {
    v: 'pezel24',
    name: 'ソナタ 第 24 番',
    by: 'J. ペツェル（金管合奏）',
    credit:
      '音符は Mutopia Project の金管合奏の楽譜（U. Weigelt 作成、底本 Frommann, Leipzig 1670、Mutopia-2013/03/23-1648、パブリックドメイン）の MIDI です。もとの MIDI には音色がないので、上の声部からトランペット・トロンボーン・チューバを当てました。',
    url: 'https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1648',
    load: get(pezel24),
  },
];

export const songOf = (v: string): Song | undefined => SONGS.find((s) => s.v === v);
