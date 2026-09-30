/** コード入力: 色分け、行番号、字下げ。DOM に依存しない（ビルド時の初期表示にも使う） */
import { esc } from '../../lib/dom';

const T = (c: string, t: string) => (t ? `<span class="${c}">${esc(t)}</span>` : '');

/**
 * CSS の 1 区切り（{ ; } の手前まで）。{ の手前はセレクタ（@ で始まれば at ルールと条件）、
 * それ以外は宣言（: の手前がプロパティ、後ろが値）。コメントはどこにあっても色分けする
 */
function cssSeg(seg: string, end: string): string {
  let o = '',
    role: 'sel' | 'prop' | 'val' = end === '{' ? 'sel' : 'prop',
    first = true;
  for (const part of seg.split(/(\/\*[\s\S]*?(?:\*\/|$))/)) {
    if (!part) continue;
    if (part.startsWith('/*')) {
      o += T('x-cm', part);
      continue;
    }
    let rest = part;
    if (first && rest.trim()) {
      first = false;
      const at = /^(\s*)(@[\w-]+)/.exec(rest);
      if (at) {
        o += at[1] + T('x-k', at[2]);
        rest = rest.slice(at[0].length);
        role = 'val';
      }
    }
    if (role === 'prop') {
      const c = rest.indexOf(':');
      if (c < 0) {
        o += T('x-a', rest);
        continue;
      }
      o += T('x-a', rest.slice(0, c)) + T('x-p', ':');
      rest = rest.slice(c + 1);
      role = 'val';
    }
    o += T(role === 'sel' ? 'x-t' : 'x-v', rest);
  }
  return o;
}

/** style 要素の中身（CSS）を色分けした HTML にする */
export function hlCss(s: string): string {
  let o = '',
    i = 0;
  const n = s.length;
  while (i < n) {
    if (s.startsWith('<![CDATA[', i) || s.startsWith(']]>', i)) {
      const m = s[i] === '<' ? '<![CDATA[' : ']]>';
      o += T('x-p', m);
      i += m.length;
      continue;
    }
    let j = i;
    while (j < n && !'{};'.includes(s[j]) && !s.startsWith('<![CDATA[', j) && !s.startsWith(']]>', j)) {
      if (s.startsWith('/*', j)) {
        const e = s.indexOf('*/', j + 2);
        j = e < 0 ? n : e + 2;
      } else if (s[j] === '"' || s[j] === "'") {
        const e = s.indexOf(s[j], j + 1);
        j = e < 0 ? n : e + 1;
      } else j++;
    }
    const end = '{};'.includes(s[j] ?? '') ? (s[j] ?? '') : '';
    o += cssSeg(s.slice(i, j), end) + T('x-p', end);
    i = j + end.length;
  }
  return o;
}

/** XML を色分けした HTML にする。style 要素の中は CSS として色分けする。長すぎるときは色分けしない */
export function hl(s: string): string {
  if (s.length > 300000) return esc(s);
  const RN = /<\/?[A-Za-z_][\w:.-]*/y,
    WS = /\s+/y,
    CL = /\/?>/y,
    AN = /[^\s=/>"'<]+/y,
    EQ = /\s*=\s*/y,
    AV = /"[^"]*"?|'[^']*'?|[^\s>"']+/y;
  const at = (re: RegExp, i: number): string | null => {
    re.lastIndex = i;
    const m = re.exec(s);
    return m ? m[0] : null;
  };
  let o = '',
    i = 0,
    /** 直前が style の開始タグなら、閉じタグまでを CSS として色分けする */
    css = false;
  const n = s.length;
  while (i < n) {
    if (css) {
      css = false;
      const e = s.slice(i).search(/<\/style/i),
        j = e < 0 ? n : i + e;
      o += hlCss(s.slice(i, j));
      i = j;
      continue;
    }
    const lt = s.indexOf('<', i);
    if (lt < 0) {
      o += T('x-tx', s.slice(i));
      break;
    }
    if (lt > i) {
      o += T('x-tx', s.slice(i, lt));
      i = lt;
    }
    if (s.startsWith('<!--', i)) {
      const e = s.indexOf('-->', i + 4),
        j = e < 0 ? n : e + 3;
      o += T('x-cm', s.slice(i, j));
      i = j;
      continue;
    }
    if (s.startsWith('<![CDATA[', i)) {
      const e = s.indexOf(']]>', i + 9),
        j = e < 0 ? n : e;
      o += T('x-p', '<![CDATA[') + T('x-tx', s.slice(i + 9, j)) + (e < 0 ? '' : T('x-p', ']]>'));
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (s[i + 1] === '?' || s[i + 1] === '!') {
      const e = s.indexOf('>', i),
        j = e < 0 ? n : e + 1;
      o += T('x-cm', s.slice(i, j));
      i = j;
      continue;
    }
    const tag = at(RN, i);
    if (!tag) {
      o += T('x-tx', '<');
      i++;
      continue;
    }
    const cl = tag[1] === '/' ? 2 : 1,
      isStyle = cl === 1 && tag.slice(cl).toLowerCase() === 'style';
    o += T('x-p', tag.slice(0, cl)) + T('x-t', tag.slice(cl));
    i += tag.length;
    while (i < n) {
      let m = at(WS, i);
      if (m) {
        o += m;
        i += m.length;
        continue;
      }
      m = at(CL, i);
      if (m) {
        o += T('x-p', m);
        i += m.length;
        css = isStyle && m === '>';
        break;
      }
      if (s[i] === '<') break;
      m = at(AN, i);
      if (m) {
        o += T('x-a', m);
        i += m.length;
        const eq = at(EQ, i);
        if (eq) {
          o += T('x-p', eq);
          i += eq.length;
          const v = at(AV, i);
          if (v) {
            o += T('x-v', v);
            i += v.length;
          }
        }
      } else {
        o += T('x-p', s[i] ?? '');
        i++;
      }
    }
  }
  return o;
}

/** 色分けした写しの HTML。末尾が改行のとき、textarea と同じ高さにするため 1 行足す */
export const hlHtml = (v: string): string => hl(v) + (v.endsWith('\n') || !v ? ' ' : '');

/** 行数 */
export function lineCount(v: string): number {
  let n = 1;
  for (let i = v.indexOf('\n'); i >= 0; i = v.indexOf('\n', i + 1)) n++;
  return n;
}
/** 行番号の HTML。err 行（1 始まり、0 はなし）を強調する */
export function gutterHtml(n: number, err = 0): string {
  let h = '';
  for (let i = 1; i <= n; i++) h += `${i === err ? `<span class="er">${i}</span>` : i}\n`;
  return h;
}

/** 選択範囲 [from, to) を text に置き換え、sel があればその範囲を選ぶ */
export interface Edit {
  from: number;
  to: number;
  text: string;
  sel?: [number, number];
}
/**
 * Tab・Shift+Tab の字下げ。複数行にかからない Tab は空白 2 つを入れる。
 * それ以外は選択にかかる行の頭に空白 2 つを足す（戻すときは空白 1〜2 つかタブ 1 つを除く）
 */
export function indentEdit(v: string, a: number, b: number, out: boolean): Edit {
  if (!out && !v.slice(a, b).includes('\n')) return { from: a, to: b, text: '  ' };
  const ls = v.lastIndexOf('\n', a - 1) + 1;
  let le = v.indexOf('\n', b > a && v[b - 1] === '\n' ? b - 1 : b);
  if (le < 0) le = v.length;
  const nb = v
    .slice(ls, le)
    .split('\n')
    .map((l) => (out ? l.replace(/^(?: {1,2}|\t)/, '') : `  ${l}`))
    .join('\n');
  return { from: ls, to: le, text: nb, sel: [ls, ls + nb.length] };
}
/** Enter: 改行して、今の行の頭の空白を引き継ぐ */
export function newlineEdit(v: string, a: number, b: number): Edit {
  const ls = v.lastIndexOf('\n', a - 1) + 1;
  return { from: a, to: b, text: `\n${/^[ \t]*/.exec(v.slice(ls, a))?.[0] ?? ''}` };
}
