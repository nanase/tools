# 土星のデータの出典とライセンス

土星のページで使うデータとコードのうち、外から取り込んだものを挙げます。これらにはリポジトリの MIT ライセンスではなく、それぞれの許諾が付きます。

| データ | ファイル | ライセンス |
| --- | --- | --- |
| [模様の帯](#模様の帯opal) | [public/saturn/s2025a.webp](../../../public/saturn/s2025a.webp) | CC BY 4.0 |
| [環の表](#環の表) | [public/saturn/rings.bin](../../../public/saturn/rings.bin) | NASA のデータ |
| [8 衛星の位置](#8-衛星の位置meeus-46-章) | [meeus46.ts](meeus46.ts) | MIT（astronomia） |
| [土星の位置](#土星の位置vsop87d) | [vsop.ts](vsop.ts) | 論文と IMCCE の公開データ |
| [すべての衛星](#すべての衛星) | [public/saturn/moons.json](../../../public/saturn/moons.json)・[model.ts](model.ts) の `INNER`・[phoebe.ts](phoebe.ts) | 位置は JPL Horizons、名前と群は CC BY-SA 4.0 |

ページのフッターには OPAL の謝辞（Hubble の OPAL、PI と提案番号、STScI、DOI）、環のデータの出典、astronomia の著作権表示、ウィキペディア日本語版から取ったことを出します。

## 模様の帯（OPAL）

Hubble 宇宙望遠鏡の Outer Planet Atmospheres Legacy（OPAL）の全球の地図（色合成の TIFF）から作ります。[scripts/saturn-rings.ts](../../../scripts/saturn-rings.ts) が環の表と一緒に作ります。

```sh
bun run saturn-rings [置き場]
```

置き場は元のファイルを置くリポジトリの外のディレクトリです。ファイルがなければダウンロードします。画像の読み書きに ImageMagick（`magick`）を使います。

- 元のファイル: `hlsp_opal_hst_wfc3-uvis_saturn-2025a_f395n-f502n-f631n_v1_globalmap.tif`
  - 置き場所: <https://archive.stsci.edu/hlsps/opal/cycle32/saturn/>
  - 1800×900、1° あたり 5 画素、上端が惑星図緯度 +90°
  - 周縁減光は Minnaert 則で除いてある（k は赤 0.80・緑 0.65・青 0.40）
- 加工
  - 行ごとの中央値にして経度方向にならす
  - 環で隠れた赤道と撮れていない極は、近い行の間を直線で埋める
  - sRGB の値に 1.12・0.96・0.70 を掛けて、淡い黄土色へ寄せる
  - 4×900 の WebP（可逆）にする
- 取得日: 2026-11-01
- ライセンス: CC BY 4.0
- 引用: A. A. Simon et al., ApJ 812, 55 (2015)

MAST の README が求める謝辞:

> This work used data acquired from the NASA/ESA HST Space Telescope, associated with OPAL program (PI: Simon, GO13937), and archived by the Space Telescope Science Institute, which is operated by the Association of Universities for Research in Astronomy, Inc., under NASA contract NAS 5-26555. All maps are available at http://dx.doi.org/10.17909/T9G593.

## 環の表

半径 74000〜141000 km を 4000 点に分け、1 点あたり 4 バイト（sRGB の色と、a = 1 − exp(−τ)）を並べます。

- 光学的厚さ τ: PDS Ring-Moon Systems Node の [COVIMS_8001](https://pds-rings.seti.org/holdings/volumes/COVIMS_8xxx/COVIMS_8001/)
  - Cassini VIMS の γ Cru の恒星掩蔽 32 回（`VIMS_*_GAMCRU_*_TAU_10KM.TAB`）の中央値
  - NASA の PDS のデータ。再配布の条件の明文は見当たらなかった
- 色: [PIA11142](https://pds-rings.seti.org/press_releases/pages/PIA11xxx/PIA11142.html) "A Full Sweep of Saturn's Rings"
  - クレジット: NASA/JPL/Space Science Institute
  - [JPL の画像の利用条件](https://www.jpl.nasa.gov/jpl-image-use-policy/)に従い、出典を書き、ロゴを使わず、推薦と取れる使い方をしない
  - 画像そのものは同梱しない。中央の行の明るさを τ の式で割った色だけを持つ
- 取得日: 2026-11-01

## 8 衛星の位置（Meeus 46 章）

astronomia 4 系の `saturnmoons.js`（Meeus『Astronomical Algorithms』46 章の移植）の計算を写し、直交座標を返すように変えました。

- 元: <https://github.com/commenthol/astronomia>（Go の元は <https://github.com/soniakeys/meeus>）
- ライセンス: MIT。著作権表示と許諾文を [meeus46.ts](meeus46.ts) の冒頭に残す

## 土星の位置（VSOP87D）

IMCCE の [VSOP87D.sat](https://ftp.imcce.fr/pub/ephem/planets/vsop87/VSOP87D.sat) の 5759 項から、振幅 × 0.1<sup>p</sup> ≥ 3 × 10<sup>−7</sup> の 374 項を残しました。p は時間のべきです。動径は閾値を土星の軌道半径の 9.55 倍にしました。

## すべての衛星

[scripts/saturn-moons.ts](../../../scripts/saturn-moons.ts) で作ります。

```sh
bun run saturn-moons [置き場]
```

- 位置: [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) の土星中心のベクトル（ICRF）
  - 取得日: 2026-11-01
  - 外側の 269 個は 2015-01-01 から 180 日おきの 45 時点
  - 環のすぐ外の 15 個は円軌道と正弦波を当てはめ、スクリプトが出す値を [model.ts](model.ts) の `INNER` に写す
  - ダフニスは Horizons の暦が 2018-01 までなので、それまでの位置で当てはめた
  - フェーベは 1900-01-01 から 1460 日おきの 51 時点を [phoebe.ts](phoebe.ts) に書く
- 名前と群: ウィキペディア日本語版「[土星の衛星](https://ja.wikipedia.org/w/index.php?title=%E5%9C%9F%E6%98%9F%E3%81%AE%E8%A1%9B%E6%98%9F&oldid=111388335)」の一覧（版 111388335、CC BY-SA 4.0）
  - 一覧にない 146 個は仮符号を名前にし、群は軌道の傾きから決める
  - moons.json はこのライセンスを引き継ぐ
