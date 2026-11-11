# 開発の手引き

Astro と TypeScript で作っています。UI のフレームワークは使いません。見た目と動作は [design/](design/README.md) の決定に従います。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `bun run dev` | 開発サーバを起動する（<http://localhost:4321/tools/>） |
| `bun run build` | `dist/` へビルドする |
| `bun run preview` | ビルド結果を開く |
| `bun run check` | 型を検査する（astro check） |
| `bun run lint` | Biome で検査する。`lint:fix` で直す |
| `bun run test` | Vitest でテストする |

Astro と Vitest は mise が入れた Node で動きます。版は `.mise.toml` で決まります。PATH にほかの版の Node があっても使わず、版が違えば止まります。仕組みは [scripts/node.ts](scripts/node.ts) にあります。

曲・地図・衛星などのデータを作り直すコマンドは、各ページの `src/tools/<id>/SOURCES.md` にあります。曲を直す手順は [docs/scores.md](docs/scores.md) にあります。

## CI と公開

GitHub Actions（[.github/workflows/ci.yml](.github/workflows/ci.yml)）が、PR と main への push のたびに lint・型検査・テスト・ビルドを走らせます。main へ push すると、ビルド結果を GitHub Pages へ公開します。

依存の更新は [Renovate](https://docs.renovatebot.com/) が PR にします。

- 設定は [renovate.json](renovate.json)
- TypeScript は 6 系、Node は v26 系に留める
- 自動ではマージしない

## ページの説明文

カードの説明は `src/data/tools.ts` の `d` に書きます。検索結果と共有の説明にも同じ文が出ます。

- 長さ
  - 目安は 24 字前後
  - 上限は 34 字で、半角は 0.5 字に数える
  - 上限はテストで確かめる
- 中身
  - ページで何ができるかを 1 文で書く
  - 手法名の列挙と操作の説明を入れない
  - 検索に効かせたい語は `k` へ入れる
- ページの「?」の説明文
  - `d` と同じ文か、2 文までにする

| | 例 |
| --- | --- |
| 目安 | 過去と未来の日食を地上の空と月の影で再現します。 |
| 上限 | ロジスティック写像が周期倍分岐をくり返してカオスに至る様子を見ます。 |

## 音の大きさ

音の出るページは既定のまま鳴らしたときの大きさを −26 LUFS ± 2 LU にそろえます。新しいページを足したら測り、外れていれば音量の行の既定値をずらします。

```sh
bun run dev                  # 別の端末で起動しておく
bun run loudness thunder     # ページ名を並べる。省けば全ページ
```

- 測り方
  - ページを開き、最初に押す再生ボタンを押してから 15〜40 秒の音を測る
  - 押すボタンと秒数は [scripts/loudness.ts](scripts/loudness.ts) の `SCENES` に書く
    - 新しいページはここへ足す
  - 大きさは ITU-R BS.1770 の積分の大きさで、音のない区間は数えない
- そろえ方
  - 音量の行の既定値だけをずらす
  - 低い音が主のページは LUFS が耳で感じるより小さめに出る
    - 耳で合わせ、ずらした量を `SCENES` の `ear` に書く（エンジンと変速機は +8 LU）
  - ページの中の音量の差は残す
    - 距離による減衰や低出力の音では、その差が見せたい中身
  - 表示の dB を全ページで同じにして、裏で補正を掛けることはしない
    - 楽器の「0 dB で 1 m 先の音圧 1 Pa」の目盛りが崩れるため
- マイクの音を出すだけのページ（オシロスコープなど）は対象外

## 画面の揺れ

操作や再生のたびに行が折り返して画面が上下しないよう、新しいページを足したら確かめます。決まりは [design/page.md](design/page.md#動いても場所を変えない) にあります。

```sh
bun run dev                          # 別の端末で起動しておく
bun run layout-shift guitar          # ページ名を並べる。省けば全ページ（1 時間ほど）
bun run layout-shift --width 360 pcm # 幅を 1 つにする（既定は 360 と 1280）
```

- 調べ方
  - ページを開いて待ち、再生し、数値の欄を端から端まで動かし、選択肢とボタンを順に押す
  - そのたびに枠の高さが変わったら、原因の要素と前後の文字を出す。見つかれば終了コードは 1
  - 図をなぞる操作は試さない。曲や乱数しだいの揺れは、調べている間に起きたものだけを拾う
- 数えないもの
  - ボタンや選択で行や枠が出る・消える（表示の切り替え）
  - 図の大きさ、動作原理と式の枠、「その他」の開閉
  - `data-shift="ok"` を付けた要素の中。付けるときは理由をコメントに書く
- 仕組みは [scripts/layout-shift.ts](scripts/layout-shift.ts) にある

## 共有の画像

次の 2 つはカードの図柄から作ります。図柄か副題を変えたら `bun run og-image` で作り直します。

- 共有したときに出る画像（`public/og.png`）
- README の冒頭の画像（`.github/banner.svg`）

フォントは Google Fonts から取り、PNG は Edge か Chrome のヘッドレスで撮ります。Windows の Edge 以外を使うときは、環境変数 `BROWSER` でブラウザを指定します。

## 旧 URL の転送

旧 URL（`/tools/electric/timer555.html` など）と新 URL の対応は [src/data/redirects.ts](src/data/redirects.ts) にあります。ビルドすると、旧パスに転送のページができます。

本番の転送は Cloudflare の Bulk Redirects で行います。

1. `bun run redirects` で `redirects/cloudflare.csv` を作り直す
2. ダッシュボードの Bulk Redirects で、リストへ CSV を取り込む
