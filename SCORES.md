# 曲のデータの出典とライセンス

楽器の音響モデルで演奏する曲のデータは、公開されている電子楽譜から作っています。データは元の MIDI（`.mid`）か LilyPond のファイル（`.ly`・`.ily`。ヴァイオリンとトランペット）と、そこからスクリプトで作る音符（`.ts`）の 2 つです。

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
| [幻想即興曲 嬰ハ短調 作品 66](#幻想即興曲-嬰ハ短調-作品-66) | ピアノ | CC0 |
| [ラ・カンパネラ](#ラカンパネラ) | ピアノ | CC0 |
| [水の戯れ](#水の戯れ) | ピアノ | CC0 |
| [アラベスク 第 1 番](#アラベスク-第-1-番) | ピアノ | CC0 |
| [シャコンヌ（ブゾーニ編）](#シャコンヌブゾーニ編) | ピアノ | CC BY 3.0 |
| [トッカータとフーガ ニ短調 BWV 565](#トッカータとフーガ-ニ短調-bwv-565) | オルガン | CC0 |
| [フーガ ト短調 BWV 578](#フーガ-ト短調-bwv-578) | オルガン | CC BY-SA 4.0 |
| [パッサカリアとフーガ ハ短調 BWV 582](#パッサカリアとフーガ-ハ短調-bwv-582) | オルガン | パブリックドメイン |
| [目覚めよと呼ぶ声あり BWV 645](#目覚めよと呼ぶ声あり-bwv-645) | オルガン | CC BY-SA 2.5 |
| [パルティータ 第 2 番 BWV 1004（5 楽章）](#パルティータ-第-2-番-bwv-10045-楽章) | ヴァイオリン | CC BY-SA 3.0 |
| [前奏曲 ホ長調 BWV 1006](#前奏曲-ホ長調-bwv-1006) | ヴァイオリン | CC BY-SA 3.0 |
| [アダージョ ト短調 BWV 1001](#アダージョ-ト短調-bwv-1001) | ヴァイオリン | CC BY-SA 3.0 |
| [エクルズ ソナタ ト短調（グラーヴェ・アダージョ）](#エクルズ-ソナタ-ト短調グラーヴェアダージョ) | ヴァイオリン | パブリックドメイン |
| [ラ・レジュイサンス HWV 351](#ラレジュイサンス-hwv-351) | トランペット | パブリックドメイン |
| [メヌエット ト長調 BWV Anh. 114](#メヌエット-ト長調-bwv-anh-114) | トランペット | パブリックドメイン |
| [アヴェ・マリア（グノー）](#アヴェマリアグノー) | トランペット | パブリックドメイン |
| [御身がともにあるならば BWV 508](#御身がともにあるならば-bwv-508) | トランペット | パブリックドメイン |
| [ナポリの踊り（白鳥の湖）](#ナポリの踊り白鳥の湖) | トランペット | パブリックドメイン |
| [ラッパは鳴り響き（メサイア HWV 56）](#ラッパは鳴り響きメサイア-hwv-56) | トランペット | CC BY 3.0 |
| [消灯ラッパ（Taps）](#消灯ラッパtaps) | トランペット | パブリックドメイン |

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
- 加工: 第 3 楽章の `.mid` は、反復を演奏順に展開し、元の MIDI で崩れていたカデンツァを組み直したもの。ベロシティとテンポの変化は、楽譜の強弱記号から付けた下地をもとに MIDI を編集して付けている

### 幻想即興曲 嬰ハ短調 作品 66

F. ショパン作曲。

- ファイル: [fantaisie.mid](src/tools/piano/scores/fantaisie.mid)、[fantaisie.ts](src/tools/piano/scores/fantaisie.ts)
- 出典: [MuseScore の楽譜](https://musescore.com/user/33306646/scores/6219891)の MIDI。[PDMX](https://zenodo.org/records/15571083)（Long ほか 2024）に収録されたもの
- 作成: venson72150
- ライセンス: [CC0](https://creativecommons.org/publicdomain/zero/1.0/)

### ラ・カンパネラ

F. リスト「パガニーニによる大練習曲」S. 141 より 第 3 番 嬰ト短調。

- ファイル: [campanella.mid](src/tools/piano/scores/campanella.mid)、[campanella.ts](src/tools/piano/scores/campanella.ts)
- 出典: [MuseScore の楽譜](https://musescore.com/user/33306646/scores/6225893)の MIDI。[PDMX](https://zenodo.org/records/15571083)（Long ほか 2024）に収録されたもの
- 作成: venson72150
- ライセンス: [CC0](https://creativecommons.org/publicdomain/zero/1.0/)

### 水の戯れ

M. ラヴェル作曲。

- ファイル: [jeuxdeau.mid](src/tools/piano/scores/jeuxdeau.mid)、[jeuxdeau.ts](src/tools/piano/scores/jeuxdeau.ts)
- 出典: [MuseScore の楽譜](https://musescore.com/user/33306646/scores/6323707)の MIDI。[PDMX](https://zenodo.org/records/15571083)（Long ほか 2024）に収録されたもの
- 作成: venson72150
- ライセンス: [CC0](https://creativecommons.org/publicdomain/zero/1.0/)

### アラベスク 第 1 番

C. ドビュッシー「2 つのアラベスク」より 第 1 番 ホ長調。

- ファイル: [arabesque1.mid](src/tools/piano/scores/arabesque1.mid)、[arabesque1.ts](src/tools/piano/scores/arabesque1.ts)
- 出典: [MuseScore の楽譜](https://musescore.com/user/7789771/scores/5976460)の MIDI。[PDMX](https://zenodo.org/records/15571083)（Long ほか 2024）に収録されたもの
- 作成: The Transcriber
- ライセンス: [CC0](https://creativecommons.org/publicdomain/zero/1.0/)
- 加工: 小節 38 から 39 へのタイ（E5）を、楽譜（Durand 1904）のとおり 1 音にした

### シャコンヌ（ブゾーニ編）

J. S. バッハ「無伴奏ヴァイオリンのためのパルティータ 第 2 番 ニ短調」BWV 1004 より、F. ブゾーニのピアノ編曲。

- ファイル: [busoni-chaconne.mid](src/tools/piano/scores/busoni-chaconne.mid)、[busoni-chaconne.ts](src/tools/piano/scores/busoni-chaconne.ts)
- 出典: [IMSLP の MIDI](https://imslp.org/wiki/Violin_Partita_No.2_in_D_minor,_BWV_1004_(Bach,_Johann_Sebastian))（ファイル #173118）。ブゾーニ自身が演奏した Duo-Art のピアノロールから起こしたもの
- 作成: Hammondmania（2012）
- ライセンス: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)

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

## ヴァイオリン音響モデル

データは [src/tools/violin/scores/](src/tools/violin/scores/) にあり、`bun run violin-scores` で作ります。MIDI ではなく LilyPond のファイルの声部を直接読みます（スラー・トリル・フェルマータ・強弱の記号を残すため）。

加工（どの曲も共通）: 反復を演奏順に展開し、装飾音を除いた。時刻と長さを 4 分音符の 1/960 に丸めた。`.ly` は Mutopia Project の配布ファイルから、入力者のメールアドレスの行（`maintainerEmail`）だけを除いた。

### パルティータ 第 2 番 BWV 1004（5 楽章）

J. S. バッハ「無伴奏ヴァイオリンのためのソナタとパルティータ」より。アルマンド・クーラント・サラバンド・ジーグ・シャコンヌ。

- ファイル: [bwv1004-1.ly](src/tools/violin/scores/bwv1004-1.ly)〜[bwv1004-5.ly](src/tools/violin/scores/bwv1004-5.ly)、[bwv1004-1.ts](src/tools/violin/scores/bwv1004-1.ts)〜[bwv1004-5.ts](src/tools/violin/scores/bwv1004-5.ts)（1 = アルマンド、2 = クーラント、3 = サラバンド、4 = ジーグ、5 = シャコンヌ）
- 出典: Mutopia Project の楽譜（[1423](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1423)・[1424](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1424)・[1427](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1427)・[1428](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1428)・[1426](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1426)）（Mutopia-2010/02/03-1423・Mutopia-2008/05/18-1424・Mutopia-2008/10/29-1427・Mutopia-2008/05/28-1428・Mutopia-2019/05/30-1426）
- 入力: アルマンド・クーラント・シャコンヌは Hajo Dezelski、サラバンド・ジーグは Benjamin D. Esham
- 底本: Bach-Gesellschaft Edition 1879 Band 27.1
- ライセンス: [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)

### 前奏曲 ホ長調 BWV 1006

J. S. バッハ「無伴奏ヴァイオリンのためのパルティータ 第 3 番」より。

- ファイル: [bwv1006-1.ly](src/tools/violin/scores/bwv1006-1.ly)、[bwv1006-1.ts](src/tools/violin/scores/bwv1006-1.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1469)（Mutopia-2008/07/13-1469）
- 入力: Hajo Dezelski
- 底本: Bach-Gesellschaft Edition 1879 Band 27.1
- ライセンス: [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)

### アダージョ ト短調 BWV 1001

J. S. バッハ「無伴奏ヴァイオリンのためのソナタ 第 1 番」より。

- ファイル: [bwv1001-1.ly](src/tools/violin/scores/bwv1001-1.ly)、[bwv1001-1.ts](src/tools/violin/scores/bwv1001-1.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1429)（Mutopia-2008/06/01-1429）
- 入力: Hajo Dezelski
- 底本: Bach-Gesellschaft Edition 1879 Band 27.1
- ライセンス: [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)

### エクルズ ソナタ ト短調（グラーヴェ・アダージョ）

H. エクルズ作曲、J. Salmon によるヴァイオリンとピアノの編曲（1914 年）。ヴァイオリンの声部だけを使う。

- ファイル: [eccles.ly](src/tools/violin/scores/eccles.ly)、[eccles-1.ts](src/tools/violin/scores/eccles-1.ts)（グラーヴェ）、[eccles-3.ts](src/tools/violin/scores/eccles-3.ts)（アダージョ）
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=540)（Mutopia-2015/09/01-540）
- 入力: Benjamin Crowell
- ライセンス: パブリックドメイン

## トランペット音響モデル

データは [src/tools/trumpet/scores/](src/tools/trumpet/scores/) にあり、`bun run trumpet-scores` で作ります。ヴァイオリンと同じく、LilyPond のファイルの旋律の声部を直接読みます（スラー・トリル・フェルマータ・強弱・スタッカート・アクセント・テヌートを残すため）。

加工（どの曲も共通）: 音の高さを実音にした。時刻と長さを 4 分音符の 1/960 に丸めた。Mutopia Project の `.ly` は配布ファイルから、入力者のメールアドレスの行（`maintainerEmail`）だけを除いた（その行のあるメヌエット・アヴェ・マリア・御身がともにあるならば・メサイアのみ）。

### ラ・レジュイサンス HWV 351

G. F. ヘンデル「王宮の花火の音楽」より。C. Lecourt によるトランペットとオルガンの編曲の、トランペットの声部だけを使う。

- ファイル: [hwv351.ly](src/tools/trumpet/scores/hwv351.ly)、[hwv351.ts](src/tools/trumpet/scores/hwv351.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1864)（Mutopia-2013/09/01-1864）
- 入力: Cyprien Lecourt
- 底本: IMSLP
- ライセンス: パブリックドメイン
- 加工: ニ長調で書かれた声部を、楽譜の刷り方（B♭ 管の記譜でハ長調）に合わせて変ロ長調の実音へ下げた。前半と後半の頭の休み（7/8 小節）を除いて弱起にし、前半の反復を展開した

### メヌエット ト長調 BWV Anh. 114

C. ペツォルト作曲（伝 J. S. バッハ）。S. Mohamed による 2 本のトランペットの編曲の、第 1 声部だけを使う。

- ファイル: [bwv-anh114.ly](src/tools/trumpet/scores/bwv-anh114.ly)、[bwv-anh114.ts](src/tools/trumpet/scores/bwv-anh114.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=258)（Mutopia-2011/06/19-258）
- 編曲・入力: Shamim Mohamed
- ライセンス: パブリックドメイン
- 加工: 反復を演奏順に展開した。楽譜に移調の指示がないので、書かれた音を実音とした

### アヴェ・マリア（グノー）

C. グノー「バッハの前奏曲 第 1 番による瞑想曲」。S. Mohamed によるトランペットの編曲。

- ファイル: [ave-maria.ly](src/tools/trumpet/scores/ave-maria.ly)、[ave-maria.ts](src/tools/trumpet/scores/ave-maria.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=256)（Mutopia-2013/01/06-256）
- 編曲・入力: Shamim Mohamed
- ライセンス: パブリックドメイン
- 加工: 最初の 4 小節の休み（前奏）を除いた。楽譜に移調の指示がないので、書かれた音を実音とした

### 御身がともにあるならば BWV 508

G. H. シュテルツェル作曲（伝 J. S. バッハ）。「Bist du bei mir」。S. Mohamed によるトランペットの編曲。

- ファイル: [bwv508.ly](src/tools/trumpet/scores/bwv508.ly)、[bwv508.ts](src/tools/trumpet/scores/bwv508.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=257)（Mutopia-2007/07/08-257）
- 編曲・入力: Shamim Mohamed
- ライセンス: パブリックドメイン
- 加工: 楽譜に移調の指示がないので、書かれた音を実音とした

### ナポリの踊り（白鳥の湖）

P. I. チャイコフスキー「白鳥の湖」より。L. Sardain によるトランペット・タンバリン・ピアノの編曲の、トランペットの声部だけを使う。

- ファイル: [napolitaine.ly](src/tools/trumpet/scores/napolitaine.ly)、[napolitaine.ts](src/tools/trumpet/scores/napolitaine.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=896)（Mutopia-2006/12/22-896）
- 編曲・入力: Laurence Sardain
- ライセンス: パブリックドメイン
- 加工: 最初の 1 小節の休み（前奏）を除いた。声部は実音（変ホ長調）で書かれている

### ラッパは鳴り響き（メサイア HWV 56）

G. F. ヘンデル「メサイア」第 3 部のバスのアリア「The trumpet shall sound」。トランペットの声部だけを使う。

- ファイル: [hwv56-tromba.ily](src/tools/trumpet/scores/hwv56-tromba.ily)（配布ファイルの CDairBass/tromba.ily）、[hwv56-global.ily](src/tools/trumpet/scores/hwv56-global.ily)（CDairBass/global.ily）、[hwv56-header.ly](src/tools/trumpet/scores/hwv56-header.ly)（Messiah-header.ly）、[hwv56.ts](src/tools/trumpet/scores/hwv56.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1732)（Mutopia-2009/12/15-1732）
- 入力: Nicolas Sceaux
- 底本: F. Chrysander 編、ドイツ・ヘンデル協会版 第 45 巻（1902 年）
- ライセンス: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- 加工: アリアの A の部分（Fine まで）だけを使い、B の部分（トランペットは休み）とダル・セーニョの繰り返しは除いた。トランペットが休む小節を除いた

### 消灯ラッパ（Taps）

米軍のビューグルの号令。Mutopia Project にはないので、パブリックドメインの楽譜を手で `.ly` に写した。

- ファイル: [taps.ly](src/tools/trumpet/scores/taps.ly)、[taps.ts](src/tools/trumpet/scores/taps.ts)
- 出典: [Wikimedia Commons の楽譜「Bugle Calls Taps.svg」](https://commons.wikimedia.org/wiki/File:Bugle_Calls_Taps.svg)
- 作成: Jazzmanian（2007 年）
- ライセンス: パブリックドメイン
- 加工: ハ調のビューグルの記譜を、B♭ 管のトランペットがピストンを押さずに吹く実音へ長 2 度下げた

## MIDI を編集するとき

`.mid` を編集して変換し直すと、演奏に反映されます。`.ts` は変換で上書きされるので、直接は編集しません。

| 編集するもの | ギター | ピアノ | オルガン |
| --- | --- | --- | --- |
| 音の高さ・時刻・長さ | 反映する | 反映する | 反映する |
| テンポの変化 | 反映する | 反映する | 反映する |
| ベロシティ | 反映する | 反映する | 使わない |
| ペダル（CC64）などのコントロールチェンジ | 使わない | 使わない | 使わない |

変換のコマンドは、ギターが `bun run chaconne`、ピアノが `bun run piano-scores`、オルガンが `bun run organ-scores` です。

テンポの決まり:

- 最初のテンポを基準にして、そこからの比だけを使う
  - 曲の標準の速さは、各ツールの `score.ts` の `bpm` で決まる
  - MIDI の最初のテンポだけを変えても、速さは変わらない
- ピアノの曲は、MIDI にテンポの変化を入れると、`score.ts` の `tempoMap` を使わなくなる
  - `tempoMap` は、このツールで付けた終わりの rit. などである
  - 残したい変化は、MIDI にも入れる

ベロシティの決まり:

- 2 つ以上の値があるときだけ使う
- 曲の中央の値を基準にして、そこからの比を強さにする
- ジムノペディは、値が 90 の音を「強弱記号のない声部」として扱い、同じ小節の最も弱い値に置き換える
  - 付けたい値が 90 のときは、89 か 91 にする

崩さないもの:

- トラックの順番
  - 譜表や鍵盤を、トラックの番号で決めている
- 反復を展開している曲の、小節の数
  - ジムノペディ 第 1 番、月光 第 2・3 楽章、BWV 645 が当たる
- 特定の音を前提にした手直しのある箇所
  - 月光 第 1・3 楽章、BWV 565・578・582・645 が当たる
  - 合わなくなると、変換はエラーで止まる。そのときはスクリプトの手直しを合わせる

ヴァイオリンの曲は `.ly` を編集して `bun run violin-scores` で変換し直します。強弱の記号と松葉はエクルズの曲だけで使い、バッハの曲の強弱は `src/tools/violin/score.ts` の `plan` で決めます。

トランペットの曲は `.ly`・`.ily` を編集して `bun run trumpet-scores` で変換し直します。強弱の記号と松葉はメヌエット・アヴェ・マリア・御身がともにあるならば・ナポリの踊りで使い、ほかの曲の強弱は `src/tools/trumpet/score.ts` の `plan` で決めます。弾く部分（反復・休みの除き方）は `scripts/trumpet-scores.ts` で決めていて、楽譜の小節線 `|` が拍子とずれると、変換はエラーで止まります。

CC BY-SA・CC BY の曲を編集したら、変更したことをその曲の節の「加工」に書き足します。
