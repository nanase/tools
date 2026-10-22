# 月のデータの出典とライセンス

月のページで使うデータのうち、公開されているデータから作ったものを挙げます。これらには、リポジトリの MIT ライセンスではなく、データごとに次のライセンスが付きます。

| データ | ファイル | ライセンス |
| --- | --- | --- |
| [高さ](#高さlola) | [height8.png](../../../public/moon/height8.png) | パブリックドメイン |
| [模様の色](#模様の色lroc-wac) | [color8.jpg](../../../public/moon/color8.jpg) | パブリックドメイン |
| [地名](#地名) | [features.json](features.json)・[features.meta.json](features.meta.json) | CC BY-SA 4.0 |
| [月食の一覧](#月食の一覧nasa-の五千年月食目録) | [eclipses.json](../../../public/moon/eclipses.json) | NASA の利用条件（謝辞を添えれば複製可） |

ページのフッターには、次の出典表記を出します。

- "NASA's Scientific Visualization Studio"（高さと模様の色）
- "Eclipse Predictions by Fred Espenak, NASA's GSFC"（月食の一覧）
- 地名の日本語名はウィキペディア日本語版（CC BY-SA 4.0）から取ったこと（[地名](#地名)）

## 高さと模様の色（NASA SVS の CGI Moon Kit）

どちらも NASA Scientific Visualization Studio（SVS）の [CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/)（Ernie Wright、2019 年公開）のファイルから作ります。[scripts/moon-textures.ts](../../../scripts/moon-textures.ts) で作ります。

```sh
bun scripts/moon-textures.ts [置き場]
```

置き場は、元のファイルを置くリポジトリの外のディレクトリです。ファイルがなければ SVS からダウンロードします。

- 取得日: 2026-10-22
- ライセンス: パブリックドメイン
- 出典表記: "NASA's Scientific Visualization Studio"（SVS のページの "Please give credit for this item to"）

SVS の[ヘルプ](https://svs.gsfc.nasa.gov/help/)の原文（抜粋）:

> All of our content is in the public domain (unless otherwise noted), meaning that it is free to download, use, and redistribute for whatever purposes you see fit.

### 高さ（LOLA）

- 元のファイル: [ldem_16.tif](https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16.tif)（5760×2880、1° あたり 16 画素）
- 元データ: Lunar Reconnaissance Orbiter（LRO）の Lunar Orbiter Laser Altimeter（LOLA）の格子データ（2019 年春の版）。PDS の Geosciences Node にあるもの
- 値: 半径 1737.4 km の球からの高さ（km、float32）。経度 0° が中央、行 0 が北緯 90°

加工:

- 経度 −100°〜+100°、緯度 +90°〜−90° を切り出した（表側と秤動で見える縁）
- 1° あたり 8 画素（1600×1440）に、2×2 画素の平均で縮めた
- 10 m 刻みの整数 q = round((h + 10) / 0.01) にし、R = q の上位 8 ビット、G = 下位 8 ビット、B = 0 の 8 ビット RGB の PNG にした
  - 色空間のチャンク（gAMA・sRGB・iCCP）は入れない
  - 読み戻した値と元の平均の差は最大 5 m（丸めの分）
  - 範囲は −6.27〜+6.91 km

### 模様の色（LROC WAC）

- 元のファイル: [lroc_color_16bit_srgb_4k.tif](https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_16bit_srgb_4k.tif)（4096×2048、16 ビットの sRGB、LZW 圧縮）
  - SVS の 2025 年 12 月の版の色の地図
- 元データ: LRO Camera（LROC）の Wide Angle Camera（WAC）の [Hapke Normalized WAC Mosaic](https://wms.lroc.asu.edu/lroc/view_rdr/WAC_HAPKE)
  - 643 nm を赤、566 nm を緑、415 nm を青にしている
  - 露出と白の釣り合いを人の目に近づけている
  - 緯度 70° より極側は、LOLA の反射率の地図（LDAM、白黒）で埋めている

加工:

- 高さと同じ範囲・画素数（1600×1440）にした
- sRGB を線形の光の強さに直し、画素の重なりの面積で平均（箱フィルタ）してから、8 ビットの sRGB に丸めた
- このリポジトリの JPEG 符号器（[src/tools/jpeg/encoder.ts](../jpeg/encoder.ts)）で、ベースライン・品質 85・4:2:0・ハフマン表は出現回数から作る、で JPEG にした

## 地名

地名のラベルのデータです。[features.json](features.json) にあり、[scripts/moon-features.ts](../../../scripts/moon-features.ts) で作ります。使った版は [features.meta.json](features.meta.json) にも書いてあります。

```sh
bun scripts/moon-features.ts [置き場]
```

features.json は、ウィキペディアの日本語名を含むため、全体を [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.ja) で配布します。

- 使うとき・再配布するときは、下の「日本語名」の出典表記を付ける
- 改変したものも CC BY-SA 4.0 で配布する（継承）

### データの形

1 件は配列 `[日本語名, 英語名, 緯度, 経度, 直径, 種類]` です。

| 要素 | 中身 |
| --- | --- |
| 日本語名 | ウィキペディアの一覧の名前。ないものは `null`（画面では英語名を出す） |
| 英語名 | IAU の名前（Mare Imbrium、Copernicus） |
| 緯度・経度 | 中心。度で小数 2 桁。経度は東が正の −180〜180 |
| 直径 | km で小数 1 桁 |
| 種類 | `mare`（海・大洋・湖・入江・沼）、`crater`、`mons`（山・山脈）、`other`（断崖・谷・岬） |

- 選んだもの:
  - 海・大洋・湖・入江・沼: すべて（59 件）
  - クレーター: 直径 20 km 以上で、中心の経度が −100°〜+100° のもの（687 件）
  - 山・山脈・断崖・谷・岬: 日本語名があるもの（81 件）
- 件数: 827 件。うち日本語名があるのは 230 件（クレーターは 91 件）
- 並び: 直径の大きい順

### 地名・位置・直径（USGS/IAU）

- 出典: [Gazetteer of Planetary Nomenclature](https://planetarynames.wr.usgs.gov/)（IAU Working Group for Planetary System Nomenclature、USGS Astrogeology Science Center）の [GIS Downloads](https://planetarynames.wr.usgs.gov/GIS_Downloads) の `MOON_nomenclature_center_pts.zip`
  - zip は毎日作り直されている。使ったのは 2026-10-22 版（9087 件、すべて "Adopted by IAU"）
- 取得日: 2026-10-23
- ライセンス: パブリックドメイン（zip の中のメタデータ `metadata_nomenclature_points_MOON.xml` の `useconst` が "Public domain."）
- 出典表記: 不要

### 日本語名（ウィキペディア）

- 出典: ウィキペディア日本語版の次の 3 つの一覧。版を固定して MediaWiki API で取る
  - [月の海の一覧](https://ja.wikipedia.org/w/index.php?oldid=103420195)（版 103420195、2025-01-20）（[履歴](https://ja.wikipedia.org/w/index.php?title=%E6%9C%88%E3%81%AE%E6%B5%B7%E3%81%AE%E4%B8%80%E8%A6%A7&action=history)）
  - [月のクレーターの一覧](https://ja.wikipedia.org/w/index.php?oldid=104605018)（版 104605018、2025-04-24）（[履歴](https://ja.wikipedia.org/w/index.php?title=%E6%9C%88%E3%81%AE%E3%82%AF%E3%83%AC%E3%83%BC%E3%82%BF%E3%83%BC%E3%81%AE%E4%B8%80%E8%A6%A7&action=history)）
  - [月の地形一覧](https://ja.wikipedia.org/w/index.php?oldid=103502553)（版 103502553、2025-01-26）（[履歴](https://ja.wikipedia.org/w/index.php?title=%E6%9C%88%E3%81%AE%E5%9C%B0%E5%BD%A2%E4%B8%80%E8%A6%A7&action=history)）
- 取得日: 2026-10-23
- ライセンス: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.ja)（ウィキペディア日本語版の API の `rightsinfo` による）
- 出典表記（例）: 「地名の日本語名: ウィキペディア日本語版『月の海の一覧』『月のクレーターの一覧』『月の地形一覧』の執筆者（CC BY-SA 4.0）。表から名前を抜き出し、IAU の地名と対応させた」

加工:

- 表の名前とラテン語名（英語名）を、IAU の地名と照らし合わせた
  - 照合は、ダイアクリティカルマークを外し、英数字だけを小文字で比べる
- 同じ地名が複数のページにあるときは、月の海の一覧 → 月のクレーターの一覧 → 月の地形一覧 の順に先のものを使った
- 次の 2 つは、月の海の一覧の名前ではなく記事名を使った。月の海の一覧のリンクが転送で、記事名と月の地形一覧の表記がこちらのため
  - Mare Frigoris: 寒さの海（月の海の一覧は「氷の海」）
  - Sinus Iridum: 虹の入江（月の海の一覧は「虹の入り江」）
- 月の地形一覧の「峡谷」の表にはラテン語名がない。12 件をスクリプトの中の表で Vallis の名前に対応させた（アルプス峡谷 → Vallis Alpes など）
- 曖昧さ回避の「(月のクレーター)」は外した（スクロドフスカ）
- Sinus Viscositatis の「粘りの入江」は、月の海の一覧で仮訳とされている名前

日本語名がないもの:

- Lacus Tenebrarum（新しい名前で、どの一覧にもない）
- クレーターの多く（687 件のうち 596 件）。月のクレーターの一覧が一部のクレーターしか載せていないため。クラヴィウス・プトレマイオス・アルキメデス・グリマルディなどにも、日本語版の記事がない

## 月食の一覧（NASA の五千年月食目録）

1900〜2100 年の 459 件の月食です。[eclipses.json](../../../public/moon/eclipses.json) にあり、[scripts/moon-eclipses.ts](../../../scripts/moon-eclipses.ts) で作ります。

```sh
bun scripts/moon-eclipses.ts [置き場]
```

- 出典: [5MKLEcatalog.txt](https://eclipse.gsfc.nasa.gov/5MCLE/5MKLEcatalog.txt)（NASA Goddard Space Flight Center、Fred Espenak）
- 予報の元: F. Espenak & J. Meeus, *Five Millennium Catalog of Lunar Eclipses: −1999 to +3000*, NASA/TP-2009-214173（2009）
- 取得日: 2026-10-22
- 利用条件: "Permission is freely granted to reproduce this data when accompanied by an acknowledgment: "Eclipse Predictions by Fred Espenak (NASA's GSFC)""（[Five Millennium Catalog of Lunar Eclipses](https://eclipse.gsfc.nasa.gov/LEcat5/LEcatalog.html)）
- 出典表記: ページのフッターに "Eclipse Predictions by Fred Espenak, NASA's GSFC" を出す

### データの形

1 件は配列 `[年, 月, 日, 時刻, ΔT, サロス, 種類, γ, 半影食分, 本影食分, 半影食の時間, 部分食の時間, 皆既食の時間]` です。

- 時刻: 食の最大の時刻（力学時 TD）を、0 時からの秒にした
- ΔT: 秒
- 種類: 目録のまま（N・Nx・Nb・Ne・P・T・T+・T-）
- 時間: 分。部分食・皆既食がないものは `null`
- 件数: 459 件（皆既 166、部分 122、半影 171）
- 加工: 列を選び、時刻を秒にしただけ。値は変えない
