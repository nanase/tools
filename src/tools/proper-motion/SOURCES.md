# 固有運動のデータの出典とライセンス

固有運動のページで使うデータのうち、外から取り込んだものを挙げます。これらにはリポジトリの MIT ライセンスではなく、それぞれの許諾が付きます。

| データ | ファイル | ライセンス |
| --- | --- | --- |
| [星](#星hyg) | [public/proper-motion/stars.bin](../../../public/proper-motion/stars.bin)・[fixed.ts](fixed.ts) | CC BY-SA 4.0 |
| [天の川](#天の川) | [public/proper-motion/sky.json](../../../public/proper-motion/sky.json) の `mw` | CC BY-SA 4.0（HYG から作った） |
| [星座線と星座名](#星座線と星座名d3-celestial) | [public/proper-motion/sky.json](../../../public/proper-motion/sky.json) の `cons`・`lines` | BSD 3-Clause |
| [長期の歳差](#長期の歳差) | [src/lib/astro/ltp.ts](../../lib/astro/ltp.ts) | 論文の式 |

ページのフッタには HYG と d3-celestial の名前とライセンス、長期の歳差の論文を出します。

## 作り方

[scripts/proper-motion.ts](../../../scripts/proper-motion.ts) がまとめて作ります。

```sh
bun scripts/proper-motion.ts [置き場]
```

置き場は元のファイルを置くリポジトリの外のディレクトリです。ファイルがなければダウンロードします。

## 星（HYG）

- 元のファイル: `hyg_v38.csv.gz`
  - 置き場所: <https://github.com/astronexus/HYG-Database>（`hyg/v3/`）
  - 作者: David Nash
  - ライセンス: CC BY-SA 4.0
  - Hipparcos・Yale Bright Star・Gliese の星表をまとめたもの
- 加工
  - 8 等までの星を明るい順に並べる。太陽は除く
  - 位置・距離・速度は HYG の値をそのまま使う。速度 `vx`・`vy`・`vz` は視線速度を含む
  - 距離が分からない星（HYG の距離 100000 pc）は 1000 pc に置き、固有運動だけから速度を作る
  - 1 星 15 バイトに詰める（[format.ts](format.ts)）
- 名前
  - 日本語の固有名 62 個は、このリポジトリで付けた表（scripts/proper-motion.ts の `NAMES`）
  - バイエル符号と星座は HYG の `bayer`・`con`

## 天の川

- HYG の 5〜7.3 等の星（19,567 個）を、銀河座標の 2° の格子で数える
  - Hipparcos が全天で漏れなく測った暗さに限る。それより暗い星は、銀緯によって選び方が違い、むらになる
- マスの面積（cos b）で割り、半径 5.5° のガウスでぼかす
- 対数をとり、中央値から上位 0.5 % までを 0〜255 に並べる
- 本物の天の川の光の分布ではなく、場所の目安である

## 星座線と星座名（d3-celestial）

- 元のファイル: `constellations.lines.json`・`constellations.json`
  - 置き場所: <https://github.com/ofrohn/d3-celestial>（`data/`）
  - 作者: Olaf Frohn
  - ライセンス: BSD 3-Clause
- 加工
  - 線の頂点を、最も近い星に置き換える（どの頂点も 0.2° 以内に星がある）
  - 星座名は日本語名（`ja`）と名前を出す順位（`rank`）を使う

## 長期の歳差

- J. Vondrák, N. Capitaine, and P. Wallace, “New precession expressions, valid for long time intervals,” *Astronomy & Astrophysics*, vol. 534, A22, 2011
- 係数は IAU SOFA の iauLtpequ による。SOFA の試験値（−2500 年）に合うことを test/proper-motion.test.ts で確かめる

## BSD 3-Clause の表示（d3-celestial）

```text
Copyright (c) 2015, Olaf Frohn
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
