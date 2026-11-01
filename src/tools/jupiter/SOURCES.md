# 木星のデータの出典とライセンス

木星のページで使うデータとコードのうち、外から取り込んだものを挙げます。これらには、リポジトリの MIT ライセンスではなく、それぞれの許諾が付きます。

| データ | ファイル | ライセンス |
| --- | --- | --- |
| [模様の地図](#模様の地図opal) | [public/jupiter/](../../../public/jupiter/) の `j*.webp` | CC BY 4.0 |
| [ガリレオ衛星の位置](#ガリレオ衛星の位置astronomy-engine) | [galilean.ts](galilean.ts) | MIT（Astronomy Engine） |
| [木星の位置](#木星の位置vsop87d) | [vsop.ts](vsop.ts) | 論文と IMCCE の公開データ |
| [大赤斑の経度](#大赤斑の経度) | [grs.ts](grs.ts) | 読み取った値 |
| [すべての衛星](#すべての衛星) | [public/jupiter/moons.json](../../../public/jupiter/moons.json)・[model.ts](model.ts) の `INNER` | 位置は JPL Horizons、名前と群は CC BY-SA 4.0 |

ページのフッターには、OPAL の謝辞（Hubble の OPAL、PI と提案番号、STScI、DOI）、Astronomy Engine の著作権表示、ウィキペディア日本語版から取ったことを出します。

## 模様の地図（OPAL）

Hubble 宇宙望遠鏡の Outer Planet Atmospheres Legacy（OPAL）の全球の地図（色合成の TIFF）から作ります。[scripts/jupiter-maps.ts](../../../scripts/jupiter-maps.ts) で作ります。

```sh
bun run jupiter-maps [置き場]
```

置き場は、元のファイルを置くリポジトリの外のディレクトリです。ファイルがなければ MAST からダウンロードします。WebP への変換に ImageMagick（`magick`）を使います。

- 元のファイル: `hlsp_opal_hst_wfc3-uvis_jupiter-<年><回>_f395n-f502n-f631n_v1_globalmap.tif`（2024a だけ f658n）
  - 置き場所: <https://archive.stsci.edu/hlsps/opal/>
  - 3600×1800、1° あたり 10 画素、左端が System III の西経 0°、上端が惑星図緯度 +90°
  - 周縁減光は Minnaert 則で除いてある（k は赤 0.999・緑 0.95・青 0.85）
- 使う回: 2015a・2016a・2017a・2018a・2019a・2020a・2021a・2022b・2024a・2024c・2025a
  - 2022 年は 1 周目が途中で欠けているので 2 周目
- 加工: 撮れていない極を端に近い行の平均の色で埋め、3072×1536 の WebP（品質 82）にする
- 取得日: 2026-11-01
- ライセンス: CC BY 4.0
- 引用: A. A. Simon et al., ApJ 812, 55 (2015)。M. H. Wong et al., ApJS 247, 58 (2020)

MAST の README が求める謝辞:

> This work used data acquired from the NASA/ESA HST Space Telescope, associated with OPAL program (PI: Simon, GO13937), and archived by the Space Telescope Science Institute, which is operated by the Association of Universities for Research in Astronomy, Inc., under NASA contract NAS 5-26555. All maps are available at http://dx.doi.org/10.17909/T9G593.

地図の上の大赤斑の経度（[grs.ts](grs.ts) の `MAPS`）は、スクリプトが南緯 14〜30° で赤みの強い所から出します。撮影日は各年の README から取りました。

## ガリレオ衛星の位置（Astronomy Engine）

Astronomy Engine 2.1.19 の `JupiterMoons`（TypeScript 版）の係数と計算を写しました。L1.2（Lainey, Duriez & Vienne）を 75 項に打ち切ったものです。

- 元: <https://github.com/cosinekitty/astronomy>（source/js/astronomy.ts）
- ライセンス: MIT。著作権表示と許諾文を [galilean.ts](galilean.ts) の冒頭に残す

## 木星の位置（VSOP87D）

IMCCE の [VSOP87D.jup](https://ftp.imcce.fr/pub/ephem/planets/vsop87/VSOP87D.jup) の 3483 項から、振幅 × 0.1<sup>p</sup> ≥ 3 × 10<sup>−7</sup> の 329 項を残しました。p は時間のべきです。

## 大赤斑の経度

[grs.ts](grs.ts) の表は次の値から作りました。

- 2015〜2025 年: OPAL の地図の上の大赤斑の System III の経度を、撮影日の System II に直した値
- 2026 年: JUPOS の経度の図（<https://jupos.hier-im-netz.de/rGrs.htm>、2026-10-09 更新）から読んだ値
- 確認: BAA Jupiter Section の Report no. 4（2025-12-31）の 2025-12-01 の値 L2 = 79°

季節ごとに JUPOS の図を見て、表の最後に行を足します。

## すべての衛星

[scripts/jupiter-moons.ts](../../../scripts/jupiter-moons.ts) で作ります。

```sh
bun run jupiter-moons [置き場]
```

- 位置: [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) の木星中心のベクトル（ICRF）
  - 取得日: 2026-11-01
  - 外側の 107 個は 2015-01-01 から 90 日おきに 90 時点を持つ
  - 内側の 4 個は円軌道を当てはめ、スクリプトが出す値を [model.ts](model.ts) の `INNER` に写す
- 名前と群: ウィキペディア日本語版「[木星の衛星](https://ja.wikipedia.org/w/index.php?title=%E6%9C%A8%E6%98%9F%E3%81%AE%E8%A1%9B%E6%98%9F&oldid=109799938)」の一覧（版 109799938、CC BY-SA 4.0）
  - 一覧にない 14 個は仮符号を名前にし、群は軌道から決める
  - moons.json はこのライセンスを引き継ぐ
