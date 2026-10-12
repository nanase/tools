# 曲のデータの出典とライセンス

楽器の音響モデルで演奏する曲のデータは、公開されている電子楽譜の MIDI から作っています。データは元の MIDI（`.mid`）と、そこからスクリプトで作る音符（`.ts`）の 2 つです。

この 2 つには、リポジトリの MIT ライセンスではなく、曲ごとに次のライセンスが付きます。加工の内容は、各 `.ts` の先頭のコメントに書いています。

| 曲 | ツール | ライセンス |
| --- | --- | --- |
| [シャコンヌ BWV 1004](#シャコンヌ-bwv-1004) | ギター | CC BY-SA 3.0 |
| [前奏曲 ハ長調 BWV 846](#前奏曲-ハ長調-bwv-846) | ピアノ | パブリックドメイン |
| [ジムノペディ 第 1 番](#ジムノペディ-第-1-番) | ピアノ | パブリックドメイン |
| [ジムノペディ 第 2 番](#ジムノペディ-第-2-番) | ピアノ | パブリックドメイン |
| [ジムノペディ 第 3 番](#ジムノペディ-第-3-番) | ピアノ | パブリックドメイン |
| [グノシエンヌ 第 1 番](#グノシエンヌ-第-1-番) | ピアノ | CC BY-SA 4.0 |
| [グノシエンヌ 第 2 番](#グノシエンヌ-第-2-番) | ピアノ | CC BY-SA 4.0 |
| [グノシエンヌ 第 3 番](#グノシエンヌ-第-3-番) | ピアノ | CC BY-SA 4.0 |
| [月光 第 1〜3 楽章](#月光-第-13-楽章) | ピアノ | CC BY-SA 2.5 |
| [トッカータとフーガ ニ短調 BWV 565](#トッカータとフーガ-ニ短調-bwv-565) | オルガン | CC0 |
| [フーガ ト短調 BWV 578](#フーガ-ト短調-bwv-578) | オルガン | CC BY-SA 4.0 |
| [パッサカリアとフーガ ハ短調 BWV 582](#パッサカリアとフーガ-ハ短調-bwv-582) | オルガン | パブリックドメイン |
| [目覚めよと呼ぶ声あり BWV 645](#目覚めよと呼ぶ声あり-bwv-645) | オルガン | CC BY-SA 2.5 |

パブリックドメインの曲のデータには、このリポジトリも著作権を主張しません。

## ギター音響モデル

データは [src/tools/guitar/](src/tools/guitar/) にあり、`bun run chaconne` で作ります。

### シャコンヌ BWV 1004

J. S. バッハ「無伴奏ヴァイオリンのためのパルティータ 第 2 番」より。

- ファイル: [chaconne.mid](src/tools/guitar/chaconne.mid)、[chaconne.ts](src/tools/guitar/chaconne.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1426)（Mutopia-2019/05/30-1426）
- 入力: Hajo Dezelski
- ライセンス: [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
- 加工: MIDI を変換したあと、ギターで弾けるように編集している

## ピアノ音響モデル

データは [src/tools/piano/scores/](src/tools/piano/scores/) にあり、`bun run piano-scores` で作ります。

### 前奏曲 ハ長調 BWV 846

J. S. バッハ「平均律クラヴィーア曲集 第 1 巻」より。

- ファイル: [bwv846.mid](src/tools/piano/scores/bwv846.mid)、[bwv846.ts](src/tools/piano/scores/bwv846.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=5)（Mutopia-2011/09/12-5）
- 入力: Shay Rojansky
- 編集: Han-Wen Nienhuys、Tobias Erbsland
- ライセンス: パブリックドメイン

### ジムノペディ 第 1 番

E. サティ「3 つのジムノペディ」より。

- ファイル: [gymnopedie1.mid](src/tools/piano/scores/gymnopedie1.mid)、[gymnopedie1.ts](src/tools/piano/scores/gymnopedie1.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=37)（Mutopia-2014/12/14-37）
- 入力: Evin Robertson
- ライセンス: パブリックドメイン

### ジムノペディ 第 2 番

E. サティ「3 つのジムノペディ」より。

- ファイル: [gymnopedie2.mid](src/tools/piano/scores/gymnopedie2.mid)、[gymnopedie2.ts](src/tools/piano/scores/gymnopedie2.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=38)（Mutopia-2012/12/23-38）
- 入力: Evin Robertson
- ライセンス: パブリックドメイン

### ジムノペディ 第 3 番

E. サティ「3 つのジムノペディ」より。

- ファイル: [gymnopedie3.mid](src/tools/piano/scores/gymnopedie3.mid)、[gymnopedie3.ts](src/tools/piano/scores/gymnopedie3.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=39)（Mutopia-2012/12/23-39）
- 入力: Evin Robertson
- ライセンス: パブリックドメイン

### グノシエンヌ 第 1 番

E. サティ作曲。

- ファイル: [gnossienne1.mid](src/tools/piano/scores/gnossienne1.mid)、[gnossienne1.ts](src/tools/piano/scores/gnossienne1.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=2035)（Mutopia-2015/07/23-2035）
- 入力: Knute Snortum
- ライセンス: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)

### グノシエンヌ 第 2 番

E. サティ作曲。

- ファイル: [gnossienne2.mid](src/tools/piano/scores/gnossienne2.mid)、[gnossienne2.ts](src/tools/piano/scores/gnossienne2.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=2130)（Mutopia-2016/08/17-2130）
- 入力: Frédéric Duperray
- ライセンス: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)

### グノシエンヌ 第 3 番

E. サティ作曲。

- ファイル: [gnossienne3.mid](src/tools/piano/scores/gnossienne3.mid)、[gnossienne3.ts](src/tools/piano/scores/gnossienne3.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=2131)（Mutopia-2016/08/17-2131）
- 入力: Frédéric Duperray
- ライセンス: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)

### 月光 第 1〜3 楽章

L. v. ベートーヴェン「ピアノ・ソナタ 第 14 番 嬰ハ短調 作品 27-2」。

- ファイル: [src/tools/piano/scores/](src/tools/piano/scores/) の moonlight1〜3 の `.mid` と `.ts`
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=276)（Mutopia-2007/02/11-276）
- 入力: Stewart Holmes。第 3 楽章は Chris Sawer と Stewart Holmes
- ライセンス: [CC BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/)

## オルガン音響モデル

データは [src/tools/organ/scores/](src/tools/organ/scores/) にあり、`bun run organ-scores` で作ります。

### トッカータとフーガ ニ短調 BWV 565

J. S. バッハ作曲。人の演奏を記録した MIDI です。

- ファイル: [bwv565.mid](src/tools/organ/scores/bwv565.mid)、[bwv565.ts](src/tools/organ/scores/bwv565.ts)
- 出典: [OpenGameArt で CC0 として公開された MIDI](https://opengameart.org/content/nes-bach-bwv-565)
- 投稿: TheOuterLinux
- ライセンス: [CC0](https://creativecommons.org/publicdomain/zero/1.0/)

### フーガ ト短調 BWV 578

J. S. バッハ作曲。「小フーガ」とも呼ばれます。

- ファイル: [bwv578.mid](src/tools/organ/scores/bwv578.mid)、[bwv578.ts](src/tools/organ/scores/bwv578.ts)
- 出典: [IMSLP の MIDI](https://imslp.org/wiki/File:PMLP153148-Bach_578_Fugue_Gm.mid)（Les Éditions Outremontaises、2017）
- 作成: Pierre Gouin
- ライセンス: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)

### パッサカリアとフーガ ハ短調 BWV 582

J. S. バッハ作曲。

- ファイル: [bwv582.mid](src/tools/organ/scores/bwv582.mid)、[bwv582.ts](src/tools/organ/scores/bwv582.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=741)（Mutopia-2006/04/21-741）
- 入力: Urs Metzger
- ライセンス: パブリックドメイン

### 目覚めよと呼ぶ声あり BWV 645

J. S. バッハ「シューブラー・コラール集」第 1 曲。

- ファイル: [bwv645.mid](src/tools/organ/scores/bwv645.mid)、[bwv645.ts](src/tools/organ/scores/bwv645.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=601)（Mutopia-2006/06/29-601）
- 入力: Bart Golsteijn
- ライセンス: [CC BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/)
