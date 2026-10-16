# tools

電子回路・信号処理の計算とシミュレーションができるツール集です。<https://nanase.cc/tools/>

Astro とフレームワークなしの TypeScript で作っています。見た目と動作の基準は [design/](design/) のモックです。

## 準備

[mise](https://mise.jdx.dev/) で Node と bun を入れ、依存を入れます。

```sh
mise install
bun install
```

## コマンド

| コマンド | 内容 |
| --- | --- |
| `bun run dev` | 開発サーバ（<http://localhost:4321/tools/>） |
| `bun run build` | `dist/` へビルドする |
| `bun run preview` | ビルド結果を確かめる |
| `bun run check` | 型検査（astro check） |
| `bun run lint` | Biome で検査する（`lint:fix` で直す） |
| `bun run test` | Vitest でテストする |

Astro と Vitest は [scripts/node.ts](scripts/node.ts) を通して、mise が入れた Node（`.mise.toml` の版）で動かします。PATH の先にほかの版の Node があっても使いません。版が違えば止まります。

## CI と公開

GitHub Actions（[.github/workflows/ci.yml](.github/workflows/ci.yml)）が、PR と main への push ごとに lint・型検査・テスト・ビルドを行います。main へ push すると、ビルド結果を GitHub Pages へ公開します。

依存の更新は [Renovate](https://docs.renovatebot.com/) が PR を立てます。設定は [renovate.json](renovate.json) にあります。TypeScript は 6 系、Node は v26 系に留めます。PR は自動マージしません。

## 旧 URL の転送

旧 URL（`/tools/electric/timer555.html` など）と新 URL の対応表は `src/data/redirects.ts` にあります。ビルドすると旧パスに転送ページが出ます。

本番の転送は Cloudflare の Bulk Redirects で行います。`bun run redirects` で `redirects/cloudflare.csv` を作り直し、ダッシュボードの Bulk Redirects で、リストへ CSV を取り込みます。

## ライセンス

MIT

ただし、楽器の音響モデルで演奏する曲のデータ（MIDI や LilyPond の楽譜と、そこから作る音符）には、曲ごとに原作と同じライセンスが付きます。曲ごとの出典とライセンスは [SCORES.md](SCORES.md) にあります。

ハロ（暈）のページで計算と並べる写真（[public/photos/halo/](public/photos/halo/)）は Wikimedia Commons から取ったもので、写真ごとに元のライセンス（パブリックドメイン・CC0 1.0・CC BY 4.0）に従います。作者・出典・ライセンスは [src/tools/halo/photos.ts](src/tools/halo/photos.ts) とページの写真の下にあります。

日食のページのデータ（NASA の日食の要素、Natural Earth の陸地、国土数値情報などから作った地名）にも、データごとの条件が付きます。出典と条件は [src/tools/solar-eclipse/SOURCES.md](src/tools/solar-eclipse/SOURCES.md) にあります。
