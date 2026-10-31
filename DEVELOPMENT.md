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
