/**
 * 既定値に戻す。入力の行（ParamGroup・Choice の行。ページ固有の行も addRow で足せる）を登録すると、
 * 既定値と違う行に印（.mod: 左端の線と、行末の ↺）を付け、枠の見出しの右（Panel.astro の .prst）に
 * 「↺ n」を出す。印は値が変わるたびに mark() で合わせる（同じタスクの中の変更はまとめて 1 回）
 */

export interface Resettable {
  /** 既定値と違うか（使わない行は false） */
  isMod(): boolean;
  /** 既定値に戻す。値が変わったときの処理（onChange・保存）も行う */
  reset(): void;
}

/** 行の集まり（枠ごと）。DOM に依らない部分 */
export class ResetSet<G> {
  private readonly items: { g: G; r: Resettable }[] = [];

  add(g: G, r: Resettable): void {
    this.items.push({ g, r });
  }

  /** 枠 g の既定値と違う行の数 */
  count(g: G): number {
    return this.items.filter((x) => x.g === g && x.r.isMod()).length;
  }

  /** 登録した枠（重複なし、登録順） */
  groups(): G[] {
    return [...new Set(this.items.map((x) => x.g))];
  }

  /**
   * 枠 g の行をすべて既定値に戻し、戻した行の数を返す。範囲がほかの行で決まる行（fs で上限が決まる fc など）は
   * 先に戻した行の範囲で丸められて既定値に届かないことがあるので、違う行が残れば 3 回まで繰り返す
   */
  reset(g: G): number {
    let n = 0;
    for (let pass = 0; pass < 3; pass++) {
      const m = this.items.filter((x) => x.g === g && x.r.isMod());
      if (!m.length) break;
      for (const x of m) x.r.reset();
      if (!pass) n = m.length;
    }
    return n;
  }
}

/* ---------- 画面 ---------- */
const ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5V9h4.5"/></svg>';
const set = new ResetSet<HTMLElement | null>();
const rows: { row: HTMLElement; r: Resettable }[] = [];
const bound = new Set<HTMLElement>();
let queued = false;
/** 枠の幅が変わったら「↺ n」を出すかを決め直す */
const fitter =
  typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver((es) => {
        for (const e of es) fitBtn(e.target as HTMLElement);
      });

/** 行のうち、戻したあとにフォーカスを移す操作の部品 */
const ctlOf = (row: HTMLElement) =>
  row.querySelector<HTMLElement>('.sc:not([aria-disabled="true"]), [aria-pressed="true"], button:not(.rrst)');

/**
 * 行を出しているか。ページが使わない間だけ隠す行（1 層のときの層の構成、マイクのときのテスト信号の周波数、
 * もう一方の表示の設定など）は数えず、戻さない。「その他」を閉じている間の行は数える
 */
function shown(row: HTMLElement): boolean {
  for (let e: HTMLElement | null = row; e; e = e.parentElement)
    if (e.hidden && !e.classList.contains('more-b')) return false;
  return getComputedStyle(row).display !== 'none';
}

/** 枠の「↺ n」のボタン（Panel.astro・Collapsible.astro） */
const panelBtn = (p: HTMLElement) => p.querySelector<HTMLButtonElement>(':scope > .ph .prst, :scope > .pha .prst');

/**
 * 行を登録する。行末の ↺（.c-rst の button）を押すとその行を、枠の「↺ n」を押すと枠の行をまとめて戻す。
 * 行は .pnl の中に置く（外に置いた行は行末の ↺ だけ）。隠している行は数えない
 */
export function addRow(row: HTMLElement, r0: Resettable): void {
  const pnl = row.closest<HTMLElement>('.pnl'),
    r: Resettable = { isMod: () => shown(row) && r0.isMod(), reset: () => r0.reset() };
  set.add(pnl, r);
  rows.push({ row, r });
  const b = row.querySelector<HTMLButtonElement>(':scope > .c-rst > button');
  b?.addEventListener('click', () => {
    const had = document.activeElement === b;
    r.reset();
    sync();
    if (had) ctlOf(row)?.focus();
  });
  if (pnl && !bound.has(pnl)) {
    bound.add(pnl);
    const pb = panelBtn(pnl);
    fitter?.observe(pnl);
    pb?.addEventListener('click', () => {
      const had = document.activeElement === pb,
        first = rows.find((x) => x.row.closest('.pnl') === pnl && x.r.isMod());
      set.reset(pnl);
      sync();
      if (had && first) ctlOf(first.row)?.focus();
    });
  }
  mark();
}

/** 値が変わったことを知らせる（印と件数を合わせ直す） */
export function mark(): void {
  if (queued || typeof document === 'undefined') return;
  queued = true;
  queueMicrotask(sync);
}

function sync(): void {
  queued = false;
  for (const { row, r } of rows) row.classList.toggle('mod', r.isMod());
  for (const p of set.groups()) {
    if (!p) continue;
    const b = panelBtn(p);
    if (!b) continue;
    const n = set.count(p),
      t = `${n} 件`,
      was = b.hidden ? 0 : Number(b.dataset.n);
    b.hidden = !n;
    if (n && b.dataset.n !== String(n)) {
      b.dataset.n = String(n);
      b.innerHTML = `${ICON}<span>${n}</span>`;
      b.title = `この枠の ${t}を既定値に戻す`;
      b.setAttribute('aria-label', `この枠の ${t}の入力を既定値に戻す`);
    }
    /* 出し入れと件数が変わったときだけ測る（ドラッグの間に何度も測らない） */
    if (n !== was) fitBtn(p);
  }
}

/**
 * 枠の見出しと右端の補足・ボタンが重なるなら（狭い画面で選択肢が多い枠）、「↺ n」を出さない
 * （行末の ↺ とページ見出しの ↺ は残る）
 */
function fitBtn(p: HTMLElement): void {
  const b = panelBtn(p),
    h = p.querySelector(':scope > .ph > h2, :scope > summary > h2');
  if (!b || !h) return;
  b.classList.remove('gone');
  if (b.hidden) return;
  if (b.getBoundingClientRect().left < h.getBoundingClientRect().right + 8) b.classList.add('gone');
}
