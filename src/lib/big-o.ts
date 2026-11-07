/**
 * 計算量の式（"O(log n)"・"n log²n"・"償却 O(1)*" など）を数式の書体の HTML にする。
 * 変数は数学用の斜体の文字（U+1D434〜）に置き換え、log と O( は立体のまま残す。
 * 和文と末尾の * は本文の書体で残す。<sub>・<sup> はそのまま通す
 */

const JA = /([　-ヿ一-鿿＀-￯]+)/;

/** 1 文字を数学用の斜体にする。h の位置は空きで、プランク定数の ℎ を使う */
const italic = (c: string): string =>
  c === 'h' ? 'ℎ' : String.fromCodePoint(c.charCodeAt(0) + (c >= 'a' ? 0x1d44e - 0x61 : 0x1d434 - 0x41));

const toMath = (s: string): string =>
  s.replace(/<[^>]*>|[A-Za-z]+/g, (w, at: number) =>
    w[0] === '<' || w === 'log' || (/^[Oo]$/.test(w) && s[at + 1] === '(') ? w : [...w].map(italic).join(''),
  );

const wrap = (s: string): string => {
  const t = s.trim();
  if (!t) return s;
  const i = s.indexOf(t);
  return `${s.slice(0, i)}<span class="bo">${toMath(t)}</span>${s.slice(i + t.length)}`;
};

export const bigO = (s: string): string => {
  const star = s.endsWith('*') ? '*' : '';
  const body = star ? s.slice(0, -1) : s;
  return (
    body
      .split(JA)
      .map((part, i) => (i % 2 ? part : wrap(part)))
      .join('') + star
  );
};
