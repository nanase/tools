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
