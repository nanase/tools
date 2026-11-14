# カメラレンズのデータの出典とライセンス

カメラレンズのページの空の天体には、ほかのページと同じ地図と表を使います。ファイルはそのページのものを読み、このページでは複製しません。ライセンスと加工の手順は各ページの SOURCES.md にあります。火星の地図だけはこのページで加えたもので、[下](#火星の模様viking)に書きます。

| データ | ファイル | 出典とライセンス |
| --- | --- | --- |
| 月の模様 | [public/moon/color8.jpg](../../../public/moon/color8.jpg) | [月のページ](../moon/SOURCES.md)（パブリックドメイン） |
| 火星の模様 | [public/lens/mars.webp](../../../public/lens/mars.webp) | [USGS](#火星の模様viking)（パブリックドメイン） |
| 木星の模様 | [public/jupiter/](../../../public/jupiter/) の最新の `j*.webp` | [木星のページ](../jupiter/SOURCES.md)（CC BY 4.0） |
| 土星の模様の帯 | [public/saturn/s2025a.webp](../../../public/saturn/s2025a.webp) | [土星のページ](../saturn/SOURCES.md)（CC BY 4.0） |
| 土星の環の表 | [public/saturn/rings.bin](../../../public/saturn/rings.bin) | [土星のページ](../saturn/SOURCES.md)（NASA のデータ） |

ページのフッターには、月と火星の地図の出典表記、OPAL の謝辞、環のデータの出典を出します。

木星の地図を足したときは、[scene.ts](scene.ts) が `MAPS` の最後の地図を使い、中央経線も大赤斑の経度から決め直します。

## 火星の模様（Viking）

USGS Astrogeology Science Center の [Mars Viking Global Color Mosaic 925m](https://astrogeology.usgs.gov/search/map/mars_viking_global_color_mosaic_925m) の縮小版から作りました。

- 元のファイル: `mars_viking_clrmosaic_global_1024.jpg`（ページにある 1024×512 の縮小版）
  - Viking の軌道船の写真のモザイク。650・510・475 nm を赤・緑・青にしている。緑は赤と紫の平均から作った値
  - 正距円筒図法、惑星中心緯度、東経が正。左端が東経 −180°、上端が北緯 90°
  - Minnaert 則の光度補正ともやの除去をしてある
- 加工: 暗い所の青みを抑えるため、元の画像と、明るさに応じて rgb(225,150,100) に染めた白黒の画像を 45 : 55 で混ぜ、WebP（品質 88）にした

```sh
magick mars_viking_clrmosaic_global_1024.jpg \( +clone -colorspace gray -fill "rgb(225,150,100)" -tint 100 \) \
  -compose blend -define compose:args=55 -composite -strip -quality 88 public/lens/mars.webp
```

- 取得日: 2026-11-14
- ライセンス: パブリックドメイン（ページの記載は "Access Constraints: public domain"、"Use Constraints: None"）
- 出典表記: NASA/USGS Astrogeology Science Center（定型の表記はない）
