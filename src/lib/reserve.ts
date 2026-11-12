/**
 * 中身が入れ替わる要素の高さを、入りうる中身のうちいちばん高いものに合わせて取っておく。
 * 工程ごとの説明・手法の説明・モードで変わる項目名など、中身の候補を並べられる要素に使う。
 * 決まりは design/page.md の「動いても場所を変えない」
 */

interface Held {
  variants: readonly string[];
  html: boolean;
  width: number;
}
const held = new Map<HTMLElement, Held>();
let ro: ResizeObserver | null = null;

/** el の写しに候補を順に入れ、いちばん高いものを min-height にする */
function measure(el: HTMLElement, h: Held): void {
  const parent = el.parentElement;
  if (!parent || !el.getClientRects().length) return;
  const w = el.getBoundingClientRect().width;
  h.width = w;
  const c = el.cloneNode(false) as HTMLElement;
  c.removeAttribute('id');
  c.removeAttribute('aria-live');
  c.setAttribute('aria-hidden', 'true');
  Object.assign(c.style, {
    position: 'absolute',
    visibility: 'hidden',
    pointerEvents: 'none',
    left: '0',
    top: '0',
    width: `${w}px`,
    minHeight: '0',
    height: 'auto',
    maxHeight: 'none',
  });
  parent.append(c);
  let max = 0;
  for (const v of h.variants) {
    if (h.html) c.innerHTML = v;
    else c.textContent = v;
    max = Math.max(max, c.getBoundingClientRect().height);
  }
  c.remove();
  const cs = getComputedStyle(el);
  const pad =
    cs.boxSizing === 'border-box'
      ? 0
      : Number.parseFloat(cs.paddingTop) +
        Number.parseFloat(cs.paddingBottom) +
        Number.parseFloat(cs.borderTopWidth) +
        Number.parseFloat(cs.borderBottomWidth);
  el.style.minHeight = `${Math.ceil(max - pad)}px`;
}

/**
 * el の高さを、variants（textContent か、html なら innerHTML）のうちいちばん高いものに合わせて取っておく。
 * html の候補はページ自身が el に書く中身に限る（入力した文字は入れない）。幅が変わったら測り直す。候補が変わったら、もう一度呼ぶ
 */
export function reserveHeight(el: HTMLElement, variants: readonly string[], opt: { html?: boolean } = {}): void {
  const cur = opt.html ? el.innerHTML : (el.textContent ?? '');
  const h: Held = { variants: [...variants, cur], html: !!opt.html, width: -1 };
  const first = !held.has(el);
  held.set(el, h);
  measure(el, h);
  if (!first) return;
  if (!ro)
    /* Web フォントの読み込み前に測ると低く取るので、読み込んだら測り直す */
    document.fonts?.addEventListener('loadingdone', () => {
      for (const [e, s] of held) measure(e, s);
    });
  ro ??= new ResizeObserver((es) => {
    for (const e of es) {
      const t = e.target as HTMLElement,
        s = held.get(t);
      if (s && Math.abs(t.getBoundingClientRect().width - s.width) >= 1) measure(t, s);
    }
  });
  ro.observe(el);
}
