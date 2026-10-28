/** SVG テーマスキーマチェッカーの入口: コード → 無害化 → ライト・ダークの 2 画面 */
import { $ } from '../../lib/dom';
import { initToolPage } from '../../lib/tool-page';
import { type Edit, gutterHtml, hlHtml, indentEdit, lineCount, newlineEdit } from './code';
import { reportText } from './policy';
import { Preview } from './preview';
import { SAMPLES } from './samples';
import { sanitize, themed } from './sanitize';
import { n4, sizeOf, type Theme } from './view';

initToolPage();

const ta = $<HTMLTextAreaElement>('#code'),
  hlEl = $('#hl'),
  gut = $('#gut'),
  ed = $('#ed'),
  codeMsg = $('#codeMsg'),
  rmMsg = $('#rmMsg'),
  run = $('#st-run');
const pv = new Preview([$('#pvL'), $('#pvD')], [$<HTMLImageElement>('#imL'), $<HTMLImageElement>('#imD')], $('#st-z'));
const THEMES: Theme[] = ['light', 'dark'];
const urls: (string | null)[] = [null, null];

function say(el: HTMLElement, cls: '' | 'er' | 'pv', text: string): void {
  el.className = `msg${cls ? ` ${cls}` : ''}`;
  el.textContent = text;
}
function setRun(hold: boolean): void {
  run.classList.toggle('hold', hold);
  (run.firstElementChild as HTMLElement).textContent = hold ? 'HOLD' : 'RUN';
  run.title = hold ? 'コードを読めないため、最後に読めた状態を表示しています' : '';
}

/* ---------- コード → プレビュー ---------- */
let errLine = 0,
  pendingFit = false;
function update(): void {
  const text = ta.value;
  errLine = 0;
  if (!text.trim()) {
    pv.imgs.forEach((im, i) => {
      im.hidden = true;
      im.removeAttribute('src');
      const u = urls[i];
      if (u) URL.revokeObjectURL(u);
      urls[i] = null;
    });
    pv.shown = false;
    $('#st-sz').textContent = $('#st-vb').textContent = '—';
    pv.apply();
    setRun(false);
    say(codeMsg, '', '');
    say(rmMsg, '', '');
    paintGutter();
    return;
  }
  let res: ReturnType<typeof sanitize>;
  try {
    res = sanitize(text);
  } catch (err) {
    res = { err: { msg: `処理できませんでした（${err instanceof Error ? err.message : String(err)}）` } };
  }
  if (res.err) {
    const { line, col, msg } = res.err;
    errLine = line ?? 0;
    say(codeMsg, 'er', (line ? `${line} 行 ${col} 文字目で読めません: ` : '読めません: ') + msg);
    setRun(pv.shown);
    paintGutter();
    return;
  }
  paintGutter();
  setRun(false);
  say(codeMsg, '', '');
  const r = reportText(res.rep);
  say(rmMsg, r.kind, r.text);

  const svg = res.doc.documentElement;
  const sz = sizeOf(svg.getAttribute('viewBox'), svg.getAttribute('width'), svg.getAttribute('height')),
    changed = sz.w !== pv.W || sz.h !== pv.H;
  pv.W = sz.w;
  pv.H = sz.h;
  $('#st-sz').textContent = `${sz.auto ? 'auto ' : ''}${n4(sz.w)} × ${n4(sz.h)}`;
  $('#st-vb').textContent = sz.vb ? sz.vb.map(n4).join(' ') : '—';
  const doc = res.doc;
  THEMES.forEach((th, i) => {
    const xml = new XMLSerializer().serializeToString(themed(doc, th));
    const u = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
    const im = pv.imgs[i] as HTMLImageElement,
      old = urls[i];
    urls[i] = u;
    im.onerror = () => {
      if (urls[i] === u) say(codeMsg, 'er', '画像として描けませんでした');
    };
    im.src = u;
    im.hidden = false;
    /* 表示中の画像は読み込み済みなので、古い URL はすぐ解放してよい */
    if (old) URL.revokeObjectURL(old);
  });
  const first = !pv.shown;
  pv.shown = true;
  pv.refit(first || pendingFit, changed);
  pendingFit = false;
}

/* ---------- コード入力: 行番号と色分け ---------- */
let gN = -1,
  gE = -1;
function paintGutter(): void {
  const n = lineCount(ta.value);
  if (n === gN && errLine === gE) return;
  gN = n;
  gE = errLine;
  gut.innerHTML = gutterHtml(n, errLine);
}
function paint(): void {
  hlEl.innerHTML = hlHtml(ta.value);
  paintGutter();
}
let upT: ReturnType<typeof setTimeout> | undefined;
function onEdit(): void {
  paint();
  syncSel();
  clearTimeout(upT);
  upT = setTimeout(update, 160);
}
ta.addEventListener('input', onEdit);

/** 取り消し（Ctrl+Z）が効くように、挿入は insertText で行う */
function apply(e: Edit): void {
  ta.setSelectionRange(e.from, e.to);
  let ok = false;
  try {
    ok = document.execCommand('insertText', false, e.text);
  } catch {
    ok = false;
  }
  if (!ok) {
    ta.setRangeText(e.text, e.from, e.to, 'end');
    onEdit();
  }
  if (e.sel) ta.setSelectionRange(...e.sel);
}
let escArm = false;
ta.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    escArm = true;
    return;
  }
  if (e.key === 'Tab') {
    /* Esc の後の Tab と修飾キーつきの Tab は、フォーカスの移動に使う */
    if (escArm || e.ctrlKey || e.altKey || e.metaKey) {
      escArm = false;
      return;
    }
    e.preventDefault();
    apply(indentEdit(ta.value, ta.selectionStart, ta.selectionEnd, e.shiftKey));
    return;
  }
  escArm = false;
  if (e.key === 'Enter' && !e.isComposing && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    apply(newlineEdit(ta.value, ta.selectionStart, ta.selectionEnd));
  }
});

/* ---------- 読み込み（ファイル・例） ---------- */
const sel = $<HTMLSelectElement>('#exSel');
/** 最後に読み込んだコード（例・ファイル）と、それが例ならその id。これと違えば書き換えたとみなす */
let base: string | null = null,
  baseId = '';
/** 読み込んだ例のままなら一覧でその例を選び、書き換えたら「—」にする（同じ例をもう一度選べるように） */
function syncSel(): void {
  sel.value = baseId && ta.value === base ? baseId : '';
}
/** 書き換えたコードがあれば、捨ててよいかを確かめる */
const mayDiscard = (q: string): boolean =>
  !ta.value.trim() || ta.value === base || confirm(`書き換えたコードは保存されません。${q}`);
function setCode(text: string, id = ''): void {
  ta.value = base = text;
  baseId = id;
  ed.scrollTop = ed.scrollLeft = 0;
  pendingFit = true;
  clearTimeout(upT);
  paint();
  syncSel();
  update();
}
sel.addEventListener('change', () => {
  const s = SAMPLES.find((x) => x.id === sel.value);
  if (!s) return;
  if (mayDiscard(`「${s.name}」の例に切り替えますか？`)) setCode(s.svg, s.id);
  else syncSel();
});
const MAX = 5 * 1024 * 1024;
async function loadFile(f: File | undefined): Promise<void> {
  if (!f) return;
  if (f.size > MAX) {
    say(codeMsg, 'er', `「${f.name}」は 5 MB を超えるため開けません`);
    return;
  }
  if (!mayDiscard(`「${f.name}」を開きますか？`)) return;
  try {
    setCode(await f.text());
  } catch {
    say(codeMsg, 'er', `「${f.name}」を読めませんでした`);
  }
}
const file = $<HTMLInputElement>('#file');
$('#openBtn').addEventListener('click', () => file.click());
file.addEventListener('change', () => {
  void loadFile(file.files?.[0]);
  file.value = '';
});
const hasFile = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
for (const z of [ed, ...pv.panes]) {
  z.addEventListener('dragover', (e) => {
    if (!hasFile(e) || !e.dataTransfer) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    ed.classList.add('drop');
  });
  z.addEventListener('dragleave', () => ed.classList.remove('drop'));
  z.addEventListener('drop', (e) => {
    ed.classList.remove('drop');
    if (!hasFile(e)) return;
    e.preventDefault();
    void loadFile(e.dataTransfer?.files[0]);
  });
}

/* ---------- 表示倍率 ---------- */
$('#zseg').addEventListener('click', (e) => {
  const z = (e.target as Element).closest<HTMLElement>('[data-z]')?.dataset.z;
  if (z === 'in') pv.zoomMid(1.25);
  else if (z === 'out') pv.zoomMid(0.8);
  else if (z === 'fit') pv.whole();
  else if (z === 'one') pv.actual();
});

/* 戻る操作で textarea の中身が復元されることがあるので、今の値から描く。例のままならその例を選んでおく */
const restored = SAMPLES.find((s) => s.svg === ta.value);
if (restored) {
  base = restored.svg;
  baseId = restored.id;
}
syncSel();
pendingFit = true;
paint();
update();
