/** PCB コイルのページの入口: 形と寸法 → インダクタンス・抵抗・Q・共振 → 結果・形の図・周波数特性・代入式 */
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { fmt, ro } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { SH, SW } from '../../lib/scope';
import { initToolPage } from '../../lib/tool-page';
import { C0, type Coil, calc, fRes, nearE24, nMax, type Shape, shapeOf } from './coil';
import { substHtml } from './math';
import { doutPatch, doutSub, fmtF, type Key, mmT, nPatch, PARAMS, roF, shapeSub, sig, wLimit, wPatch } from './params';
import { figPlot, frPlot, frRead } from './plot';

const html = (id: string, s: string) => {
  $(id).innerHTML = s;
};
const txt = (id: string, s: string) => {
  $(id).textContent = s;
};
initToolPage();

/* ---------- 状態 ---------- */
let shape: Shape = shapeOf($('#p-shape button[aria-pressed="true"]').dataset.v ?? '');
/** 最後に計算した結果（周波数特性のカーソルの元） */
let S: Coil | null = null;

/* ---------- 計算と描画 ---------- */
function compute(v: Record<Key, number>): void {
  const r = calc(shape, v, v.f);
  S = r;
  const diff = (x: number) => {
    const d = (x / r.L - 1) * 100;
    return `主値との差 ${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} %`;
  };
  html('#o-L', ro(r.L, 'H'));
  txt('#o-Ln', r.s > 3 * r.w ? '間隔が幅の 3 倍を超えるため、誤差が論文の最大 8 % より大きくなることがあります' : '');
  html('#o-Lmw', ro(r.Lmw, 'H'));
  txt('#o-Lmws', shape.K ? diff(r.Lmw) : '円形の係数は論文にありません');
  html('#o-Lmn', ro(r.Lmn, 'H'));
  txt('#o-Lmns', shape.m ? diff(r.Lmn) : '円形の係数は論文にありません');
  html('#o-din', `${sig(r.din * 1e3, 4)}<span class="u">mm</span>`);
  html('#o-rho', r.rho.toFixed(3));
  html('#o-len', ro(r.len, 'm'));
  const lr = r.len / (C0 / r.f);
  txt('#o-lens', `波長の ${lr >= 0.1 ? sig(lr, 2) : `1/${Math.round(1 / lr)}`}`);
  txt('#o-lenn', lr > 0.1 ? '波長の 1/10 を超えるため、集中定数としての計算は目安になりません' : '');
  html('#o-rdc', ro(r.rdc, 'Ω'));
  html('#o-dl', ro(r.dl, 'm', 3));
  txt('#o-dls', `実効厚さ ${fmt(r.teff, 'm', 3)}`);
  html('#o-rac', ro(r.rac, 'Ω'));
  txt('#o-racs', `直流抵抗の ${sig(r.rac / r.rdc, 3)} 倍`);
  html('#o-q', sig(r.q, 3));
  const ce = nearE24(r.c);
  html('#o-c', roF(r.c));
  txt('#o-cs', `E24 の ${fmtF(ce, 3)} なら ${fmt(fRes(r.L, ce), 'Hz', 4)}`);
  html('#o-bw', ro(r.bw, 'Hz', 3));
  txt('#mL', fmt(r.L, 'H', 4));
  txt('#mQ', sig(r.q, 3));
  txt('#mC', fmtF(r.c, 3));
  drawFig(r, v.w, v.s);
  drawFr(r);
  html('#subst', substHtml(r, shape, v.w, v.s));
}

/* ---------- コイルの形 ---------- */
function drawFig(r: Coil, w: number, s: number): void {
  const p = figPlot({ sh: shape, n: r.n, dout: r.d * 1e3, din: r.din * 1e3, w, s });
  const coil = $('#fg-coil');
  coil.setAttribute('d', p.coil);
  coil.style.strokeWidth = p.width;
  html('#fg-pads', p.pads);
  html('#fg-dim', p.dim);
  txt('#fg-w', `w ${mmT(w)}`);
  txt('#fg-sh', shape.en);
  txt('#fg-div', `${sig(p.dv, 2)} mm`);
  txt('#fg-n', String(r.n));
  $('#fg-svg').setAttribute('aria-label', p.label);
}

/* ---------- 周波数特性 ---------- */
/** カーソルの x（表示窓の外なら null） */
let frX: number | null = null;
function drawFr(r: Coil): void {
  const p = frPlot(r);
  $('#fr-t1').setAttribute('d', p.q);
  $('#fr-t1o').setAttribute('d', p.qOver);
  $('#fr-t2').setAttribute('d', p.r);
  $('#fr-t2o').setAttribute('d', p.rOver);
  $('#fr-lm').setAttribute('d', p.lambda);
  $('#fr-f').setAttribute('d', p.fLine);
  $('#fr-dt').setAttribute('d', p.skin);
  html('#fr-ax', p.axes);
  txt('#fr-qd', sig(p.qd, 2));
  txt('#fr-rd', fmt(p.rd, 'Ω', 2));
  frCursor();
  $('#fr-svg').setAttribute('aria-label', p.label);
}
function frCursor(): void {
  if (!S) return;
  $('#fr-cl').setAttribute('d', frX == null ? '' : `M${frX.toFixed(1)} 0V${SH}`);
  html('#fr-cur', frRead(S, frX).html);
}
{
  const svg = $<SVGSVGElement>('#fr-svg');
  const move = (e: PointerEvent) => {
    const m = svg.getScreenCTM();
    if (!m) return;
    const x = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()).x;
    frX = x < 0 || x > SW ? null : x;
    frCursor();
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', () => {
    frX = null;
    frCursor();
  });
}

/* ---------- 入力 ---------- */
const G = new ParamGroup<Key>(PARAMS, compute);

/* 依存: 外径・幅・間隔 → 幅の上限・外径の下限・巻数の上限。巻数は内径が 0 以下にならないよう丸める */
function geo(): void {
  const dout = G.get('dout');
  G.update('w', wPatch(dout));
  if (G.get('w') >= (dout / 2) * (1 - 1e-9)) {
    const x = wLimit(dout);
    G.set('w', x, { silent: true });
    G.note('w', `外径の 1/2 未満にするため ${mmT(x)} にしました`, 'er');
  }
  const w = G.get('w'),
    s = G.get('s');
  G.update('dout', doutPatch(w));
  G.update('n', nPatch(dout, w, s));
  const m = nMax(dout, w, s);
  if (G.get('n') > m) {
    G.set('n', m, { silent: true });
    G.note('n', `内径が 0 以下になるため ${m} 巻にしました`, 'er');
  }
}
for (const k of ['dout', 'w', 's'] as const) G.on(k, geo);

const shape$ = new Choice($('#p-shape'), (v) => {
  shape = shapeOf(v);
  shape$.setSub(shapeSub(shape));
  G.update('dout', { sub: doutSub(shape) });
  compute(G.values());
});
