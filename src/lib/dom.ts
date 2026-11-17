/** 要素を 1 つ取る。ビルド時に出した HTML にあるはずの要素なので、ないときは例外にする */
export function $<T extends Element = HTMLElement>(s: string, r: ParentNode = document): T {
  const el = r.querySelector<T>(s);
  if (!el) throw new Error(`element not found: ${s}`);
  return el;
}
export const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document): T[] => [
  ...r.querySelectorAll<T>(s),
];
export const norm = (s: string): string => s.normalize('NFKC').toLowerCase();
/** ツールの絞り込みで比べる形。「モーター」と「モータ」のように長音の有無が違っても当たるよう「ー」を除く */
export const foldKey = (s: string): string => norm(s).replace(/ー/g, '');

/** HTML に埋め込む文字列のエスケープ */
export const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
