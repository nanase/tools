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

Astro と Vitest は、mise が入れた Node で動きます。版は `.mise.toml` で決まります。PATH にほかの版の Node があっても使わず、版が違えば止まります。仕組みは [scripts/node.ts](scripts/node.ts) にあります。

曲のデータを作り直すコマンドは [SCORES.md](SCORES.md) にあります。

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

## 共有の画像

次の 2 つは、カードの図柄から作ります。図柄か副題を変えたら `bun run og-image` で作り直します。

- 共有したときに出る画像（`public/og.png`）
- README の冒頭の画像（`.github/banner.svg`）

フォントは Google Fonts から取り、PNG は Edge か Chrome のヘッドレスで撮ります。Windows の Edge 以外を使うときは、環境変数 `BROWSER` でブラウザを指定します。

## 旧 URL の転送

旧 URL（`/tools/electric/timer555.html` など）と新 URL の対応は [src/data/redirects.ts](src/data/redirects.ts) にあります。ビルドすると、旧パスに転送のページができます。

本番の転送は Cloudflare の Bulk Redirects で行います。

1. `bun run redirects` で `redirects/cloudflare.csv` を作り直す
2. ダッシュボードの Bulk Redirects で、リストへ CSV を取り込む
