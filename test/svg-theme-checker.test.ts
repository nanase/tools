import { describe, expect, it } from 'vitest';
import { gutterHtml, hl, hlHtml, indentEdit, lineCount, newlineEdit } from '../src/tools/svg-theme-checker/code';
import {
  type AttrIn,
  checkAttr,
  checkEl,
  cssScan,
  cssType,
  newReport,
  parseErr,
  refIssue,
  reportText,
  SVGNS,
  XHTML,
  XLNS,
  XMLNS,
} from '../src/tools/svg-theme-checker/policy';
import {
  actualView,
  fitView,
  len,
  n4,
  sizeOf,
  themeCss,
  themeMq,
  zoomText,
  zoomView,
} from '../src/tools/svg-theme-checker/view';

const attr = (local: string, value: string, ns: string | null = null, name = local): AttrIn => ({
  ns,
  local,
  name,
  value,
});

describe('CSS の検査', () => {
  it('外部を読まない CSS はそのまま返す', () => {
    const css = ':root{--c:#fff} a{fill:url(#g);mask:url( "#m")}';
    expect(cssScan(css)).toEqual({ css, iss: [] });
  });

  it('url( の直後の空白は読み飛ばして判定する', () => {
    expect(cssScan('a{b:url(  #x)}').iss).toEqual([]);
    expect(cssScan("a{b:url( 'x.png')}").iss).toEqual(['外部参照']);
  });

  it('@import・外部の url() を無効な名前に変える', () => {
    const r = cssScan('@import "a.css"; a{background:url(http://e/x.png)}');
    expect(r.iss).toEqual(['@import', '外部参照']);
    expect(r.css).toBe('@blocked-import "a.css"; a{background:blocked-url(http://e/x.png)}');
  });

  it('エスケープとコメントを解いてから調べる', () => {
    expect(cssScan('a{b:u\\72l(x)}').iss).toEqual(['外部参照']);
    expect(cssScan('a{b:\\75 rl(x)}').iss).toEqual(['外部参照']);
    expect(cssScan('a{b:u/**/rl(x)}').iss).toEqual(['外部参照']);
  });

  it('javascript: の URL と、外部を読む関数・独自拡張', () => {
    expect(cssScan('a{b:url("javascript:alert(1)")}').iss).toEqual(['javascript: URL', 'javascript: URL']);
    expect(cssScan('a{b:image-set("a.png" 1x)}').iss).toEqual(['外部参照']);
    expect(cssScan('a{b:-webkit-image-set("a.png" 1x)}').iss).toEqual(['外部参照']);
    expect(cssScan('@font-face{src:local(A)} a{b:src("x")}').iss).toEqual(['外部参照']);
    expect(cssScan('x{-moz-binding:none}').iss).toEqual(['javascript: URL']);
  });
});

describe('参照（href）の検査', () => {
  it('同じファイル内だけ許す。空白や制御文字は読み飛ばして判定する', () => {
    expect(refIssue('#a', 'use')).toBe('');
    expect(refIssue(' \t#a', 'use')).toBe('');
    expect(refIssue('a.svg#a', 'use')).toBe('外部参照');
    expect(refIssue('https://example.com/a.svg', 'use')).toBe('外部参照');
    expect(refIssue('java\tscript:alert(1)', 'use')).toBe('javascript: URL');
  });

  it('image・feImage には埋め込みのラスタ画像を許す。SVG の data: URL は許さない', () => {
    expect(refIssue('data:image/png;base64,iVBORw0K', 'image')).toBe('');
    expect(refIssue('data:image/webp;base64,UklG', 'feImage')).toBe('');
    expect(refIssue('data:image/png;base64,iVBORw0K', 'use')).toBe('data: URL');
    expect(refIssue('data:image/svg+xml,<svg/>', 'image')).toBe('data: URL');
  });
});

describe('属性の検査', () => {
  it('許可リストの属性はそのまま写す', () => {
    const rep = newReport();
    expect(checkAttr(attr('viewBox', '0 0 10 10'), 'svg', rep)).toEqual({ key: 'viewBox', val: '0 0 10 10' });
    expect(checkAttr(attr('fill', 'url(#g)'), 'path', rep)).toEqual({ key: 'fill', val: 'url(#g)' });
    expect(checkAttr(attr('href', '#a', XLNS, 'xlink:href'), 'use', rep)).toEqual({ key: 'xlink:href', val: '#a' });
    expect(checkAttr(attr('space', 'preserve', XMLNS, 'xml:space'), 'text', rep)).toEqual({
      key: 'xml:space',
      val: 'preserve',
    });
    expect(rep.d.size + rep.o.size).toBe(0);
  });

  it('名前空間の宣言は数えずに捨てる', () => {
    const rep = newReport();
    expect(checkAttr(attr('xmlns', SVGNS), 'svg', rep)).toBeNull();
    expect(checkAttr(attr('xlink', XLNS, 'http://www.w3.org/2000/xmlns/', 'xmlns:xlink'), 'svg', rep)).toBeNull();
    expect(rep.d.size + rep.o.size).toBe(0);
  });

  it('イベント属性・外部参照・javascript: は危険なものとして数える', () => {
    const rep = newReport();
    expect(checkAttr(attr('onload', 'alert(1)'), 'svg', rep)).toBeNull();
    expect(checkAttr(attr('onclick', 'x()'), 'rect', rep)).toBeNull();
    expect(checkAttr(attr('href', 'https://e/a.png'), 'image', rep)).toBeNull();
    expect(checkAttr(attr('fill', 'url(https://e/p.svg#g)'), 'rect', rep)).toBeNull();
    expect(checkAttr(attr('values', 'javascript:alert(1)'), 'set', rep)).toBeNull();
    expect([...rep.d]).toEqual([
      ['onload 属性', 1],
      ['onclick 属性', 1],
      ['外部参照', 2],
      ['javascript: URL', 1],
    ]);
  });

  it('style 属性は外部参照だけ無効にして残す', () => {
    const rep = newReport();
    expect(checkAttr(attr('style', 'fill:red;background:url(x.png)'), 'rect', rep)).toEqual({
      key: 'style',
      val: 'fill:red;background:blocked-url(x.png)',
    });
    expect([...rep.d]).toEqual([['外部参照', 1]]);
  });

  it('許可リスト外の属性は接頭辞つきの名前で数える', () => {
    const rep = newReport();
    expect(
      checkAttr(attr('label', 'x', 'http://www.inkscape.org/namespaces/inkscape', 'inkscape:label'), 'g', rep),
    ).toBeNull();
    expect(checkAttr(attr('data-x', '1'), 'g', rep)).toBeNull();
    expect([...rep.o]).toEqual([
      ['inkscape:label 属性', 1],
      ['data-x 属性', 1],
    ]);
  });
});

describe('要素の検査', () => {
  it('描画に使う要素は写す。a は写す（g に置き換えるのは組み立て側）', () => {
    const rep = newReport();
    for (const ln of ['svg', 'g', 'path', 'linearGradient', 'feGaussianBlur', 'a', 'style'])
      expect(checkEl(SVGNS, ln, ln, null, rep)).toBe(true);
    expect(rep.d.size + rep.o.size).toBe(0);
  });

  it('スクリプト・埋め込み・HTML の要素は危険なものとして数える', () => {
    const rep = newReport();
    expect(checkEl(SVGNS, 'script', 'script', null, rep)).toBe(false);
    expect(checkEl(SVGNS, 'foreignObject', 'foreignObject', null, rep)).toBe(false);
    expect(checkEl(XHTML, 'div', 'html:div', null, rep)).toBe(false);
    expect([...rep.d.keys()]).toEqual(['<script>', '<foreignObject>', '<html:div>']);
  });

  it('許可リスト外の要素とほかの名前空間の要素', () => {
    const rep = newReport();
    expect(checkEl(SVGNS, 'metadata', 'metadata', null, rep)).toBe(false);
    expect(checkEl('http://www.inkscape.org/namespaces/sodipodi', 'namedview', 'sodipodi:namedview', null, rep)).toBe(
      false,
    );
    expect([...rep.o.keys()]).toEqual(['<metadata>', '<sodipodi:namedview>']);
  });

  it('SMIL で href・イベント属性を書き換えるものは捨てる', () => {
    const rep = newReport();
    expect(checkEl(SVGNS, 'set', 'set', 'href', rep)).toBe(false);
    expect(checkEl(SVGNS, 'animate', 'animate', ' xlink:href ', rep)).toBe(false);
    expect(checkEl(SVGNS, 'set', 'set', 'x:HREF', rep)).toBe(false);
    expect(checkEl(SVGNS, 'set', 'set', 'onclick', rep)).toBe(false);
    expect(checkEl(SVGNS, 'animate', 'animate', 'fill', rep)).toBe(true);
    expect(rep.d.get('<set> で href・イベントを書き換えるもの')).toBe(3);
  });

  it('style の type は CSS だけ', () => {
    expect(cssType(null)).toBe(true);
    expect(cssType(' text/css ')).toBe(true);
    expect(cssType('text/less')).toBe(false);
  });
});

describe('取り除いたものの報告', () => {
  it('危険なものは強調し、許可リスト外は 4 種まで挙げる', () => {
    const rep = newReport();
    rep.d.set('<script>', 2);
    rep.d.set('onload 属性', 1);
    for (const k of ['<metadata>', 'a 属性', 'b 属性', 'c 属性', 'd 属性', 'e 属性']) rep.o.set(k, 1);
    expect(reportText(rep)).toEqual({
      text: '取り除いたもの: <script> ×2、onload 属性　許可リスト外: <metadata>、a 属性、b 属性、c 属性 ほか 2 種',
      kind: 'pv',
    });
  });

  it('許可リスト外だけなら強調しない。何もなければ空', () => {
    const rep = newReport();
    expect(reportText(rep)).toEqual({ text: '', kind: '' });
    rep.o.set('<metadata>', 1);
    expect(reportText(rep)).toEqual({ text: '許可リスト外: <metadata>', kind: '' });
  });
});

describe('読めないときの位置', () => {
  it('Chromium の書式', () => {
    expect(
      parseErr(
        'This page contains the following errors:error on line 3 at column 5: Opening and ending tag mismatch: g line 2 and svg\nBelow is a rendering of the page up to the first error.',
      ),
    ).toEqual({ line: 3, col: 5, msg: 'Opening and ending tag mismatch: g line 2 and svg' });
  });

  it('Firefox の書式', () => {
    expect(
      parseErr('XML Parsing Error: mismatched tag. Expected: </g>.\nLocation: about:blank\nLine Number 3, Column 3:'),
    ).toEqual({ line: 3, col: 3, msg: 'mismatched tag. Expected: </g>.' });
  });

  it('位置がなければ 1 行目だけ', () => {
    expect(parseErr(' unknown \nmore')).toEqual({ msg: 'unknown' });
  });
});

describe('テーマの再現', () => {
  it('prefers-color-scheme を常に真・常に偽の条件に置き換える', () => {
    expect(themeMq('(prefers-color-scheme: dark)', 'dark')).toBe('(min-width:0px)');
    expect(themeMq('(prefers-color-scheme: dark)', 'light')).toBe('(not (min-width:0px))');
    expect(themeMq('screen and (PREFERS-COLOR-SCHEME:Light)', 'light')).toBe('screen and (min-width:0px)');
    expect(themeMq('(prefers-color-scheme)', 'light')).toBe('(min-width:0px)');
  });

  it('CSS の @media と、light と dark の両方を挙げた color-scheme を固定する', () => {
    const css =
      '@media (prefers-color-scheme: dark) { :root{--c:#fff} } svg{color-scheme: light dark} a{color-scheme:dark}';
    expect(themeCss(css, 'light')).toBe(
      '@media (not (min-width:0px)) { :root{--c:#fff} } svg{color-scheme: light} a{color-scheme:dark}',
    );
    expect(themeCss(css, 'dark')).toBe(
      '@media (min-width:0px) { :root{--c:#fff} } svg{color-scheme: dark} a{color-scheme:dark}',
    );
  });

  it('カスタムプロパティの名前の中の color-scheme は変えない', () => {
    const css = 'a{--color-scheme: light dark}';
    expect(themeCss(css, 'dark')).toBe(css);
  });
});

describe('SVG の大きさ', () => {
  it('長さの単位', () => {
    expect(len('10')).toBe(10);
    expect(len(' 1in ')).toBe(96);
    expect(len('2.54cm')).toBeCloseTo(96, 12);
    expect(len('12pt')).toBe(16);
    expect(len('1e2px')).toBe(100);
    expect(len('50%')).toBeNaN();
    expect(len(null)).toBeNaN();
  });

  it('width・height があればそのまま', () => {
    expect(sizeOf('0 0 89.301 89.301', '256', '256')).toEqual({
      w: 256,
      h: 256,
      auto: false,
      vb: [0, 0, 89.301, 89.301],
    });
  });

  it('片方だけなら viewBox の比で補う', () => {
    expect(sizeOf('0 0 200 100', '50', null)).toEqual({ w: 50, h: 25, auto: false, vb: [0, 0, 200, 100] });
    const s = sizeOf('0,0,200,100', null, '10mm');
    expect(s.w).toBeCloseTo((2 * 96) / 2.54, 12);
    expect(s.auto).toBe(false);
  });

  it('決まらなければ viewBox の比で長辺 300、viewBox もなければ 300 × 150', () => {
    expect(sizeOf('0 0 200 100', '100%', null)).toEqual({ w: 300, h: 150, auto: true, vb: [0, 0, 200, 100] });
    expect(sizeOf('0 0 10 40', null, null)).toMatchObject({ w: 75, h: 300, auto: true });
    expect(sizeOf(null, null, null)).toEqual({ w: 300, h: 150, auto: true, vb: null });
    expect(sizeOf('0 0 0 10', null, null).vb).toBeNull();
  });

  it('表示は有効 5 桁', () => {
    expect(n4(256)).toBe('256');
    expect(n4(89.301)).toBe('89.301');
    expect(n4(1 / 3)).toBe('0.33333');
  });
});

describe('プレビューの位置と倍率', () => {
  it('収まるなら等倍で中央、収まらなければ 9 割に縮める', () => {
    expect(fitView(256, 256, 400, 400)).toEqual({ s: 1, x: 72, y: 72 });
    const v = fitView(1000, 500, 400, 400);
    expect(v.s).toBeCloseTo(0.36, 12);
    expect(v.x).toBeCloseTo(20, 12);
    expect(v.y).toBeCloseTo(110, 12);
    expect(actualView(1000, 500, 400, 400)).toEqual({ s: 1, x: -300, y: -50 });
  });

  it('拡大縮小は指した点を動かさず、2 %〜6400 % に収める', () => {
    const v = zoomView({ s: 1, x: 10, y: 20 }, 110, 120, 2);
    expect(v).toEqual({ s: 2, x: -90, y: -80 });
    expect(zoomView({ s: 60, x: 0, y: 0 }, 0, 0, 2).s).toBe(64);
    expect(zoomView({ s: 0.03, x: 0, y: 0 }, 0, 0, 0.5).s).toBe(0.02);
  });

  it('倍率の表示', () => {
    expect(zoomText(1)).toBe('100 %');
    expect(zoomText(1.2345)).toBe('123 %');
    expect(zoomText(0.36)).toBe('36 %');
    expect(zoomText(0.0234)).toBe('2.3 %');
  });
});

describe('コード入力', () => {
  it('タグ・属性・値・記号・文字を色分けし、中身はエスケープする', () => {
    expect(hl('<a href="#x">1 < 2</a>')).toBe(
      '<span class="x-p">&lt;</span><span class="x-t">a</span> <span class="x-a">href</span><span class="x-p">=</span><span class="x-v">&quot;#x&quot;</span><span class="x-p">&gt;</span><span class="x-tx">1 </span><span class="x-tx">&lt;</span><span class="x-tx"> 2</span><span class="x-p">&lt;/</span><span class="x-t">a</span><span class="x-p">&gt;</span>',
    );
  });

  it('コメント・CDATA・処理命令', () => {
    expect(hl('<!-- <b> -->')).toBe('<span class="x-cm">&lt;!-- &lt;b&gt; --&gt;</span>');
    expect(hl('<![CDATA[a<b]]>')).toBe(
      '<span class="x-p">&lt;![CDATA[</span><span class="x-tx">a&lt;b</span><span class="x-p">]]&gt;</span>',
    );
    expect(hl('<?xml version="1.0"?>')).toBe('<span class="x-cm">&lt;?xml version=&quot;1.0&quot;?&gt;</span>');
  });

  it('末尾が改行なら写しに 1 行足す', () => {
    expect(hlHtml('')).toBe(' ');
    expect(hlHtml('a\n')).toBe('<span class="x-tx">a\n</span> ');
    expect(hlHtml('a')).toBe('<span class="x-tx">a</span>');
  });

  it('行数と行番号', () => {
    expect(lineCount('')).toBe(1);
    expect(lineCount('a\nb\n')).toBe(3);
    expect(gutterHtml(3, 2)).toBe('1\n<span class="er">2</span>\n3\n');
  });

  it('Tab: 1 行の中なら空白 2 つ、複数行なら行頭に足す', () => {
    expect(indentEdit('abc', 1, 2, false)).toEqual({ from: 1, to: 2, text: '  ' });
    expect(indentEdit('a\nb\nc', 0, 3, false)).toEqual({ from: 0, to: 3, text: '  a\n  b', sel: [0, 7] });
    /* 選択が次の行の頭で終わるときは、その行を含めない */
    expect(indentEdit('a\nb\nc', 0, 2, false)).toEqual({ from: 0, to: 1, text: '  a', sel: [0, 3] });
  });

  it('Shift+Tab: 行頭の空白 1〜2 つかタブ 1 つを除く', () => {
    expect(indentEdit('    a\n\tb\n c', 2, 11, true)).toEqual({ from: 0, to: 11, text: '  a\nb\nc', sel: [0, 7] });
  });

  it('Enter: 今の行の頭の空白を引き継ぐ', () => {
    expect(newlineEdit('<g>\n    <path/>', 15, 15)).toEqual({ from: 15, to: 15, text: '\n    ' });
    expect(newlineEdit('\t<g>', 2, 4)).toEqual({ from: 2, to: 4, text: '\n\t' });
  });
});
