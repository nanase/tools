/**
 * 設定の保存（localStorage）。ページごとに 1 つのキー（settings:<パス>）へ、項目の値をまとめて JSON で持ち、
 * 開き直したときに同じ設定にする。ParamGroup（p:<項目>・series）と Choice（c:<要素の id>）は自分で読み書きし、
 * 既定値に戻した項目は消す。「その他」のまとまり（More.astro）の開閉は m:<要素の id>。
 * ページ見出しの「もとに戻す」ボタン（PageTitle.astro）で消して読み込み直す。
 * localStorage を使えない環境（プライベートブラウズなど）では、保存せずに既定値で動く
 */
type Data = Record<string, unknown>;

const KEY = typeof location === 'undefined' ? '' : `settings:${location.pathname}`;
let data: Data = {};
let timer: ReturnType<typeof setTimeout> | undefined;

function read(): Data {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
function write(): void {
  clearTimeout(timer);
  timer = undefined;
  try {
    if (Object.keys(data).length) localStorage.setItem(KEY, JSON.stringify(data));
    else localStorage.removeItem(KEY);
  } catch {
    /* 保存できない環境 */
  }
}
if (KEY) {
  data = read();
  /* まとめて書く前にページを離れても、最後の変更を残す */
  addEventListener('pagehide', () => {
    if (timer) write();
  });
}

/** 保存した値。なければ undefined */
export const stored = (k: string): unknown => data[k];

/** 値を保存する（少し待ってまとめて書く） */
export function store(k: string, v: unknown): void {
  if (!KEY) return;
  data[k] = v;
  later();
}

/** 保存した値を消す（既定値に戻したとき。開き直すと既定値になる） */
export function forget(k: string): void {
  if (!KEY || !(k in data)) return;
  delete data[k];
  later();
}

function later(): void {
  clearTimeout(timer);
  timer = setTimeout(write, 300);
}

/** このページの設定を消して、既定値で読み込み直す */
export function resetAll(): void {
  data = {};
  write();
  location.reload();
}

/**
 * 表示の切り替えボタン（.tg、aria-pressed）を保存する。保存した状態と既定が違えば押して戻す
 * （ボタンの click の処理を先に付けておく）。以後、押すたびに保存する
 */
export function storeToggle(btn: HTMLElement): void {
  const k = `t:${btn.id}`,
    v = stored(k);
  if (typeof v === 'boolean' && v !== (btn.getAttribute('aria-pressed') === 'true')) btn.click();
  btn.addEventListener('click', () => store(k, btn.getAttribute('aria-pressed') === 'true'));
}
