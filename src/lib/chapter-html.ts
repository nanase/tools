/**
 * 章立てて解説するページ（z 変換・ラプラス変換）の章の HTML をビルド時に組む部品。
 * 章は問いを見出しにした section.ch で、部（いくつかの章のまとまり）に分ける。
 * 下に貼り付くナビゲーションと出典の一覧の HTML もここで作り、動きは lib/chapter-page.ts、見た目は styles/chapters.css が受け持つ
 */

/** 部: [部の名前, [問いの id, 題（HTML）][]] */
export type Part = [string, [string, string][]];
/** 問い: [id, 通し番号, 題, 部の番号] */
export type Q = [string, number, string, number];

export interface Chapters {
  /** 問いの並び。番号は 1 から通しで振る */
  QS: Q[];
  /** 部の見出し。すべて表示のときだけ出す（1 問ずつのときは章の上の小見出しが代わる） */
  part: (i: number) => string;
  /** 章の頭: 部の小見出しと「問い n」の見出し */
  head: (id: string) => string;
  /** 下に貼り付くナビゲーション: 前へ・問いの一覧・次へ。一覧の上に 1 問ずつ・すべての切り替え */
  nav: () => string;
}

export function makeChapters(toc: Part[]): Chapters {
  const QS: Q[] = toc.flatMap((p, i) => p[1].map(([q, t]) => ({ q, t, i }))).map(({ q, t, i }, k) => [q, k + 1, t, i]);
  const qOf = (id: string): Q => {
    const x = QS.find((y) => y[0] === id);
    if (!x) throw new Error(`no question: ${id}`);
    return x;
  };
  const part = (i: number): string =>
    `<div class="part" aria-hidden="true"><span class="how-n">${i + 1}</span>${toc[i][0]}</div>`;
  const head = (id: string): string => {
    const [, k, t, pi] = qOf(id);
    return `<p class="eyebrow"><span class="how-n">${pi + 1}</span>${toc[pi][0]}</p><h2 tabindex="-1"><span class="qn">問い ${k}</span>${t}</h2>`;
  };
  const nav = (): string => `
<nav class="qnav" aria-label="問い">
  <button type="button" class="qn-prev" aria-label="前の問い"><span aria-hidden="true">‹</span><span class="qn-lb">前へ</span></button>
  <button type="button" class="qn-menu" aria-expanded="false" aria-controls="qn-list"><span class="qn-no"></span><span class="qn-t"></span><span class="qn-car" aria-hidden="true">▴</span></button>
  <button type="button" class="qn-next" aria-label="次の問い"><span class="qn-lb">次へ</span><span aria-hidden="true">›</span></button>
  <div class="qn-list" id="qn-list" hidden>
    <div class="qn-view"><span class="lb">表示</span><div class="seg" role="group" aria-label="表示"><button type="button" data-view="one" aria-pressed="true">1 問ずつ</button><button type="button" data-view="all" aria-pressed="false">すべて</button></div></div>
    ${toc.map((p, i) => `<div class="qn-part"><b><span class="how-n">${i + 1}</span>${p[0]}</b><ol>${p[1].map(([q, t]) => `<li><a href="#${q}" data-q="${q}"><span class="qn-k">${qOf(q)[1]}</span><span>${t}</span></a></li>`).join('')}</ol></div>`).join('')}
  </div>
  <p class="sr" aria-live="polite" id="qn-live"></p>
</nav>`;
  return { QS, part, head, nav };
}

/** 本文の出典番号 [n]。押すと下の出典の一覧の同じ番号へ移る。文の句点の前に置く */
export const rf = (...ns: number[]): string => ns.map((n) => `<a class="rf" href="#ref-${n}">[${n}]</a>`).join('');

/**
 * 出典の一覧の枠: [何に使ったか, 書誌（HTML）][]。番号は並び順。
 * 1 問ずつのときも隠さないよう、章（section.ch）の外、ナビゲーションの前に置く
 */
export const refsBox = (items: [string, string][]): string =>
  `<section class="pnl crefs" aria-labelledby="hd-refs"><div class="ph"><h2 id="hd-refs">出典</h2></div><ol class="refs">${items.map(([f, s], i) => `<li id="ref-${i + 1}"><span class="rf-for">${f}</span><span class="rf-src">${s}</span></li>`).join('')}</ol></section>`;

/** 章の HTML の仕上げ。MathML の括弧を伸ばさず、式の間の空き（1em・1.2em・1.4em）で式を分け、見出しの題を span で包む */
export function finishChapters(raw: string): string {
  return raw
    .replace(/<mo>([()[\]|])<\/mo>/g, '<mo stretchy="false">$1</mo>')
    .replace(/<mspace width="(1\.2em|1\.4em|1em)"\/>/g, '</math><math display="block">')
    .replace(/(<span class="qn">[^<]*<\/span>)([\s\S]*?)<\/h2>/g, '$1<span>$2</span></h2>');
}
