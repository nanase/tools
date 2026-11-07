"""
数式の書体（src/assets/fonts/lm-math-web.woff2）を作る。

    python scripts/math-font.py [元の OTF]

元は CTAN の Latin Modern Math（GUST Font License）。引数を省くと CTAN から取る。
使う文字の範囲だけに絞り、GUST Font License の頼みに従って書体名を変える。
fontTools と brotli が要る（pip install fonttools brotli）。サイトの実行時には要らない。
"""

import io
import sys
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.misc.psCharStrings import T2WidthExtractor
from fontTools.ttLib import TTFont

SRC = "https://mirrors.ctan.org/fonts/lm-math/opentype/latinmodern-math.otf"
OUT = Path(__file__).resolve().parent.parent / "src/assets/fonts/lm-math-web.woff2"
NAME = "LM Math Web"

# 本文の文字・ギリシャ文字・記号・矢印・演算子と、MathML が使う斜体・太字・筆記体・黒板太字
RANGES = [
    (0x0020, 0x007E), (0x00A0, 0x00BF), (0x00C5, 0x00C5), (0x00D7, 0x00D7), (0x00F6, 0x00F7),
    (0x0131, 0x0131), (0x0237, 0x0237), (0x02C6, 0x02DD), (0x0300, 0x036F), (0x0391, 0x03F6),
    (0x2000, 0x206F), (0x2100, 0x214F), (0x2190, 0x2199), (0x21D0, 0x21D5),
    (0x2200, 0x22FF), (0x2308, 0x230B), (0x23B4, 0x23B5), (0x23DC, 0x23E1),
    (0x27E8, 0x27EF), (0x27F5, 0x27FF), (0x2A00, 0x2A06),
    (0x1D400, 0x1D467), (0x1D49C, 0x1D4CF), (0x1D538, 0x1D56B),
    (0x1D6A8, 0x1D71B), (0x1D7CE, 0x1D7D7),
]


def widen_italics(font: TTFont) -> None:
    """斜体の右上の張り出し（イタリック補正）を字幅に移す。
    Chromium は上付きの位置にイタリック補正を使わず、T⁴ の 4 が T に重なるため。
    Windows の Chromium は CFF の字形データの字幅を読むので、hmtx と両方を書き換える"""
    ic = font["MATH"].table.MathGlyphInfo.MathItalicsCorrectionInfo
    hmtx = font["hmtx"]
    cff = font["CFF "].cff.topDictIndex[0]
    strings = cff.CharStrings
    for name, rec in zip(ic.Coverage.glyphs, ic.ItalicsCorrection):
        if rec.Value <= 0 or name not in hmtx.metrics:
            continue
        adv, lsb = hmtx.metrics[name]
        hmtx.metrics[name] = (adv + rec.Value, lsb)
        cs = strings[name]
        cs.decompile()
        priv = cs.private
        ext = T2WidthExtractor(getattr(priv, "Subrs", []), cs.globalSubrs, priv.nominalWidthX, priv.defaultWidthX)
        ext.execute(cs)
        if ext.gotWidth:
            cs.program[0] += rec.Value
        else:
            cs.program.insert(0, adv + rec.Value - priv.nominalWidthX)
        rec.Value = 0


def main() -> None:
    data = Path(sys.argv[1]).read_bytes() if len(sys.argv) > 1 else urllib.request.urlopen(SRC).read()
    opts = subset.Options()
    opts.flavor = "woff2"
    # ssty（添字用の字形）と dtls を外すと半分ほどになる。添字は普通の字形を縮めて描く
    opts.layout_features = ["kern"]
    opts.notdef_outline = True
    opts.drop_tables += ["FFTM"]
    font = TTFont(io.BytesIO(data))
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=[u for a, b in RANGES for u in range(a, b + 1)])
    sub.subset(font)
    ps = NAME.replace(" ", "") + "-Regular"
    for rec in font["name"].names:
        if rec.nameID in (1, 16):
            rec.string = NAME
        elif rec.nameID == 4:
            rec.string = NAME + " Regular"
        elif rec.nameID in (3, 6):
            rec.string = ps
    font["CFF "].cff.fontNames = [ps]
    widen_italics(font)
    font.flavor = "woff2"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    font.save(OUT)
    print(f"{OUT.name}: {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
