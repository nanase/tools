/**
 * 時間と周波数の平面の枠: 同じ信号の STFT と DWT の箱を左右に並べ、係数の大きさで塗る。
 * 箱に触れる（押して選ぶ・矢印キー）と、その箱の波形を上の信号に重ね、もう一方の平面に同じ所を点線で出す
 */
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import type { Wav } from './dwt';
import { el, fx, lutOf, maxAbs, rgb, svgPt, trace, txt } from './fig';
import { atom, dwtTiles, planeDwt, stftTiles, type Tile, tileName } from './plane';
import { type Sig, sample } from './signals';

/** 標本の数（区間 1 s、標本化周波数 256 Hz） */
const N = 256,
  FS = N,
  /** 描く範囲（SVG の単位） */
  W = 400,
  H = 240,
  /** 対数の軸のオクターブの数（下端 0.5 Hz） */
  OCT = 9,
  /** 色の範囲 dB（最も大きい箱から） */
  RANGE = 36;

type Side = 0 | 1;
interface Sel {
  side: Side;
  /** 箱の中心（時間 0〜1、周波数 0〜1） */
  t: number;
  f: number;
}

export function initPlane(onBox: (s: string) => void): void {
  const S = { sig: 'click' as Sig, L: 32, w: 'haar' as Wav, log: false };
  let x = sample(S.sig, N),
    tiles: [Tile[], Tile[]] = [[], []],
    c = planeDwt(x, S.w),
    sel: Sel | null = null,
    hover: Sel | null = null;
  const lut = lutOf('.a-pl'),
    cvs = [0, 1].map((i) => $<HTMLCanvasElement>(`#pl-c${i}`)),
    ovs = [0, 1].map((i) => $<SVGSVGElement>(`#pl-s${i}`)),
    xs = [0, 1].map((i) => $<SVGSVGElement>(`#pl-x${i}`));

  /** 周波数（ナイキストで 1）→ 縦の位置 0〜1 と、その逆 */
  const fy = (f: number) => (S.log ? Math.max(0, 1 + Math.log2(Math.max(f, 2 ** -OCT)) / OCT) : f);
  const yf = (v: number) => (S.log ? 2 ** ((v - 1) * OCT) : v);
  const find = (side: Side, t: number, f: number) => {
    const v = fy(f);
    return tiles[side].find((b) => t >= b.t0 && t < b.t1 && v >= fy(b.f0) && v < fy(b.f1)) ?? null;
  };

  function compute(): void {
    x = sample(S.sig, N);
    c = planeDwt(x, S.w);
    tiles = [stftTiles(x, S.L), dwtTiles(c)];
    if (!sel) {
      /* 初めは DWT の詳細のうち最も大きい箱 */
      const b = tiles[1].filter((t) => t.j <= c.d.length).reduce((m, t) => (t.v > m.v ? t : m));
      sel = { side: 1, t: (b.t0 + b.t1) / 2, f: (b.f0 + b.f1) / 2 };
    }
    paintAll();
  }

  /** 箱を塗る（信号・窓・ウェーブレット・軸が変わったとき） */
  function paintAll(): void {
    tiles.forEach((T, i) => {
      const cv = cvs[i],
        ctx = cv.getContext('2d');
      if (!ctx) return;
      const cw = cv.width,
        ch = cv.height,
        mx = T.reduce((m, t) => Math.max(m, t.v), 1e-12);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cw, ch);
      ctx.strokeStyle = 'rgba(255,255,255,.25)';
      ctx.lineWidth = 1;
      for (const t of T) {
        const xa = Math.round(t.t0 * cw),
          xb = Math.round(t.t1 * cw),
          ya = Math.round(ch - fy(t.f1) * ch),
          yb = Math.round(ch - fy(t.f0) * ch);
        if (yb <= ya) continue;
        ctx.fillStyle = rgb(lut, (20 * Math.log10(t.v / mx + 1e-9) + RANGE) / RANGE);
        ctx.fillRect(xa, ya, xb - xa, yb - ya);
        if (xb - xa > 2 && yb - ya > 2) ctx.strokeRect(xa + 0.5, ya + 0.5, xb - xa - 1, yb - ya - 1);
      }
    });
    axes();
    overlay();
  }

  function axes(): void {
    const ticks = S.log ? [1, 2, 4, 8, 16, 32, 64, 128] : [0, 32, 64, 96, 128];
    for (const ov of ovs) {
      const g = el('g', { class: 'ax' });
      for (const f of ticks) {
        const y = H - fy(f / (FS / 2)) * H;
        g.append(el('text', { x: -6, y: y + 4, 'text-anchor': 'end' }, f === 128 ? '128 Hz' : String(f)));
      }
      for (const t of [0, 0.25, 0.5, 0.75, 1])
        g.append(
          el(
            'text',
            { x: t * W, y: H + 16, 'text-anchor': t === 0 ? 'start' : t === 1 ? 'end' : 'middle' },
            t === 1 ? '1 s' : String(t),
          ),
        );
      g.append(el('rect', { class: 'gb', x: 0, y: 0, width: W, height: H }));
      ov.querySelector('g.ax')?.remove();
      ov.prepend(g);
    }
  }

  /** 選んだ箱の枠と波形（触れている間はその箱） */
  function overlay(): void {
    const s = hover ?? sel,
      b = s ? find(s.side, s.t, s.f) : null;
    [0, 1].forEach((i) => {
      const ov = ovs[i];
      ov.querySelector('g.sel')?.remove();
      const g = el('g', { class: 'sel' });
      if (b && s) {
        const xa = b.t0 * W,
          ya = H - fy(b.f1) * H;
        g.append(
          el('rect', {
            class: `bx${i === s.side ? '' : ' o'}`,
            x: xa,
            y: ya,
            width: (b.t1 - b.t0) * W,
            height: (fy(b.f1) - fy(b.f0)) * H,
          }),
        );
      }
      ov.append(g);
      /* 信号と波形 */
      const sv = xs[i],
        k = 22 / maxAbs(x);
      sv.replaceChildren(el('line', { class: 'gl', x1: 0, y1: 26, x2: W, y2: 26 }));
      if (b && s)
        sv.append(
          el('rect', {
            class: `span${i === s.side ? '' : ' o'}`,
            x: b.t0 * W,
            y: 0,
            width: (b.t1 - b.t0) * W,
            height: 52,
          }),
        );
      sv.append(el('path', { class: 't2', d: trace(x, 0, W, 26, k), 'stroke-width': 1.3 }));
      if (b && s && i === s.side) {
        const a = atom(b, N, s.side === 0 ? { L: S.L } : { c });
        sv.append(el('path', { class: 't1', d: trace(a, 0, W, 26, 22 / maxAbs(a)), 'stroke-width': 1.6 }));
      }
      sv.append(el('text', { x: -6, y: 30, 'text-anchor': 'end' }, 'x'));
    });
    if (!b || !s) {
      txt('#pl-rd', '');
      onBox('—');
      return;
    }
    const J = c.d.length,
      nm = s.side ? `DWT ${tileName(b, J)}` : 'STFT',
      f0 = (b.f0 * FS) / 2,
      f1 = (b.f1 * FS) / 2,
      fd = f1 < 10 ? 2 : 1;
    txt('#pl-rd', `${nm}  t ${fx(b.t0, 3)}〜${fx(b.t1, 3)} s  f ${fx(f0, fd)}〜${fx(f1, fd)} Hz  |c| ${fx(b.v, 3)}`);
    onBox(`${s.side ? tileName(b, J) : 'STFT'} ${Number(f0.toPrecision(3))}〜${Number(f1.toPrecision(3))} Hz`);
  }

  /* 触れる・押して選ぶ・矢印キー */
  ovs.forEach((ov, i) => {
    const at = (e: PointerEvent): Sel | null => {
      const p = svgPt(ov, e);
      if (!p || p[0] < 0 || p[0] >= W || p[1] < 0 || p[1] >= H) return null;
      const b = find(i as Side, p[0] / W, yf(1 - p[1] / H));
      return b ? { side: i as Side, t: (b.t0 + b.t1) / 2, f: (b.f0 + b.f1) / 2 } : null;
    };
    ov.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      hover = at(e);
      overlay();
    });
    ov.addEventListener('pointerleave', () => {
      hover = null;
      overlay();
    });
    ov.addEventListener('pointerdown', (e) => {
      const s = at(e);
      if (!s) return;
      sel = s;
      hover = null;
      overlay();
    });
    ov.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
      if (!d) return;
      e.preventDefault();
      const s: Sel = sel && sel.side === i ? sel : { side: i as Side, t: 0.5, f: 0.5 },
        b = find(s.side, s.t, s.f);
      if (!b) return;
      const t = s.t + d[0] * (b.t1 - b.t0),
        v = fy(s.f) + d[1] * (fy(b.f1) - fy(b.f0)),
        nb = t > 0 && t < 1 && v > 0 && v < 1 ? find(s.side, t, yf(v)) : null;
      if (!nb) return;
      sel = { side: s.side, t: (nb.t0 + nb.t1) / 2, f: (nb.f0 + nb.f1) / 2 };
      overlay();
    });
  });

  new Choice<Sig>($('#pl-sig'), (v) => {
    S.sig = v;
    compute();
  });
  new Choice<string>($('#pl-n'), (v) => {
    S.L = Number(v);
    compute();
  });
  new Choice<Wav>($('#pl-w'), (v) => {
    S.w = v;
    compute();
  });
  new Choice<string>($('#pl-ax'), (v) => {
    S.log = v === 'log';
    paintAll();
  });
  compute();
}
