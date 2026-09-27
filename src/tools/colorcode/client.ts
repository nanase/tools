/** 抵抗カラーコードの入口: 抵抗値 ↔ 色帯 → 結果・E 系列・代入式 */
import { COLORS, type ColorKey } from '../../lib/colorcode';
import { $, $$, esc } from '../../lib/dom';
import type { Series } from '../../lib/eseries';
import { fmt, ro } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { initToolPage } from '../../lib/tool-page';
import {
  type Bands,
  type Code,
  eRows,
  fromValue,
  INIT,
  keyOf,
  ohmsOf,
  optsOf,
  pct,
  pick,
  type Role,
  roleLong,
  rolesOf,
  seriesOf,
  tolOf,
  withBands,
} from './model';
import { R_DEF, seriesPatch } from './params';
import { bandButtons, bandsSvg, ccChip, colorSeq, eRowsHtml, figLabel, overlaySvg, substHtml } from './view';

initToolPage();

const html = (id: string, s: string) => {
  $(id).innerHTML = s;
};
const txt = (id: string, s: string) => {
  $(id).textContent = s;
};

let code: Code = INIT,
  sel: Role = 'd0';

/* ---------- 抵抗値の行 ---------- */
/** 確定した抵抗値を色帯に当てはめ、表せる値を行へ戻す */
const g = new ParamGroup<'R'>([R_DEF], (v, k) => {
  if (!k) return;
  const a = fromValue(v.R, code);
  code = a.code;
  msgPal('');
  update();
  g.note('R', a.note, a.er ? 'er' : '');
});
/** 色帯から決まった値を行に出す（コールバックは呼ばない） */
const syncR = () => g.set('R', ohmsOf(code), { silent: true });

/* ▲▼ とスライダーの刻み */
const esel = $('#esel');
esel.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-s]');
  if (!b || b.getAttribute('aria-pressed') === 'true') return;
  for (const x of $$('button', esel)) x.setAttribute('aria-pressed', String(x === b));
  g.update('R', seriesPatch(Number(b.dataset.s) as Series));
});

/* ---------- 許容差・温度係数の行 ---------- */
const tolBtns = $$<HTMLButtonElement>('#tolC [data-k]'),
  tcBtns = $$<HTMLButtonElement>('#tcC [data-k]');
function renderRows(): void {
  for (const b of tolBtns) {
    b.hidden = b.dataset.k === 'no' && code.n > 4;
    b.setAttribute('aria-pressed', String(b.dataset.k === code.tol));
  }
  const on = code.n === 6;
  $('#p-tc').classList.toggle('off', !on);
  txt('#s-tc', on ? '温度係数の帯（6 本目）の色（ppm/K）' : '6 本帯のときに使います');
  $('#tcC').hidden = !on;
  for (const b of tcBtns) {
    b.setAttribute('aria-pressed', String(on && b.dataset.k === code.tc));
    b.tabIndex = on ? 0 : -1;
  }
}
$('#tolC').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-k]');
  if (b) setColor('t', b.dataset.k as ColorKey);
});
$('#tcC').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-k]');
  if (b && code.n === 6) setColor('tc', b.dataset.k as ColorKey);
});

/* ---------- 色帯の図と色の選択肢 ---------- */
const msgPal = (text: string) => txt('#m-pal', text);
const svg = $('#rsvg');
function renderFig(): void {
  svg.setAttribute('aria-label', figLabel(code));
  html('#r-bands', bandsSvg(code));
  html('#r-ov', overlaySvg(code, sel));
  const bl = $('#bl');
  bl.style.setProperty('--n', String(rolesOf(code.n).length));
  bl.innerHTML = bandButtons(code, sel);
}
function renderPal(): void {
  const r = sel,
    cur = keyOf(code, r);
  txt('#pal-h', `${roleLong(r)}の色`);
  txt('#pal-s', `左から ${rolesOf(code.n).indexOf(r) + 1} 本目${r === 'tc' ? '（ppm/K）' : ''}`);
  html(
    '#pal',
    optsOf(r, code.n)
      .map((k) => ccChip(r, k, k === cur, r === 'd0' && k === 'k' ? '先頭の帯に黒は使いません' : ''))
      .join(''),
  );
}
function selectBand(r: Role, focus: boolean): void {
  sel = r;
  renderFig();
  renderPal();
  msgPal('');
  if (focus) $<HTMLElement>(`#bl [data-r="${r}"]`).focus();
}
$('#bl').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-r]');
  if (b) selectBand(b.dataset.r as Role, true);
});
$('#fig').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<SVGElement>('[data-b]');
  if (b) selectBand(rolesOf(code.n)[Number(b.dataset.b)], false);
});

/** 帯 r の色を k にする */
function setColor(r: Role, k: ColorKey): void {
  code = pick(code, r, k);
  update();
}
/* 色を選ぶ。許容差より前の帯では、選んだあと次の帯へ進む */
$('#pal').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('[data-k]');
  if (!b || b.disabled) return;
  const r = sel,
    roles = rolesOf(code.n);
  setColor(r, b.dataset.k as ColorKey);
  const nx = roles[roles.indexOf(r) + 1];
  if (nx && r !== 't') selectBand(nx, false);
  /* キーボードで押したときは、選択肢の中にフォーカスを残す */
  if (e.detail === 0) ($('#pal').querySelector<HTMLElement>('[aria-pressed="true"]') ?? $('#pal .chip')).focus();
});

/* 帯の数 */
$('#nsel').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-n]');
  if (!b) return;
  const n = Number(b.dataset.n) as Bands;
  if (n === code.n) return;
  const w = withBands(code, n);
  if ('error' in w) {
    msgPal(w.error);
    return;
  }
  code = w.code;
  update();
  msgPal(w.note);
});

/* ---------- E 系列 ---------- */
function renderE(R: number): void {
  txt('#es-aux', fmt(R, 'Ω', 6));
  html('#elist', eRowsHtml(eRows(R), R));
}
/* 近い値を押すと、その値にする */
$('#elist').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-v]');
  if (b) g.set('R', Number(b.dataset.v));
});

/* ---------- 計算結果 ---------- */
function renderOut(R: number): void {
  const t = tolOf(code),
    ins = seriesOf(R),
    tc = COLORS[code.tc].tc;
  html('#o-v', ro(R, 'Ω', 6));
  html('#o-t', `±${t}<span class="u">%</span>${code.tol === 'no' ? '<span class="m-q">帯なし</span>' : ''}`);
  html('#o-lo', ro(R * (1 - t / 100), 'Ω', 6));
  html('#o-hi', ro(R * (1 + t / 100), 'Ω', 6));
  html('#o-tc', code.n === 6 ? `${tc}<span class="u">ppm/K</span>` : '—<span class="m-q">6 本帯のみ</span>');
  html('#o-es', ins.length ? ins.map((s) => `E${s}`).join('・') : '—<span class="m-q">どの E 系列にもない値</span>');
  html('#o-c', colorSeq(code));
  html('#mn', `R<b>${esc(fmt(R, 'Ω', 6))}</b>`);
  txt('#mt', pct(t));
  txt(
    '#mc',
    rolesOf(code.n)
      .map((r) => keyOf(code, r))
      .filter((k) => k !== 'no')
      .map((k) => COLORS[k].n)
      .join(' '),
  );
  html('#subst', substHtml(code));
}

/** 色帯が変わったら全体を描き直す */
function update(): void {
  const R = ohmsOf(code),
    roles = rolesOf(code.n);
  if (!roles.includes(sel)) sel = code.n === 4 && sel === 'd2' ? 'm' : 'd0';
  for (const b of $$('#nsel button')) b.setAttribute('aria-pressed', String(Number(b.dataset.n) === code.n));
  renderFig();
  renderPal();
  renderRows();
  syncR();
  renderOut(R);
  renderE(R);
}

update();
