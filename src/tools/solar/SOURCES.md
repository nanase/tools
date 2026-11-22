# 太陽系のデータの出典とライセンス

太陽系のページで使うデータのうち、外から取り込んだものを挙げます。これらにはリポジトリの MIT ライセンスではなく、それぞれの許諾が付きます。

| データ | ファイル | ライセンス |
| --- | --- | --- |
| [火星の地図](#火星の地図viking-mdim-21) | [public/solar/mars.webp](../../../public/solar/mars.webp) | パブリックドメイン |
| [5 惑星の位置](#5-惑星の位置vsop87d) | [vsop.ts](vsop.ts) | 論文と IMCCE の公開データ |
| 木星・土星の地図と土星の環 | 木星・土星のページのファイルをそのまま読む | [木星](../jupiter/SOURCES.md)・[土星](../saturn/SOURCES.md)のとおり |

ページのフッタには、火星の地図の出典と、OPAL の謝辞（Hubble の OPAL、PI と提案番号、STScI、DOI）を出します。

## 作り直し

```sh
bun run solar-data [置き場]
```

置き場に元のファイルがなければダウンロードします。画像の変換に ImageMagick を使います。

## 火星の地図（Viking MDIM 2.1）

NASA Ames が色を付けた Viking の全球モザイク（MDIM 2.1）を、Wikimedia Commons の縮小版から 512 × 256 にしました。

- 元のファイル: [Mars Viking MDIM21 ClrMosaic 1km.jpg](https://commons.wikimedia.org/wiki/File:Mars_Viking_MDIM21_ClrMosaic_1km.jpg)（1280 px の縮小版）
- 原典: NASA/JPL/USGS, [Mars Viking MDIM 2.1 Colorized Global Mosaic](https://astrogeology.usgs.gov/search/details/Mars/Viking/MDIM21/Mars_Viking_MDIM21_ClrMosaic_global_232m/cub)
- 経度: 左端が西経 180°、東経が右へ増える
- ライセンス: パブリックドメイン（米国政府の著作物）

## 5 惑星の位置（VSOP87D）

IMCCE の VSOP87D の表から、振幅 × 0.1<sup>p</sup> ≥ 3 × 10<sup>−7</sup> の項だけを残しました。p は時間のべきです。

| 惑星 | 元のファイル | 残した項 |
| --- | --- | --- |
| 水星 | [VSOP87D.mer](https://ftp.imcce.fr/pub/ephem/planets/vsop87/VSOP87D.mer) | 6827 項のうち 153 項 |
| 金星 | [VSOP87D.ven](https://ftp.imcce.fr/pub/ephem/planets/vsop87/VSOP87D.ven) | 1682 項のうち 88 項 |
| 火星 | [VSOP87D.mar](https://ftp.imcce.fr/pub/ephem/planets/vsop87/VSOP87D.mar) | 5483 項のうち 270 項 |
| 天王星 | [VSOP87D.ura](https://ftp.imcce.fr/pub/ephem/planets/vsop87/VSOP87D.ura) | 3989 項のうち 600 項 |
| 海王星 | [VSOP87D.nep](https://ftp.imcce.fr/pub/ephem/planets/vsop87/VSOP87D.nep) | 1929 項のうち 273 項 |

全項と比べた地心の向きの差は、1900〜2100 年で 2.5″ 以下です。
