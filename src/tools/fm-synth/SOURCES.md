# FM音源の曲の出典とライセンス

FM音源のページで演奏する曲の出典とライセンスです。曲の一覧は [SCORES.md](../../../SCORES.md) にあります。

データは [scores/](scores/) にあり、`bun run fm-scores` で作ります。どの曲もすべてのパートをページの音色で弾くので、ベロシティは使いません。

## どの曲にも共通の加工

- 時刻と長さを 4 分音符の 1/480 に寄せた
- 同じ時刻の同じ高さの音は、譜表が違っても 1 つにまとめた

## トルコ行進曲

W. A. モーツァルト「ピアノ・ソナタ 第 11 番 イ長調 K. 331」の第 3 楽章。

- ファイル: [kv331.mid](scores/kv331.mid)、[kv331.ts](scores/kv331.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=108)（Mutopia-2015/08/13-108）
- 入力: Rune Zedeler、Chris Sawer
- 底本: IMSLP
- ライセンス: パブリックドメイン
- 加工: Mutopia の MIDI は反復を展開していないので、`.ly` を LilyPond 2.24.4 の `convert-ly` で直し、`\unfoldRepeats` を付けて MIDI を作り直した。終わりの区間の手書きの反復も 2 回弾くように並べ、テンポを ♩ = 120 にした

## ジ・エンターテイナー

S. ジョプリン。MIDI は反復を展開しています。

- ファイル: [entertainer.mid](scores/entertainer.mid)、[entertainer.ts](scores/entertainer.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=263)（Mutopia-2016/11/25-263）
- 入力: Chris Sawer
- 底本: 1902 年の初版の複製
- ライセンス: パブリックドメイン

## メイプル・リーフ・ラグ

S. ジョプリン。MIDI は反復を展開しています。

- ファイル: [maple.mid](scores/maple.mid)、[maple.ts](scores/maple.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=23)（Mutopia-2011/11/13-23）
- 入力: Chris Sawer
- 底本: 1899 年の初版の複製
- ライセンス: パブリックドメイン

## 山の魔王の宮殿にて

E. グリーグ「ペール・ギュント 第 1 組曲」の第 4 曲を、作曲者がピアノ独奏に編曲したものです。MIDI は反復を展開しています。

- ファイル: [mountain-king.mid](scores/mountain-king.mid)、[mountain-king.ts](scores/mountain-king.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1888)（Mutopia-2013/12/07-1888）
- 入力: Coyau
- 底本: The University Society, 1918
- ライセンス: パブリックドメイン

## インヴェンション 第 8 番 ヘ長調 BWV 779

J. S. バッハ「2 声のインヴェンション」より。

- ファイル: [bwv779.mid](scores/bwv779.mid)、[bwv779.ts](scores/bwv779.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=61)（Mutopia-2008/06/15-61）
- 入力: Allen Garvin
- 底本: Bach-Gesellschaft
- ライセンス: パブリックドメイン

## アイネ・クライネ・ナハトムジーク 第 1 楽章

W. A. モーツァルト「セレナード 第 13 番 ト長調 K. 525」の弦楽四重奏の版。MIDI は反復を展開しています。

- ファイル: [kv525.mid](scores/kv525.mid)、[kv525.ts](scores/kv525.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=900)（Mutopia-2007/01/01-900）
- 入力: 匿名
- 底本: IMSLP
- ライセンス: パブリックドメイン

## エリーゼのために

L. v. ベートーヴェン WoO 59。

- ファイル: [fur-elise.mid](scores/fur-elise.mid)、[fur-elise.ts](scores/fur-elise.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=931)（Mutopia-2015/08/18-931）
- 入力: Stelios Samelis
- 底本: Breitkopf & Härtel, 1888
- ライセンス: パブリックドメイン
- 加工: Mutopia の MIDI は反復を展開していないので、`.ly` を LilyPond 2.24.4 の `convert-ly` で直し、`\unfoldRepeats` を付けて MIDI を作り直した
