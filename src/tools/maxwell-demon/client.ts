/**
 * マクスウェルの悪魔のページの入口。開いた直後から悪魔が動き、毎フレーム計算を進めて図を描き直す。
 * 動きを減らす設定のときは停止した状態で開く
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { storeToggle } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { drawBox, drawLedger, drawTape, drawTemp, fitBox, J_PER_BIT, kelvin, readCols } from './fig';
import { Gas, type Mode, MS } from './gas';
import { MODE_HINT, PARAMS, type PKey } from './params';

initToolPage();

const root = $('#mxd'),
  gas = new Gas(20),
  S = { run: !RM.matches, speed: 1, ledger: true };

const txt = (id: string, s: string) => {
  const n = $(id);
  if (n.textContent !== s) n.textContent = s;
};
const html = (id: string, s: string) => {
  const n = $(id);
  if (n.innerHTML !== s) n.innerHTML = s;
};
const fmt = (n: number) => n.toLocaleString('ja-JP');

/* ---------- 再生 ---------- */
const playBtn = $<HTMLButtonElement>('#mxd-play'),
  handBtn = $<HTMLButtonElement>('#mxd-hand');
function syncUi(): void {
  playBtn.setAttribute('aria-pressed', String(S.run));
  playBtn.classList.toggle('on', S.run);
  txt('#mxd-playT', S.run ? '停止' : '再生');
  $('#mxd-led').classList.toggle('on', S.run);
  txt('#mxd-st', S.run ? '再生中' : '停止中');
  handBtn.hidden = gas.mode !== 'hand';
  handBtn.setAttribute('aria-pressed', String(gas.hand));
  handBtn.classList.toggle('on', gas.hand);
}
playBtn.addEventListener('click', () => {
  S.run = !S.run;
  syncUi();
});
$('#mxd-reset').addEventListener('click', () => {
  gas.reset();
  syncUi();
});
$('#mxd-erase').addEventListener('click', () => gas.erase());

/* 手で扉を開け閉めする */
const hand = (open: boolean) => {
  gas.setHand(open);
  syncUi();
};
handBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  handBtn.setPointerCapture(e.pointerId);
  hand(true);
});
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const)
  handBtn.addEventListener(ev, () => hand(false));
const typing = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, [contenteditable]');
addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || gas.mode !== 'hand' || typing(e.target) || e.repeat) return;
  e.preventDefault();
  hand(true);
});
addEventListener('keyup', (e) => {
  if (e.code === 'Space' && gas.mode === 'hand') hand(false);
});
addEventListener('blur', () => hand(false));

/* ---------- 入力 ---------- */
const params = new ParamGroup<PKey>(PARAMS, (v) => {
  if (v.n !== gas.n) gas.reset(v.n);
  gas.vth = v.vth / MS;
  gas.gap = v.gap / 100;
  gas.cap = v.cap;
  S.speed = v.speed / 100;
  syncUi();
});
const syncMode = (m: Mode) => {
  gas.mode = m;
  gas.hand = false;
  txt('#mxd-hint', MODE_HINT[m]);
  params.setOff('vth', m !== 'temp', m === 'temp' ? '' : '温度の差の悪魔だけ');
  syncUi();
};
syncMode(new Choice<Mode>($('#p-mode'), syncMode).value);

/* エントロピーの収支の表示 */
const ledT = $<HTMLButtonElement>('#mxd-ledT'),
  ledP = $('.mxd-ledp'),
  top = $('#mxd-top');
function syncLedger(): void {
  ledT.setAttribute('aria-pressed', String(S.ledger));
  $('.led', ledT).classList.toggle('on', S.ledger);
  ledP.hidden = !S.ledger;
  top.classList.toggle('one', !S.ledger);
}
ledT.addEventListener('click', () => {
  S.ledger = !S.ledger;
  syncLedger();
});
storeToggle(ledT);

/* ---------- 表示の値 ---------- */
const deg = (T: number) => {
  const c = kelvin(T) - 273;
  return c < 0 ? `−${-c}` : `${c}`;
};
/** 3.5 × 10⁻¹⁸ のような表記 */
function sci(v: number): string {
  if (!v) return '0';
  const e = Math.floor(Math.log10(v)),
    m = v / 10 ** e,
    sup = String(e)
      .replace('-', '⁻')
      .replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]);
  return `${m.toFixed(1)} × 10${sup}`;
}
function meters(): void {
  const { N, T } = gas.stats(),
    t = (k: 0 | 1) => (N[k] ? `${kelvin(T[k])} <small>K</small><small class="c">${deg(T[k])} ℃</small>` : '—');
  html('#m-tl', t(0));
  html('#m-tr', t(1));
  txt('#m-nn', `${N[0]} / ${N[1]}`);
  html('#m-bits', gas.mode === 'none' ? '—' : `${fmt(gas.meas)} <small>回</small>`);
  if (!S.ledger) return;
  txt('#m-tape', `${fmt(gas.tape.length)} / ${fmt(gas.cap)} ビット`);
  txt(
    '#m-erased',
    gas.erased
      ? `消したビット ${fmt(gas.erased)}・出した熱 ${sci(gas.erased * J_PER_BIT)} J 以上`
      : '1 ビットあたり kT ln 2 以上の熱',
  );
}

/* ---------- 毎フレーム ---------- */
const cvBox = $<HTMLCanvasElement>('#mxd-box'),
  cvTemp = $<HTMLCanvasElement>('#mxd-temp'),
  cvLed = $<HTMLCanvasElement>('#mxd-ledg'),
  cvTape = $<HTMLCanvasElement>('#mxd-tape');
const recolor = () => readCols(root);
new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);

let last = 0;
function loop(now: number): void {
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
  last = now;
  if (S.run && dt > 0) gas.run(dt * S.speed);
  fitBox(cvBox, top.classList.contains('one') ? 560 : 440);
  drawBox(cvBox, gas);
  if (!$('.mxd-tempp').classList.contains('shut')) drawTemp(cvTemp, gas);
  if (S.ledger) {
    drawLedger(cvLed, gas);
    drawTape(cvTape, gas);
  }
  meters();
  requestAnimationFrame(loop);
}
for (const b of $$('.mxd-st svg')) b.setAttribute('focusable', 'false');
recolor();
syncUi();
syncLedger();
requestAnimationFrame(loop);
