# 式の書体の出典とライセンス

`lm-math-web.woff2` は Latin Modern Math を絞って作ったフォントです。リポジトリの MIT ライセンスではなく、元のフォントの GUST Font License が付きます。

| 項目 | 内容 |
| --- | --- |
| 元のフォント | Latin Modern Math 1.959（B. Jackowski, P. Strzelczyk, P. Pianowski） |
| 入手先 | [CTAN の lm-math](https://ctan.org/pkg/lm-math) |
| ライセンス | GUST Font License（LaTeX Project Public License 1.3c 以降）。全文は [GUST-FONT-LICENSE.txt](GUST-FONT-LICENSE.txt) |
| 作り方 | [scripts/math-font.py](../../../scripts/math-font.py) |

## 元のフォントから変えた点

- 使う文字の範囲だけを残した
- 添字用の字形（`ssty`）と `dtls` の置き換えを外した
- 斜体のイタリック補正を字幅へ移した
- GUST Font License の頼みに従い、書体名を LM Math Web に変えた
