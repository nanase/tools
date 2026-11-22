# 潮の満ち引きのデータの出典とライセンス

潮の満ち引きのページで使う画像の出典です。これらにはリポジトリの MIT ライセンスではなく、画像ごとに次のライセンスが付きます。

| データ | ファイル | ライセンス |
| --- | --- | --- |
| 地球の写真 | [earth.jpg](../../../public/tide/earth.jpg) | パブリックドメイン |
| 月の模様 | [color8.jpg](../../../public/moon/color8.jpg) | パブリックドメイン（月のページと共用） |

ページのフッタには次の出典表記を出します。

- "NASA Visible Earth"（地球の写真）
- "NASA's Scientific Visualization Studio"（月の模様）

## 地球の写真（NASA の Blue Marble）

NASA Visible Earth の [The Blue Marble: Land Surface, Shallow Water, and Shaded Topography](https://visibleearth.nasa.gov/view.php?id=57752)（2002 年）です。

- 作者: Reto Stöckli（NASA GSFC）・Robert Simmon ほか
- 元の画像は 21600×10800 の正距円筒図法
- Wikimedia Commons の [File:Land_shallow_topo_2048.jpg](https://commons.wikimedia.org/wiki/File:Land_shallow_topo_2048.jpg) の幅 1024 の縮小版を取得した
  - NASA の画像サーバにつながらなかったため
  - 取得のコマンドは次のとおり

```sh
curl -L -o public/tide/earth.jpg "https://commons.wikimedia.org/wiki/Special:FilePath/Land_shallow_topo_2048.jpg?width=1024"
```

- 取得日: 2026-11-22
- ライセンス: パブリックドメイン（NASA の作品）

## 月の模様

月のページの [SOURCES.md](../moon/SOURCES.md) の「高さと模様の色」にある color8.jpg をそのまま使います。
