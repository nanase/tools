# ヴァイオリン音響モデルの曲の出典とライセンス

ヴァイオリン音響モデルのページで演奏する曲の出典とライセンスです。曲の一覧は [SCORES.md](../../../SCORES.md) にあります。

データは [scores/](scores/) にあり、`bun run violin-scores` で作ります。MIDI ではなく LilyPond のファイルの声部を直接読みます（スラー・トリル・フェルマータ・強弱の記号を残すため）。

## どの曲にも共通の加工

- 反復を演奏順に展開し、装飾音を除いた
- 時刻と長さを 4 分音符の 1/960 に丸めた
- `.ly` は Mutopia Project の配布ファイルから、入力者のメールアドレスの行（`maintainerEmail`）だけを除いた

## パルティータ 第 2 番 BWV 1004（5 楽章）

J. S. バッハ「無伴奏ヴァイオリンのためのソナタとパルティータ」より。アルマンド・クーラント・サラバンド・ジーグ・シャコンヌ。

- ファイル: [bwv1004-1.ly](scores/bwv1004-1.ly)〜[bwv1004-5.ly](scores/bwv1004-5.ly)、[bwv1004-1.ts](scores/bwv1004-1.ts)〜[bwv1004-5.ts](scores/bwv1004-5.ts)（1 = アルマンド、2 = クーラント、3 = サラバンド、4 = ジーグ、5 = シャコンヌ）
- 出典: Mutopia Project の楽譜（[1423](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1423)・[1424](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1424)・[1427](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1427)・[1428](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1428)・[1426](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1426)）（Mutopia-2010/02/03-1423・Mutopia-2008/05/18-1424・Mutopia-2008/10/29-1427・Mutopia-2008/05/28-1428・Mutopia-2019/05/30-1426）
- 入力: アルマンド・クーラント・シャコンヌは Hajo Dezelski、サラバンド・ジーグは Benjamin D. Esham
- 底本: Bach-Gesellschaft Edition 1879 Band 27.1
- ライセンス: [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)

## 前奏曲 ホ長調 BWV 1006

J. S. バッハ「無伴奏ヴァイオリンのためのパルティータ 第 3 番」より。

- ファイル: [bwv1006-1.ly](scores/bwv1006-1.ly)、[bwv1006-1.ts](scores/bwv1006-1.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1469)（Mutopia-2008/07/13-1469）
- 入力: Hajo Dezelski
- 底本: Bach-Gesellschaft Edition 1879 Band 27.1
- ライセンス: [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)

## アダージョ ト短調 BWV 1001

J. S. バッハ「無伴奏ヴァイオリンのためのソナタ 第 1 番」より。

- ファイル: [bwv1001-1.ly](scores/bwv1001-1.ly)、[bwv1001-1.ts](scores/bwv1001-1.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1429)（Mutopia-2008/06/01-1429）
- 入力: Hajo Dezelski
- 底本: Bach-Gesellschaft Edition 1879 Band 27.1
- ライセンス: [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)

## エクルズ ソナタ ト短調（グラーヴェ・アダージョ）

H. エクルズ作曲、J. Salmon によるヴァイオリンとピアノの編曲（1914 年）。ヴァイオリンの声部だけを使います。

- ファイル: [eccles.ly](scores/eccles.ly)、[eccles-1.ts](scores/eccles-1.ts)（グラーヴェ）、[eccles-3.ts](scores/eccles-3.ts)（アダージョ）
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=540)（Mutopia-2015/09/01-540）
- 入力: Benjamin Crowell
- ライセンス: パブリックドメイン
