/** PCB コイルのページの入口: 形と寸法 → インダクタンス・抵抗・Q・共振 → 結果・形の図・周波数特性・代入式 */
import { Choice } from '../../lib/choice';
import { $, $$, esc } from '../../lib/dom';
import { fmt, ro } from '../../lib/format';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { SH, SW } from '../../lib/scope';
import { initToolPage } from '../../lib/tool-page';
import { C0, fRes, nearE24, nMax, type Shape, shapeOf } from './coil';
import { type Cand, search } from './design';
import { type Conn, calcStack, gapsText, type Stack, type Stacked, stackFor, stackOf } from './layers';
import { substHtml } from './math';
import {
  doutPatch,
  doutSub,
  FIND_PARAMS,
  type FKey,
  fmtF,
  type Key,
  mmT,
  nPatch,
  PARAMS,
  roF,
  sig,
  wLimit,
  wPatch,
} from './params';
import { coil3d, figPlot, frPlot, frRead } from './plot';

const html = (id: string, s: string) => {
  $(id).innerHTML = s;
};
const txt = (id: string, s: string) => {
  $(id).textContent = s;
};
initToolPage();

/* ---------- 状態 ---------- */
let shape: Shape = shapeOf($('#p-shape button[aria-pressed="true"]').dataset.v ?? '');
/** 基板の構成（1 層なら片面）と層の接続 */
let stack: Stack = stackFor(1),
  conn: Conn = 'ser';
/** 最後に計算した結果（周波数特性のカーソルの元） */
let S: Stacked | null = null;
/** 条件から探す: 準備ができたか、最後に探したときの基板と周波数の設定 */
let findOn = false,
  findKey = '';

/* ---------- 計算と描画 ---------- */
function compute(v: Record<Key, number>): void {
  const r = calcStack(shape, v, v.f, stack, conn);
  S = r;
  const diff = (x: number) => {
    const d = (x / r.L - 1) * 100;
    return `主値との差 ${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} %`;
  };
  html('#o-L', ro(r.L, 'H'));
  txt(
    '#o-Ls',
    r.nl > 1
      ? `1 層 ${fmt(r.L1, 'H', 4)} の ${sig(r.L / r.L1, 3)} 倍・隣り合う層の結合 ${r.k.map((k) => sig(k, 2)).join('・')}`
      : '',
  );
  txt('#o-Ln', r.s > 3 * r.w ? '間隔が幅の 3 倍を超えるため、誤差が理論値の最大 8 % より大きくなることがあります' : '');
  html('#o-Lmw', ro(r.Lmw, 'H'));
  txt('#o-Lmws', shape.K ? diff(r.Lmw) : '円形の係数は論文にありません');
  html('#o-Lmn', ro(r.Lmn, 'H'));
  txt('#o-Lmns', shape.m ? diff(r.Lmn) : '円形の係数は論文にありません');
  html('#o-din', `${sig(r.din * 1e3, 4)}<span class="u">mm</span>`);
  html('#o-rho', r.rho.toFixed(3));
  html('#o-len', ro(r.len, 'm'));
  const lr = r.len / (C0 / r.f);
  txt(
    '#o-lens',
    (r.nl > 1 && r.conn === 'ser' ? `1 層 ${fmt(r.len1, 'm', 4)} × ${r.nl}・` : '') +
      `波長の ${lr >= 0.1 ? sig(lr, 2) : `1/${Math.round(1 / lr)}`}`,
  );
  txt('#o-lenn', lr > 0.1 ? '波長の 1/10 を超えるため、集中定数としての計算値は不確定です' : '');
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
  showSrf(r);
  txt('#mL', fmt(r.L, 'H', 4));
  txt('#mQ', sig(r.q, 3));
  txt('#mC', fmtF(r.c, 3));
  drawFig(r, v.w, v.s);
  draw3d();
  /* 探す条件のうち基板と周波数の設定が変わったときだけ探し直す */
  const fk = `${v.f}|${v.t}|${stack.v}|${conn}`;
  if (fk !== findKey) {
    findKey = fk;
    findLater();
  }
  drawFr(r);
  html('#subst', substHtml(r, shape, v.w, v.s));
}

/** 自己共振（層の間の容量）。1 層と並列では層の間に電位差がないため出さない */
function showSrf(r: Stacked): void {
  const fin = Number.isFinite(r.srf);
  html('#o-srf', fin ? ro(r.srf, 'Hz', 3) : '—');
  txt(
    '#o-srfs',
    r.nl <= 1
      ? '1 層では層の間の容量がありません'
      : r.conn === 'par'
        ? '並列では層の間に電位差がありません'
        : `層の間の容量 ${fmtF(r.cp, 3)}（重なった配線の平行平板・縁は含めない）`,
  );
  txt(
    '#o-srfn',
    !fin
      ? ''
      : r.f >= r.srf
        ? '周波数が自己共振を超えているため、コイルとして働きません'
        : r.f > r.srf / 3
          ? '自己共振に近いため、実際の L と Q はこの値から外れます'
          : '',
  );
}

/* ---------- 3D（斜めから見た図）: ドラッグで回し、ホイールかピンチで拡大縮小する ---------- */
const AZ0 = -0.55,
  EL0 = 0.62;
let az = AZ0,
  el = EL0,
  zoom = 1;
function draw3d(): void {
  if (!S) return;
  const r = S,
    p = coil3d({ sh: shape, n: r.n, dout: r.d * 1e3, w: r.w * 1e3, s: r.s * 1e3, st: stack, conn, az, el, zoom });
  html('#c3d-g', p.svg);
  $('#c3d').setAttribute('aria-label', p.label);
}
{
  const svg = $<SVGSVGElement>('#c3d'),
    ptr = new Map<number, { x: number; y: number }>();
  let raf = 0,
    pinch = 0;
  const later = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      draw3d();
    });
  };
  const setZoom = (z: number) => {
    zoom = Math.min(8, Math.max(0.4, z));
    later();
  };
  const span = () => {
    const [a, b] = [...ptr.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  svg.addEventListener('pointerdown', (e) => {
    ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    svg.setPointerCapture(e.pointerId);
    if (ptr.size === 2) pinch = span();
  });
  svg.addEventListener('pointermove', (e) => {
    const p = ptr.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x,
      dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (ptr.size === 2) {
      const d = span();
      if (pinch > 0) setZoom(zoom * (d / pinch));
      pinch = d;
      return;
    }
    /* 横で方位、縦で仰角（真下から真上まで。裏面も見られる） */
    az += dx * 0.01;
    el = Math.min(Math.PI / 2, Math.max(-Math.PI / 2, el + dy * 0.01));
    later();
  });
  for (const n of ['pointerup', 'pointercancel'] as const)
    svg.addEventListener(n, (e) => {
      ptr.delete(e.pointerId);
      pinch = 0;
    });
  svg.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      setZoom(zoom * Math.exp(-e.deltaY * 0.0015));
    },
    { passive: false },
  );
  $('#c3home').addEventListener('click', () => {
    az = AZ0;
    el = EL0;
    zoom = 1;
    draw3d();
  });
  const cur = $('#c3cur');
  cur.addEventListener('click', () => {
    const on = cur.getAttribute('aria-pressed') !== 'true';
    cur.setAttribute('aria-pressed', String(on));
    $('#c3w').classList.toggle('nocur', !on);
  });
}
new Choice($('#fview'), (v) => {
  $('#v3d').hidden = v !== '3d';
  $('#vtop').hidden = v !== 'top';
});

/* ---------- コイルの形 ---------- */
function drawFig(r: Stacked, w: number, s: number): void {
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
  txt('#fg-l', r.nl > 1 ? `${r.nl} ${r.conn === 'ser' ? 'SERIES' : 'PARALLEL'}` : '1');
  $('#fg-svg').setAttribute('aria-label', p.label);
}

/* ---------- 周波数特性 ---------- */
/** カーソルの x（表示窓の外なら null） */
let frX: number | null = null;
function drawFr(r: Stacked): void {
  const p = frPlot(r);
  $('#fr-t1').setAttribute('d', p.q);
  $('#fr-t1o').setAttribute('d', p.qOver);
  $('#fr-t2').setAttribute('d', p.r);
  $('#fr-t2o').setAttribute('d', p.rOver);
  $('#fr-lm').setAttribute('d', p.lambda);
  $('#fr-sr').setAttribute('d', p.srf);
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
  setShape(v);
  compute(G.values());
});
function setShape(v: string): void {
  shape = shapeOf(v);
  shape$.set(shape.v);
  G.update('dout', { sub: doutSub(shape) });
}

/* ---------- 層: 層数（枠の右上）、基板の構成、接続 ---------- */
const stack$ = new Choice($('#p-stack'), (v) => {
  stack = stackOf(v);
  syncLayers();
  compute(G.values());
});
const conn$ = new Choice<Conn>($('#p-conn'), (v) => {
  conn = v;
  compute(G.values());
});
new Choice($('#p-nl'), (v) => {
  stack = stackFor(Number(v));
  syncLayers();
  compute(G.values());
});
/** 層数に合う構成だけを出し、1 層では構成と接続の行を隠す */
function syncLayers(): void {
  const n = stack.n;
  for (const b of $$<HTMLElement>('#p-stack .chip')) b.hidden = stackOf(b.dataset.v ?? '').n !== n;
  for (const r of $$('.prow.multi')) r.hidden = n <= 1;
  stack$.set(stack.v);
  stack$.note(n > 1 ? `層の間 ${gapsText(stack)}` : '');
  conn$.set(conn);
}
syncLayers();

/* ---------- 条件から探す: 基板と周波数の設定のまま、形・巻数・配線の幅を探す ---------- */
const fl = $('#fl');
let found: Cand[] = [],
  findT: ReturnType<typeof setTimeout> | undefined,
  findStale = true;
const FG = new ParamGroup<FKey>(FIND_PARAMS, () => findLater());
const findBox = $<HTMLDetailsElement>('.a-find');
/** 入力が落ち着いてから探す（探すのに 0.1〜0.3 秒かかる）。枠を閉じている間は探さず、開いたときに探す */
function findLater(): void {
  if (!findOn) return;
  clearTimeout(findT);
  if (!findBox.open) {
    findStale = true;
    return;
  }
  findStale = false;
  const f = G.get('f');
  txt(
    '#find-note',
    `基板と周波数の設定（${stack.n > 1 ? `${stack.n} 層・${stack.ab}・${conn === 'ser' ? '直列' : '並列'}` : '片面の 1 層'}、銅箔 ${sig(G.get('t'), 3)} µm、${fmt(f, 'Hz', 4)} で共振）のまま、外径を取れる大きさいっぱいにして、形・巻数・配線の幅を探します。1 V で駆動したとき 1 m 先に作る磁界の強い順に並べます。`,
  );
  fl.classList.add('busy');
  findT = setTimeout(find, 350);
}
function find(): void {
  const v = FG.values();
  found = search({
    f: G.get('f'),
    st: stack,
    conn,
    t: G.get('t'),
    dmax: v.dmax,
    wmin: v.wmin,
    smin: v.smin,
    band: v.band,
    rmin: v.rmin,
    rmax: v.rmax,
  });
  fl.classList.remove('busy');
  const head =
    '<div class="fr fr-h" aria-hidden="true"><span class="c1">形・寸法</span><span>L</span><span>抵抗</span><span>共振コンデンサ</span><span>Q（足した抵抗込み）</span><span>1 m 先の磁界</span></div>';
  fl.innerHTML = found.length
    ? head +
      found
        .map((c, i) => {
          const g = c.g,
            lay = g.nl > 1 ? ` × ${g.nl} 層` : '';
          return (
            `<button type="button" class="fr${i ? '' : ' best'}" data-i="${i}" title="押すと入力に反映する">` +
            `<span class="c1"><b>${esc(c.sh.ab)} ${sig(c.dout, 4)} mm</b><small>${c.n} 巻${lay}・幅 ${sig(c.w, 3)}・間隔 ${sig(c.s, 3)} mm</small></span>` +
            `<span data-l="L"><b>${esc(fmt(g.L, 'H', 3))}</b></span>` +
            `<span data-l="抵抗"><b>${esc(fmt(c.rTot, 'Ω', 3))}</b><small>${c.rAdd > 0.05 ? `コイル ${esc(fmt(g.rac, 'Ω', 3))} + ${esc(fmt(c.rAdd, 'Ω', 2))}` : 'コイルだけ'}</small></span>` +
            `<span data-l="共振コンデンサ"><b>${esc(fmtF(c.ce, 2))}</b><small>E24・${esc(fmt(c.fe, 'Hz', 3))}</small></span>` +
            `<span data-l="Q（足した抵抗込み）"><b>${sig(c.q, 3)}</b>${Number.isNaN(c.edge) ? '' : `<small>両端 ${sig(c.edge, 2).replace('-', '−')} dB</small>`}</span>` +
            `<span data-l="1 m 先の磁界"><b>${esc(fmt(c.h1, 'A/m', 3))}</b><small>1 V あたり</small></span>` +
            '</button>'
          );
        })
        .join('')
    : '<p class="empty-c">条件を満たすコイルがありません。取れる大きさか抵抗の範囲を広げてください。</p>';
}
/** 候補を入力に反映する: 形、外径 → 幅・間隔（上限が外径で決まる）→ 巻数の順に入れる */
fl.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-i]'),
    c = b ? found[Number(b.dataset.i)] : undefined;
  if (!c) return;
  setShape(c.sh.v);
  G.set('dout', c.dout);
  G.set('w', c.w);
  G.set('s', c.s);
  G.set('n', c.n);
  $('#hd-dim').scrollIntoView({ behavior: RM.matches ? 'auto' : 'smooth', block: 'start' });
});
findBox.addEventListener('toggle', () => {
  if (findBox.open && findStale) findLater();
});
findOn = true;
findLater();
