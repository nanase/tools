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

ただし [src/tools/guitar/chaconne.mid](src/tools/guitar/chaconne.mid) と [src/tools/guitar/chaconne.ts](src/tools/guitar/chaconne.ts)（ギター音響モデルで演奏するシャコンヌの楽譜と、そこから `bun run chaconne` で作る音符と運指）は、[Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1426)（入力 Hajo Dezelski）から変換して編集したもので、原作と同じ [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) で公開します。

[src/tools/piano/scores/](src/tools/piano/scores/) の moonlight1〜3（`.mid` と `.ts`。ピアノ音響モデルで演奏するベートーヴェン「月光」の楽譜と、そこから `bun run piano-scores` で作る音符）は、[Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=276)（入力 Stewart Holmes）の MIDI から変換したもので、原作と同じ [CC BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/) で公開します。同じディレクトリのほかの曲は、原作がパブリックドメインです。

[src/tools/organ/scores/](src/tools/organ/scores/) の bwv645（`.mid` と `.ts`。オルガン音響モデルで演奏するバッハ「目覚めよと呼ぶ声あり」BWV 645 の楽譜と、そこから `bun run organ-scores` で作る音符）は、[Mutopia Project の楽譜](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=601)（入力 Bart Golsteijn）の MIDI から変換したもので、原作と同じ [CC BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/) で公開します。同じく bwv578（バッハ「フーガ ト短調」BWV 578 の MIDI と音符）は、[IMSLP の MIDI](https://imslp.org/wiki/File:PMLP153148-Bach_578_Fugue_Gm.mid)（作成 Pierre Gouin）から変換したもので、原作と同じ [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) で公開します。bwv565（トッカータとフーガ BWV 565 の演奏の MIDI と音符）は、[OpenGameArt で CC0 として公開された MIDI](https://opengameart.org/content/nes-bach-bwv-565)（投稿 TheOuterLinux）から作ったもので、同じく [CC0](https://creativecommons.org/publicdomain/zero/1.0/) で公開します。bwv582 は、原作がパブリックドメインです。
