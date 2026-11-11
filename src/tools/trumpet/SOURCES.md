# トランペット音響モデルの曲の出典とライセンス

トランペット音響モデルのページで演奏する曲の出典とライセンスです。曲の一覧は [SCORES.md](../../../SCORES.md) にあります。

データは [scores/](scores/) にあり、`bun run trumpet-scores` で作ります。ヴァイオリンと同じく、LilyPond のファイルの旋律の声部を直接読みます（スラー・トリル・フェルマータ・強弱・スタッカート・アクセント・テヌートを残すため）。

## どの曲にも共通の加工

- 音の高さを実音にした
- 時刻と長さを 4 分音符の 1/960 に丸めた
- Mutopia Project の `.ly` は配布ファイルから、入力者のメールアドレスの行（`maintainerEmail`）だけを除いた
  - その行があるのはメヌエット・アヴェ・マリア・御身がともにあるならば・メサイアだけ

## ラ・レジュイサンス HWV 351

G. F. ヘンデル「王宮の花火の音楽」より。C. Lecourt によるトランペットとオルガンの編曲の、トランペットの声部だけを使います。

- ファイル: [hwv351.ly](scores/hwv351.ly)、[hwv351.ts](scores/hwv351.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1864)（Mutopia-2013/09/01-1864）
- 入力: Cyprien Lecourt
- 底本: IMSLP
- ライセンス: パブリックドメイン
- 加工: ニ長調で書かれた声部を、楽譜の刷り方（B♭ 管の記譜でハ長調）に合わせて変ロ長調の実音へ下げた。前半と後半の頭の休み（7/8 小節）を除いて弱起にし、前半の反復を展開した

## メヌエット ト長調 BWV Anh. 114

C. ペツォルト作曲（伝 J. S. バッハ）。S. Mohamed による 2 本のトランペットの編曲の、第 1 声部だけを使います。

- ファイル: [bwv-anh114.ly](scores/bwv-anh114.ly)、[bwv-anh114.ts](scores/bwv-anh114.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=258)（Mutopia-2011/06/19-258）
- 編曲・入力: Shamim Mohamed
- ライセンス: パブリックドメイン
- 加工: 反復を演奏順に展開した。楽譜に移調の指示がないので、書かれた音を実音とした

## アヴェ・マリア（グノー）

C. グノー「バッハの前奏曲 第 1 番による瞑想曲」。S. Mohamed によるトランペットの編曲。

- ファイル: [ave-maria.ly](scores/ave-maria.ly)、[ave-maria.ts](scores/ave-maria.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=256)（Mutopia-2013/01/06-256）
- 編曲・入力: Shamim Mohamed
- ライセンス: パブリックドメイン
- 加工: 最初の 4 小節の休み（前奏）を除いた。楽譜に移調の指示がないので、書かれた音を実音とした

## 御身がともにあるならば BWV 508

G. H. シュテルツェル作曲（伝 J. S. バッハ）。「Bist du bei mir」。S. Mohamed によるトランペットの編曲。

- ファイル: [bwv508.ly](scores/bwv508.ly)、[bwv508.ts](scores/bwv508.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=257)（Mutopia-2007/07/08-257）
- 編曲・入力: Shamim Mohamed
- ライセンス: パブリックドメイン
- 加工: 楽譜に移調の指示がないので、書かれた音を実音とした

## ナポリの踊り（白鳥の湖）

P. I. チャイコフスキー「白鳥の湖」より。L. Sardain によるトランペット・タンバリン・ピアノの編曲の、トランペットの声部だけを使います。

- ファイル: [napolitaine.ly](scores/napolitaine.ly)、[napolitaine.ts](scores/napolitaine.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=896)（Mutopia-2006/12/22-896）
- 編曲・入力: Laurence Sardain
- ライセンス: パブリックドメイン
- 加工: 最初の 1 小節の休み（前奏）を除いた。声部は実音（変ホ長調）で書かれている

## ラッパは鳴り響き（メサイア HWV 56）

G. F. ヘンデル「メサイア」第 3 部のバスのアリア「The trumpet shall sound」。トランペットの声部だけを使います。

- ファイル: [hwv56-tromba.ily](scores/hwv56-tromba.ily)（配布ファイルの CDairBass/tromba.ily）、[hwv56-global.ily](scores/hwv56-global.ily)（CDairBass/global.ily）、[hwv56-header.ly](scores/hwv56-header.ly)（Messiah-header.ly）、[hwv56.ts](scores/hwv56.ts)
- 出典: [Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1732)（Mutopia-2009/12/15-1732）
- 入力: Nicolas Sceaux
- 底本: F. Chrysander 編、ドイツ・ヘンデル協会版 第 45 巻（1902 年）
- ライセンス: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- 加工: アリアの A の部分（Fine まで）だけを使い、B の部分（トランペットは休み）とダル・セーニョの繰り返しは除いた。トランペットが休む小節を除いた

## 消灯ラッパ（Taps）

米軍のビューグルの号令です。Mutopia Project にないので、パブリックドメインの楽譜を手で `.ly` に写しました。

- ファイル: [taps.ly](scores/taps.ly)、[taps.ts](scores/taps.ts)
- 出典: [Wikimedia Commons の楽譜「Bugle Calls Taps.svg」](https://commons.wikimedia.org/wiki/File:Bugle_Calls_Taps.svg)
- 作成: Jazzmanian（2007 年）
- ライセンス: パブリックドメイン
- 加工: ハ調のビューグルの記譜を、B♭ 管のトランペットがピストンを押さずに吹く実音へ長 2 度下げた
