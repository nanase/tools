# 日食のデータの出典とライセンス

日食のページで使うデータのうち、公開されているデータから作ったものを挙げます。これらには、リポジトリの MIT ライセンスではなく、データごとに次のライセンスが付きます。

| データ | ファイル | ライセンス |
| --- | --- | --- |
| [日食の要素](#日食の要素nasa-の五千年正典) | [data/5mcse-besselian.csv](data/5mcse-besselian.csv) | NASA の利用条件（謝辞を添えれば複製可） |
| [陸地](#陸地natural-earth) | [land110.json](../../../public/solar-eclipse/land110.json)・[land50.json](../../../public/solar-eclipse/land50.json) | パブリックドメイン |
| [観測地の地名](#観測地の地名) | [places.json](places.json) | CC BY 4.0・公共データ利用規約 第 1.0 版（PDL1.0）・パブリックドメイン・CC0 |

## 日食の要素（NASA の五千年正典）

−1999〜+3000 年の 11,898 件の日食の目録とベッセル要素です。ビルドのときにこの CSV から 100 年ごと・サロス系列ごとの JSON を作り、ページはそれを読み込みます（[src/pages/solar-eclipse/](../../pages/solar-eclipse/)）。

- ファイル: [data/5mcse-besselian.csv](data/5mcse-besselian.csv)（取得したままで、加工していない）
- 出典: [eclipse_besselian_from_mysqldump2.csv](https://eclipse.gsfc.nasa.gov/eclipse_besselian_from_mysqldump2.csv)（NASA Goddard Space Flight Center、Fred Espenak）
- 予報の元: F. Espenak & J. Meeus, *Five Millennium Canon of Solar Eclipses: −1999 to +3000*, NASA/TP-2006-214141（2006）
- 取得日: 2026-10-16
- 利用条件: "Permission is freely granted to reproduce this data when accompanied by an acknowledgment: Eclipse Predictions by Fred Espenak (NASA's GSFC)"（[NASA SEcatalog](https://eclipse.gsfc.nasa.gov/SEcat5/SEcatalog.html)）
- 出典表記: ページのフッターに "Eclipse Predictions by Fred Espenak, NASA's GSFC" を出す
- 加工: ブラウザへ送るときに列を絞り（μ2 と tmin・tmax を除く）、数の並びに詰める（[pack.ts](pack.ts)）。値は変えない

## 陸地（Natural Earth）

地図・地球儀・サロス系列の図に描く陸地です。

- ファイル: [public/solar-eclipse/land110.json](../../../public/solar-eclipse/land110.json)（1:110m）、[land50.json](../../../public/solar-eclipse/land50.json)（1:50m）
- 出典: [Natural Earth](https://www.naturalearthdata.com/) の Physical Vectors の Land（[natural-earth-vector](https://github.com/nvkelso/natural-earth-vector) の GeoJSON）
- 取得日: 2026-10-16
- ライセンス: パブリックドメイン（"All versions of Natural Earth raster + vector map data found on this website are in the public domain."、[Terms of Use](https://www.naturalearthdata.com/about/terms-of-use/)）
- 加工: 座標を 0.01° に丸めた整数の並びにした（[scripts/solar-eclipse-land.ts](../../../scripts/solar-eclipse-land.ts)）

## 観測地の地名

地名で観測地を探すためのデータです。[places.json](places.json) にあり、[scripts/solar-eclipse-places.ts](../../../scripts/solar-eclipse-places.ts) で作ります。

```sh
bun scripts/solar-eclipse-places.ts <P05-22_GML.zip> <000925835.xlsx> <ne_10m_populated_places.zip> <ne_10m_admin_0_countries.zip>
```

引数は、下の出典からダウンロードしたファイルです。展開せずに渡します。

places.json を使うとき・再配布するときは、国土数値情報と総務省の出典表記を付けます。

- 「国土数値情報（市町村役場等及び公的集会施設データ）」（国土交通省）（<https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P05-2022.html>）を加工して作成
- 「全国地方公共団体コード」（総務省）（<https://www.soumu.go.jp/denshijiti/code.html>）を加工して作成

Natural Earth と Wikidata の部分には、出典表記の義務はありません。

### データの形

1 件は配列 `[表示名, 読み, 補足, 緯度, 経度, 英語名]` です。

| 要素 | 日本 | 世界 |
| --- | --- | --- |
| 表示名 | 市の名前（長野市） | 日本語の名前（ニューヨーク、北京） |
| 読み | ひらがな（ながのし） | ひらがな（にゅーよーく、ぺきん） |
| 補足 | 都道府県名（長野県） | 国・地域の名前（アメリカ） |
| 緯度・経度 | 市役所の位置 | 都市の代表点 |
| 英語名 | 空文字 | ASCII の英語名（New York City） |

- 件数: 日本 793 件（市 792 件と東京 1 件）、世界 492 件
- 並び: 日本（団体コードの順）を先に、世界（人口の多い順）を後に置く
- 緯度・経度: 度で、小数 4 桁に丸める
- 標高: 入れない
- 取得日: どの出典も 2026-10-16

### 日本の市の位置

- 出典: [国土数値情報 市町村役場等及び公的集会施設データ](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P05-2022.html) 2022 年（令和 4 年）版の全国のファイル `P05-22_GML.zip`
  - データの基準年月は 2022 年 4 月
  - 座標系は JGD2011
- 作成: 国土交通省
- ライセンス: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode.ja)
  - データのページの「このデータの使用許諾条件」が「オープンデータ（CC_BY_4.0）」
  - 条件は [国土数値情報ダウンロードサイトコンテンツ利用規約（政府標準利用規約準拠版）](https://nlftp.mlit.go.jp/ksj/other/agreement_01.html)
- 出典表記: 「国土数値情報（市町村役場等及び公的集会施設データ）」（国土交通省）（<https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P05-2022.html>）を加工して作成

利用規約の原文（抜粋）:

> 当国土数値情報ダウンロードサイトで公開している情報（以下「コンテンツ」といいます。）は、どなたでも以下の１）～６）に従って、複製、公衆送信、翻訳・変形等の翻案等、自由に利用できます。商用利用も可能です。
>
> ア　コンテンツを利用する際は出典を記載してください。（略）
>
> イ　コンテンツを編集・加工して利用する場合は、上記出典とは別に、編集・加工等を行ったことを記載してください。なお、編集・加工した情報を、あたかも国（又は府省等）が作成したかのような態様で公表・利用してはいけません。
>
> 本利用ルールは、クリエイティブ・コモンズ・ライセンスの表示4.0国際（（略））と互換性があり、本利用ルールが適用されるコンテンツはCCBYに従うことでも利用することができます。

### 日本の市の名前と読み

- 出典: 総務省 [全国地方公共団体コード](https://www.soumu.go.jp/denshijiti/code.html) の「都道府県コード及び市区町村コード」（令和 6 年 1 月 1 日更新）の [Excel ファイル](https://www.soumu.go.jp/main_content/000925835.xlsx)
  - 市の数は 792 で、[e-Stat の市区町村数](https://www.e-stat.go.jp/municipalities/number-of-municipalities)（政令市 20、市 772）と一致する
- ライセンス: [公共データ利用規約（第 1.0 版）](https://www.digital.go.jp/resources/open_data/public_data_license_v1.0)（PDL1.0）
  - 総務省のサイトの[著作権について](https://www.soumu.go.jp/menu_kyotsuu/policy/tyosaku.html)による
  - CC BY 4.0 と互換
- 出典表記: 「全国地方公共団体コード」（総務省）（<https://www.soumu.go.jp/denshijiti/code.html>）を加工して作成

総務省のサイトの「著作権について」の原文（抜粋）:

> 当ホームページで公開している情報（以下「コンテンツ」といいます。）の著作権は、特記されていない限り総務省に帰属し、権利表記の記載がない限り「 公共データ利用規約（第1.0版） 」に準拠した利用条件の下で利用することができます。
>
> イ　コンテンツを編集・加工等して利用する場合は、上記出典とは別に、編集・加工等を行ったことを記載してください。なお、編集・加工した情報を、あたかも国（又は府省等）が作成したかのような態様で公表・利用してはいけません。
>
> 「○○動向調査」（総務省） （当該ページのURL）を加工して作成

公共データ利用規約（第 1.0 版）の原文（抜粋）:

> 本利用ルールは、クリエイティブ・コモンズ・ライセンスの表示4.0　国際ライセンスに規定される著作権利用許諾条件（以下「CC BY」といいます。）と互換性があります。国（（略））は、本利用ルールが適用される本コンテンツについて、利用者がCC BYに従って利用することを許諾します。

### 世界の都市と国名

- 出典: [Natural Earth](https://www.naturalearthdata.com/) 1:10m Cultural Vectors
  - [Populated Places](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/) 5.1.2（`ne_10m_populated_places.zip`）
  - [Admin 0 – Countries](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/) 5.1.1（`ne_10m_admin_0_countries.zip`）
  - ファイルは <https://naciscdn.org/naturalearth/10m/cultural/> から取得
- ライセンス: パブリックドメイン
  - 日本語名・英語名（`NAME_JA`・`NAME_EN`）は、Natural Earth が Wikidata（CC0）から取ったもの
- 出典表記: 不要。付けるなら「Made with Natural Earth.」

[Terms of Use](https://www.naturalearthdata.com/about/terms-of-use/) の原文（抜粋）:

> All versions of Natural Earth raster + vector map data found on this website are in the public domain. You may use the maps in any manner, including modifying the content and design, electronic dissemination, and offset printing.
>
> No permission is needed to use Natural Earth. Crediting the authors is unnecessary.
>
> The authors’ used name data for more than 20 languages from Wikidata which is under a CC0 (public domain) license.

### 東京都庁・潟上市役所・安芸市役所の位置

- 出典: [Wikidata](https://www.wikidata.org/) の座標（P625）
  - 東京都庁舎: [Q111973](https://www.wikidata.org/wiki/Q111973)（北緯 35.68951°、東経 139.69171°）
  - 潟上市: [Q646780](https://www.wikidata.org/wiki/Q646780)（北緯 39.85725°、東経 140.013028°）
  - 安芸市: [Q417825](https://www.wikidata.org/wiki/Q417825)（北緯 33.516389°、東経 133.906111°）
  - 値はスクリプトに書いてある
- ライセンス: [CC0](https://creativecommons.org/publicdomain/zero/1.0/)
- 出典表記: 不要

[Wikidata:Copyright](https://www.wikidata.org/wiki/Wikidata:Copyright) の原文（抜粋）:

> All structured data from the main, Property, Lexeme, and EntitySchema namespaces is available under the Creative Commons CC0 License

### 加工（日本）

- 総務省の表のうち、名前が「市」で終わる団体（792 件）を団体コードの順に入れた
  - 東京都の特別区・町・村、政令指定都市の区は入れない
- 東京は 23 区に分けず「東京」1 件にした
  - 読みは「とうきょう」、補足は「東京都庁」、位置は東京都庁舎（Wikidata）
  - 東京都の市（八王子市など）の前に置く
- 読みは、表の半角カナをひらがなにした
- 位置は、P05 の施設分類「本庁」（コード 1）のうち、名前が「〇〇市役所」の施設
  - 同じ都道府県の中で名前で探す。政令指定都市の市役所は区のコードで入っているため
  - 鎌ケ谷市は「鎌ケ谷市役所」と「鎌ヶ谷市役所」の 2 件がある。総務省の表と同じ書き方の方を使う
  - 石狩市役所は芽室町のコードにも入っている。石狩市のコードの方を使う

本庁が P05 にない市・P05 の本庁が今の本庁でない市は、市の公式サイトに載っている市役所の所在地を確かめて（2026-10-16）、次の位置を使いました。

| 市 | 使った位置 | 理由 |
| --- | --- | --- |
| 旭川市 | P05 の「総合庁舎」（6条通9） | 本庁がない。市役所は 7条通9丁目の総合庁舎 |
| 仙北市 | P05 の「仙北市役所田沢湖庁舎」 | 本庁がない。市の代表（総務課）が田沢湖生保内字宮ノ後30 |
| 那須烏山市 | P05 の「烏山庁舎」 | 本庁がない。市が 2 つの庁舎のうち先に挙げている烏山庁舎（中央1-1-1） |
| 北名古屋市 | P05 の「北名古屋市役所西庁舎」 | 本庁がない。市が 2 つの庁舎のうち先に挙げている西庁舎（西之保清水田15） |
| 安来市 | P05 の「安来庁舎」 | 本庁がない。市役所は安来町878-2 の安来庁舎 |
| 志布志市 | P05 の「志布志支所」 | 2021 年から本庁を志布志支所の庁舎（志布志町志布志2-1-1）へ移した。P05 の本庁は有明町の旧本庁 |
| 潟上市 | Wikidata の座標 | 今の市役所（天王字棒沼台226-1）が P05 にない |
| 安芸市 | Wikidata の座標 | 2024 年 1 月に本庁が土居82-1 の新庁舎へ移った。P05 の本庁は矢ノ丸の旧庁舎 |

北名古屋市は、西庁舎と東庁舎（熊之庄御榊60、約 2 km 東）のどちらが本庁かを確かめられていません。

安芸市の Wikidata には座標が 2 つあります。国土地理院の逆ジオコーダで「土居」に入る方を使いました。

P05 は 2022 年 4 月時点のデータです。P05 の位置は、Wikidata の市の座標と比べて確かめました（2026-10-16）。

- 1 km 以上離れていたのは 18 市
- 志布志市と安芸市は、市役所が移っていた（上の表）
- 残る 16 市は、P05 の本庁の住所が、市の公式サイトの市役所の所在地と同じだった
- 1 km 未満の市と、Wikidata の座標も古い市は、移転を見つけられていない

### 加工（世界）

- 選んだ都市（`ne_10m_populated_places`）:
  - 首都・属領の首府（`FEATURECLA` が「Admin-0」で始まるもの、または `ADM0CAP` が 1）
  - 規模の順位 `SCALERANK` が 0〜2 の都市
  - `SCALERANK` が 3 で、人口 `POP_MAX` が 50 万人以上の都市
  - `SCALERANK` が 4 で、`POP_MAX` が 200 万人以上の都市
- 落とした都市:
  - 日本の都市（`ADM0_A3` が JPN）。日本の市と重ねないため
  - Jinxi（中国）。日本語名が別の町（錦渓鎮）になっているため
- 表示名は `NAME_JA`
  - 中国・台湾・韓国・北朝鮮・香港・マカオの都市は、末尾の「市」「特別市」「広域市」を外した（北京市 → 北京、ソウル特別市 → ソウル）
  - 直した名前: アスタナ（ヌル-スルタン）、キーウ（キエフ）、ブリュッセル（ブリュッセル＝ヴィル）、フナフティ（フナフティ島）、マルキョク（マルキョク州）、哈密（伊州区）
- 読みは、カタカナの名前をひらがなにした
  - 「・」「＝」は除いた。検索は読みの前方一致のため
  - 「〇〇市」（クウェート市など）は「〇〇し」にした
  - 漢字の都市名 52 件と「ワシントンD.C.」は、日本で使う読みをこのリポジトリで付けた（廈門 → あもい、高雄 → たかお など）
- 英語名は `NAME_EN` を ASCII にした（São Paulo → Sao Paulo）
  - 直した名前: Tampico（Ciudad Madero Tamaulipas）、Hami（Yizhou）、Astana（Nur-Sultan）
- 国名は、都市の `ADM0_A3` で `ne_10m_admin_0_countries` の `NAME_JA` を引いた
  - 南スーダン（都市は SSD、国の表は SDS）を合わせた
  - ロングイェールビーン（SJM）は、国の表で含まれるノルウェーにした
  - 短い名前にした国: アメリカ、中国、台湾、韓国、北朝鮮、タイ、モンゴル、マリ、コソボ、南アフリカ

### 使わなかったデータ

| データ | 理由 |
| --- | --- |
| [国土数値情報 市区町村役場データ（P34）](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P34.html) 2014 年度版 | 使用許諾条件が「非商用」 |
| [国土数値情報 市町村役場等及び公的集会施設データ（P05）](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P05.html) 2010 年版 | 使用許諾条件が「非商用」 |
| [国土数値情報 国・都道府県の機関データ（P28）](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P28-2022.html) 2022 年度版 | 使用許諾条件が「非商用」。東京都庁の位置は Wikidata から取った |
