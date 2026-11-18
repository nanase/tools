# 日の出と日の入りのデータの出典とライセンス

日の出と日の入りのページで使うデータのうち、公開されているデータから作ったものを挙げます。これらにはリポジトリの MIT ライセンスではなく、データごとに次のライセンスが付きます。

| データ | ファイル | ライセンス |
| --- | --- | --- |
| 陸地 | [land110.json](../../../public/solar-eclipse/land110.json)（日食のページと共用） | パブリックドメイン |
| 時間帯の境界 | npm の `@photostructure/tz-lookup` の中の表（ビルドで束ねる） | ODbL 1.0（表を引くコードは CC0） |

## 陸地

日食のページと同じファイルを読みます。出典と加工は[日食のデータの出典](../solar-eclipse/SOURCES.md#陸地natural-earth)にあります。

## 時間帯の境界

座標から IANA の時間帯の名前を引くのに使います。

- パッケージ: [@photostructure/tz-lookup](https://github.com/photostructure/tz-lookup) 11.8.0（CC0）
- 境界の元: [timezone-boundary-builder](https://github.com/evansiroky/timezone-boundary-builder)（Evan Siroky）。OpenStreetMap から作られ、ODbL 1.0 が付く
- 出典表記: ページのフッタに "timezone-boundary-builder（© OpenStreetMap contributors, ODbL）" を出す
