/**
 * ギター音響モデルのページの入口: 弦・弾き方・胴・部屋の入力 → 弦と胴の模型 → 指板の図・計算結果・胴の応答・音の波形・音。
 * 弦を押すと、そのフレットを押さえて弾く。曲の演奏は先の音を少しずつ AudioWorklet へ予約する
 */
import { Choice } from '../../lib/choice';
import { $, $$, esc } from '../../lib/dom';
import { fmt, fmtR, minus, plain, ro } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { autoPause, lookahead } from '../../lib/pause';
import { movePlayStore, outVol, type PlayKey, TEMPO } from '../../lib/play';
import { acoustics, reverbSpec, roomOf } from '../../lib/reverb';
import { SW } from '../../lib/scope';
import { store, stored } from '../../lib/store';
import { TempoMap } from '../../lib/tempo';
import { initToolPage } from '../../lib/tool-page';
import { evenLine, type Line, Transport } from '../../lib/transport';
import { spectra, toDb } from '../spectrum/fft';
import { GuitarAudio } from './audio';
import { admittance, type BodySpec, bodyTypeOf, C, cabs, makeBody, pressure, rng } from './body';
import {
  CHORD_CODES,
  chordName,
  guessChord,
  NEXT_CODES,
  NEXT_KEYS,
  type Next,
  nextChords,
  QUALITIES,
  type Quality,
  qualityOf,
  ROOT_CODES,
  shapeText,
  type Voicing,
  voicings,
} from './chords';
import { type BodyDesc, bodyDesc, type PluckMsg, type VibSpec } from './engine';
import {
  bendRatio,
  type Guitar,
  type Modes,
  modesOf,
  type PluckSpec,
  pluckOf,
  t60,
  toolOf,
  tuneCoupled,
} from './model';
import { Neck } from './neck';
import { slideNoise } from './noise';
import {
  AMP,
  ANGLE,
  DIA,
  DIST,
  HOLE,
  POS,
  SCALE,
  SLANT,
  type StrKey,
  TEN,
  THICK,
  VIB_HZ,
  VIB_W,
  VOL0,
  VOLUME,
} from './params';
import { BH, bodyPlot, fAtX, OH, specPlot, wavePlot, Y1_TOP, Y2_TOP } from './plot';
import { accents, dynamics, finger, PIECES, type Piece, type PieceData, parts, pieceOf } from './score';
import {
  betaOf,
  f1Of,
  fretX,
  MATERIALS,
  matOf,
  noteHz,
  noteName,
  type StringSpec,
  setOf,
  stringPhys,
  tensionFor,
  tuningOf,
} from './strings';
import type { Job, Reply } from './worker';
import { renderPluck } from './worker';

initToolPage();

const txt = (id: string, s: string) => {
  const el = $(id);
  if (el.textContent !== s) el.textContent = s;
};
const html = (id: string, s: string) => {
  const el = $(id);
  if (el.innerHTML !== s) el.innerHTML = s;
};

/* ---------- 状態 ---------- */
type SetV = 'nylon' | 'steel';
const isSet = (v: unknown): v is SetV => v === 'nylon' || v === 'steel';
const presetSpecs = (v: SetV): StringSpec[] => setOf(v).strings.map((s) => ({ ...s }));
/** 保存した弦の指定。形が合わなければ既定 */
function loadSpecs(): Record<SetV, StringSpec[]> {
  const sv = stored('str') as Partial<Record<SetV, StringSpec[]>> | undefined,
    ok = (a: unknown): a is StringSpec[] =>
      Array.isArray(a) &&
      a.length === 6 &&
      a.every(
        (s) =>
          s &&
          MATERIALS.some((m) => m.v === s.m) &&
          Number.isFinite(s.d) &&
          s.d >= DIA.min / 1000 &&
          s.d <= DIA.max / 1000 &&
          Number.isFinite(s.T) &&
          s.T >= TEN.min &&
          s.T <= TEN.max,
      );
  return {
    nylon: ok(sv?.nylon) ? sv.nylon : presetSpecs('nylon'),
    steel: ok(sv?.steel) ? sv.steel : presetSpecs('steel'),
  };
}
const S = {
  set: (isSet(stored('set')) ? stored('set') : 'nylon') as SetV,
  body: (stored('body') === 'dread' ? 'dread' : 'classical') as 'classical' | 'dread',
  specs: loadSpecs(),
  /** 弦ごとの押さえているフレット */
  left: [0, 0, 0, 0, 0, 0],
  /** 弦ごとの、鳴らさない（コードの形で × の）弦か。右手で弾いても鳴らない */
  mute: [false, false, false, false, false, false],
  /** 計算結果に出す音（最後に弾いた音） */
  last: { si: 5, fret: 0 },
};
const specs = () => S.specs[S.set];

const choice = <V extends string>(k: string, fn: (v: V) => void) => new Choice<V>($(`#p-${k}`), fn);
/* 設定する弦と材質は弦の指定（弦ごとの値）に従うので、選択肢としては保存しない */
$('#p-mat').setAttribute('data-nosave', '');
$('#p-sel').setAttribute('data-nosave', '');
const setCh = new Choice<SetV>($('#p-set'), (v) => changeSet(v));
setCh.set(S.set);
const bodyCh = new Choice<'classical' | 'dread'>($('#p-body'), (v) => changeBody(v));
bodyCh.set(S.body);
const tun = choice<string>('tun', () => {
  retune();
  rebuild();
  chordRetune();
});
const tm = choice<'auto' | 'man'>('tm', () => {
  retune();
  rebuild();
});
const sel = choice<string>('sel', () => syncStrRows());
const mat = choice<string>('mat', (v) => {
  specs()[selI()].m = v;
  retune(selI());
  rebuild();
});
const wood = choice<string>('wood', () => rebuild());
const tool = choice<string>('tool', () => renderOut());
const nz = choice<string>('nz', () => {});
/* 曲のビブラート（まだ予約していない音から効く） */
const vib = choice<string>('vib', () => {});
const room = choice<string>('room', () => roomView());
const nv = choice<'blur' | 'slow'>('nv', (v) => {
  neck.setMode(v);
  neckBar();
});
const ex = choice<string>('ex', (v) => {
  neck.setExag(Number(v));
  neckBar();
});
const sl = choice<string>('sl', (v) => {
  neck.setSlow(Number(v));
  neckBar();
});
/* 曲（ドロップダウン）。選んだ曲は保存する */
const piece = $<HTMLSelectElement>('#piece');
{
  const v = stored('c:p-piece');
  if (typeof v === 'string' && PIECES.some((p) => p.v === v)) piece.value = v;
}
piece.addEventListener('change', () => {
  store('c:p-piece', piece.value);
  if (P) stopPiece();
  void showLine();
});
const span = choice<string>('span', () => drawOut());
const fmax = choice<string>('fmax', () => drawOut());
const ov = choice<'yt' | 'sp'>('ov', () => showOut());
const selI = () => Number(sel.value);

/** 数値の入力（保存する） */
const V = {
  pos: POS.v,
  slant: SLANT.v,
  amp: AMP.v,
  ang: ANGLE.v,
  L: SCALE.v,
  h: THICK.v,
  V: VOLUME.v,
  dh: HOLE.v,
  dist: DIST.v,
  /** テンポ（曲の標準に対する %） */
  tempo: 100,
};
const audio = new GuitarAudio();
const nowS = () => performance.now() / 1000;

/* ---------- 指板 ---------- */
const neck = new Neck($<SVGSVGElement>('#neck'), {
  onPluck: (si, fret, gain) => void pluck(si, fret, gain),
  onBend: (si, fret, delta, u) => {
    const r = bendRatio(G.str[si], G.L, fret, delta, u);
    audio.bend(si, r);
    return 1200 * Math.log2(r);
  },
  /* 弾く位置を図の上で動かす（数値の行と同じく保存する） */
  onPos: (mm) => P1.set('pos', Math.round(Math.min(POS.max, Math.max(POS.min, mm)))),
  now: nowS,
});
neck.setMode(nv.value);
neck.setExag(Number(ex.value));
neck.setSlow(Number(sl.value));
function neckBar(): void {
  $('#sl-row').hidden = nv.value !== 'slow';
  txt('#nk-ex', `×${ex.value}`);
  txt('#nk-tm', nv.value === 'slow' ? `スロー 1/${sl.value}` : '実時間（残像）');
}

/* ---------- 模型 ---------- */
let G: Guitar,
  BD: BodyDesc,
  cache = new Map<string, Modes>(),
  cacheFs = 0;
function modes(si: number, fret: number): Modes {
  const fs = audio.fs;
  if (fs !== cacheFs) {
    cache = new Map();
    cacheFs = fs;
  }
  const k = `${si}:${fret}`;
  let m = cache.get(k);
  if (!m) {
    m = modesOf(G, si, fret, fs);
    cache.set(k, m);
  }
  return m;
}
/**
 * 弦 si の弾く位置（駒から） [m]。弾く位置は 3 弦と 4 弦の間の値で、傾き φ のぶん弦ごとにずらす。
 * 弦の間隔はナット 8.6 mm から駒 11.6 mm へ広がるとする
 */
function posOf(si: number): number {
  const p = V.pos / 1000,
    L = G?.L ?? 0.65,
    sp = (8.6 + 3 * (1 - p / L)) / 1000;
  return Math.min(0.9 * L, Math.max(0.005, p + (si - 2.5) * sp * Math.tan((V.slant * Math.PI) / 180)));
}
const posAll = () => [0, 1, 2, 3, 4, 5].map(posOf);
const pluckSpec = (si: number, amp = V.amp): PluckSpec => ({
  pos: posOf(si),
  amp: amp / 1000,
  width: toolOf(tool.value).w,
  rel: toolOf(tool.value).rel,
  angle: (V.ang * Math.PI) / 180,
});
const msgOf = (si: number, m: Modes, f: Float64Array, vib?: VibSpec): PluckMsg => ({
  si,
  N: m.N,
  w: m.w,
  s: m.s,
  f,
  vib,
});

/*
 * ステレオの定位（再生だけ。−1 が左、1 が右）。模型ではなく聞こえ方の目安で、図の向き（左がヘッド、右が駒）に合わせる。
 * 低い弦をわずかに左、高い弦を右に置き、弾く点が駒に近いほど右、ネックに寄るほど左へずらす。
 * 押さえるフレットが高いほど、振動する部分が駒の側へ寄るので少し右へ。胴のモードごとの広がりは engine.ts で付ける
 */
const strPan = (si: number) => (0.12 * (2.5 - si)) / 2.5;
function panOf(si: number, fret: number): number {
  const L = G.L;
  return strPan(si) + (1.2 * (0.13 - posOf(si))) / L + (0.25 * fretX(L, fret)) / L;
}
/** フレットノイズの定位: 左手のある、すべる区間の中ほど */
function slidePan(si: number, a: number, b: number): number {
  const L = G.L;
  return strPan(si) - 0.45 + (0.5 * (fretX(L, a) + fretX(L, b))) / 2 / L;
}

/** 調弦に合わせる間は、張力を音程の合う値にする（i を省くと全部） */
function retune(i?: number): void {
  if (tm.value !== 'auto') return;
  const L = V.L / 1000,
    notes = tuningOf(tun.value).notes;
  for (const k of i === undefined ? [0, 1, 2, 3, 4, 5] : [i]) {
    const sp = specs()[k],
      T = tensionFor(stringPhys(sp), L, noteHz(notes[k]));
    sp.T = Math.min(TEN.max, Math.max(TEN.min, T));
  }
}

function rebuild(): void {
  const set = setOf(S.set),
    spec: BodySpec = { type: S.body, wood: wood.value, h: V.h / 1000, V: V.V / 1000, dh: V.dh / 1000 };
  G = { L: V.L / 1000, frets: set.frets, str: specs().map(stringPhys), body: makeBody(spec) };
  /* 調弦に合わせる間は、胴との結合でずれる分も補う（チューナーで合わせるのと同じ） */
  if (tm.value === 'auto') {
    const notes = tuningOf(tun.value).notes;
    specs().forEach((sp, i) => {
      sp.T = Math.min(TEN.max, Math.max(TEN.min, tuneCoupled(G, i, noteHz(notes[i]))));
    });
    G.str = specs().map(stringPhys);
  }
  cache = new Map();
  BD = bodyDesc(G.body);
  audio.setBody(BD);
  neck.setGeo({
    L: G.L,
    frets: G.frets,
    dh: spec.dh,
    d: specs().map((s) => s.d),
    wound: specs().map((s) => matOf(s.m).wound),
    nylon: S.set === 'nylon',
  });
  if (S.last.fret > G.frets) S.last.fret = 0;
  store('str', S.specs);
  syncStrRows();
  table();
  results();
  bodyView();
  renderOut();
}

/* ---------- 入力 ---------- */
/* 演奏中に変えても止めない。まだ予約していない音から新しい弦と胴で鳴る */
function changeSet(v: SetV): void {
  S.set = v;
  store('set', v);
  /* 弦長は弦のセットの標準。胴もセットに合う形にする */
  P1.update('L', { v: setOf(v).L * 1000 });
  P1.set('L', setOf(v).L * 1000, { silent: true });
  V.L = setOf(v).L * 1000;
  const b = v === 'nylon' ? 'classical' : 'dread';
  bodyCh.set(b);
  applyBody(b);
  retune();
  rebuild();
  chordRetune();
}
function applyBody(b: 'classical' | 'dread'): void {
  S.body = b;
  store('body', b);
  const t = bodyTypeOf(b);
  V.h = t.h * 1000;
  V.V = t.V * 1000;
  V.dh = t.dh * 1000;
  for (const k of ['h', 'V', 'dh'] as const) {
    P1.update(k, { v: V[k] });
    P1.set(k, V[k], { silent: true });
  }
}
/** 既定値（行末の ↺ で戻す値）を弦のセットと胴の形に合わせる。弦長はセットの標準、表板の厚さ・容積・穴は胴の形の値 */
function bodyDefaults(): void {
  const t = bodyTypeOf(S.body);
  P1.update('L', { v: setOf(S.set).L * 1000 });
  P1.update('h', { v: t.h * 1000 });
  P1.update('V', { v: t.V * 1000 });
  P1.update('dh', { v: t.dh * 1000 });
}
function changeBody(b: 'classical' | 'dread'): void {
  applyBody(b);
  rebuild();
}

/**
 * 選んだ弦の材質・外径・張力の行を合わせる。既定値は、外径が弦のセットの値、張力が調弦に合う値
 * （調弦に合わせる間は今の値、手で決める間は胴との結合まで含めて合う値を求める）
 */
function syncStrRows(): void {
  const i = selI(),
    sp = specs()[i];
  mat.set(sp.m);
  P2.update('d', { v: Number((setOf(S.set).strings[i].d * 1000).toFixed(3)) });
  const Ta =
    tm.value === 'auto' || !G
      ? sp.T
      : Math.min(TEN.max, Math.max(TEN.min, tuneCoupled(G, i, noteHz(tuningOf(tun.value).notes[i]))));
  P2.update('T', { v: Number(Ta.toFixed(1)) });
  P2.set('d', Number((sp.d * 1000).toFixed(3)), { silent: true });
  P2.set('T', Number(sp.T.toFixed(1)), { silent: true });
  P2.note('T', tm.value === 'auto' ? `${tuningOf(tun.value).name}の調弦に合わせた値` : '');
}

const P1 = new ParamGroup<string>([POS, SLANT, AMP, ANGLE, SCALE, THICK, VOLUME, HOLE, DIST], (v, k) => {
  V.pos = v.pos;
  V.slant = v.slant;
  V.amp = v.amp;
  V.ang = v.ang;
  V.L = v.L;
  V.h = v.h;
  V.V = v.V;
  V.dh = v.dh;
  V.dist = v.dist;
  if (!G) return;
  if (k === 'pos' || k === 'slant') {
    neck.setPos(posAll());
    results();
    renderOut();
  } else if (k === 'amp' || k === 'ang') {
    results();
    renderOut();
  } else if (k === 'L') {
    retune();
    rebuild();
  } else if (k === 'h' || k === 'V' || k === 'dh') rebuild();
  else if (k === 'dist') roomView();
});
const P2 = new ParamGroup<StrKey>(
  [DIA, TEN],
  (v, k) => {
    if (!G || !k) return;
    const sp = specs()[selI()];
    if (k === 'd') {
      sp.d = v.d / 1000;
      retune(selI());
    } else {
      sp.T = v.T;
      if (tm.value === 'auto') {
        /* 張力を手で変えたら、手で決める方へ切り替える */
        tm.set('man');
        store('c:p-tm', 'man');
        retune();
      }
    }
    rebuild();
  },
  null,
  { save: false },
);

/* ---------- 弦の一覧 ---------- */
const cents = (f: number, n: number) => 1200 * Math.log2(f / noteHz(n));
const signed = (v: number, d = 1) => (v >= 0.05 ? '+' : v <= -0.05 ? '−' : '±') + Math.abs(v).toFixed(d);
function table(): void {
  const notes = tuningOf(tun.value).notes;
  let h = '';
  for (let i = 0; i < 6; i++) {
    const sp = specs()[i],
      /* 胴と結合したあとの第 1 部分音（垂直の偏波） */
      f = modes(i, 0).w[0] / (2 * Math.PI),
      c = cents(f, notes[i]);
    h += `<tr data-i="${i}" aria-selected="${i === selI()}"><td>${i + 1}</td><td>${noteName(notes[i])}</td><td>${esc(matOf(sp.m).name)}</td><td>${(sp.d * 1000).toFixed(3)}</td><td>${sp.T.toFixed(1)} N</td><td>${fmtR(f, 'Hz', 4)}</td><td class="${Math.abs(c) > 5 ? 'off' : ''}">${signed(c)}</td></tr>`;
  }
  html('#stab tbody', h);
}
$('#stab').addEventListener('click', (e) => {
  const tr = (e.target as Element).closest<HTMLElement>('tr[data-i]');
  if (!tr) return;
  sel.set(tr.dataset.i as string);
  syncStrRows();
  table();
});
sel.root.addEventListener('click', () => queueMicrotask(table));

/* ---------- 計算結果 ---------- */
const sci = (v: number) => {
  const e = Math.floor(Math.log10(Math.abs(v)));
  return `${(v / 10 ** e).toFixed(2)}<span class="u">× 10<sup>${minus(String(e))}</sup></span>`;
};
const mn = (s: string) => `<mn>${s}</mn>`;
/** 指数表記の数（3.80 × 10⁻⁴）の MathML */
const mexp = (v: number, d = 2) => {
  const e = Math.floor(Math.log10(Math.abs(v)));
  return `<mrow>${mn((v / 10 ** e).toFixed(d))}<mo>×</mo><msup><mn>10</mn><mn>${minus(String(e))}</mn></msup></mrow>`;
};
function results(): void {
  const { si, fret } = S.last,
    m = modes(si, fret),
    p = G.str[si],
    pl = pluckOf(G, si, m, pluckSpec(si)),
    N = m.N,
    f1 = m.w[0] / (2 * Math.PI),
    n0 = Math.round(69 + 12 * Math.log2(f1 / 440)),
    Lv = m.L,
    beta = betaOf(p, Lv),
    c = Math.sqrt(p.T / p.mu),
    tv = t60(m.s[0]),
    th = t60(m.s[N]),
    t0 = t60(m.s0[0]),
    eb = (m.s[0] - m.s0[0]) / m.s[0],
    ratio = Lv / posOf(si),
    k = Math.round(ratio);
  html('#o-f1', ro(f1, 'Hz', 5));
  txt(
    '#o-f1s',
    `${noteName(n0)} ${signed(cents(f1, n0))} セント（${si + 1} 弦・${fret ? `${fret} フレット` : '開放'}）`,
  );
  html('#o-lv', ro(Lv * 1000, 'mm', 4).replace('kmm', 'm'));
  html('#o-mu', `${(p.mu * 1000).toFixed(3)}<span class="u">g/m</span>`);
  html('#o-c', `${c.toFixed(1)}<span class="u">m/s</span>`);
  html('#o-z0', `${Math.sqrt(p.T * p.mu).toFixed(3)}<span class="u">N·s/m</span>`);
  html('#o-b', sci(beta));
  html(
    '#o-b10',
    `${signed(1200 * Math.log2(Math.sqrt(1 + 100 * beta) / Math.sqrt(1 + beta)), 2)}<span class="u">セント</span>`,
  );
  html('#o-tv', ro(tv, 's', 3));
  txt('#o-tvs', `弦だけなら ${fmtR(t0, 's', 3)}`);
  html('#o-th', ro(th, 's', 3));
  txt('#o-ths', '表板と平行に振れる偏波');
  html('#o-eb', `${(eb * 100).toFixed(1)}<span class="u">%</span>`);
  txt('#o-ebs', `第 1 部分音の損失のうち胴の分（η = ${plain((2 * m.s[0]) / m.w[0], 3, true)}）`);
  html('#o-xp', `1/${ratio.toFixed(2)}`);
  txt('#o-xps', ratio > 1.5 && Math.abs(ratio - k) < 0.15 ? `${k} の倍数の部分音が弱い` : '');
  html('#o-f0', ro(Math.hypot(pl.f0[0], pl.f0[1]), 'N', 3));
  html('#mF', fmtR(f1, 'Hz', 5));
  txt('#mT', fmtR(tv, 's', 3));
  txt('#mB', plain(beta, 3, true));
  txt('#nk-note', `${si + 1} 弦 ${fret ? `${fret} フレット` : '開放'}  ${noteName(n0)}  ${fmtR(f1, 'Hz', 4)}`);
  /* 代入した式 */
  const eta = (2 * m.s0[0]) / m.w[0];
  let h = `<math display="block"><msub><mi>f</mi><mn>1</mn></msub><mo>=</mo><mfrac><mn>1</mn><mrow><mn>2</mn><mo>×</mo>${mn(Lv.toFixed(4))}</mrow></mfrac><msqrt><mfrac>${mn(p.T.toFixed(1))}${mexp(p.mu, 3)}</mfrac></msqrt><msqrt><mrow><mn>1</mn><mo>+</mo>${mexp(beta, 2)}</mrow></msqrt><mo>=</mo>${mn(f1Of(p, Lv).toFixed(2))}<mi mathvariant="normal">Hz</mi><mtext>（弦だけ。胴と結合して ${fmtR(f1, 'Hz', 5)}）</mtext></math>`;
  h += `<math display="block"><msub><mi>η</mi><mn>1</mn></msub><mo>=</mo>${mexp(eta, 2)}<mtext>（弦）</mtext><mo>+</mo>${mexp((2 * m.s[0]) / m.w[0] - eta, 2)}<mtext>（胴）</mtext><mo>,</mo><mspace width="1em"/><msub><mi>T</mi><mn>60</mn></msub><mo>=</mo><mfrac><mrow><mn>2</mn><mi>ln</mi><mo>⁡</mo><mn>1000</mn></mrow><mrow><msub><mi>η</mi><mn>1</mn></msub><msub><mi>ω</mi><mn>1</mn></msub></mrow></mfrac><mo>=</mo>${mn(tv.toFixed(2))}<mi mathvariant="normal">s</mi></math>`;
  html('#subst', h);
}

/* ---------- 胴 ---------- */
let bodyPartials: number[] = [];
function bodyView(): void {
  const b = G.body;
  html('#b-fm', ro(b.fm, 'Hz', 4));
  html('#b-fh', ro(b.fh, 'Hz', 4));
  html('#b-fp', ro(b.fpl, 'Hz', 4));
  html('#b-f0', ro(b.fp0, 'Hz', 4));
  html('#b-mp', `${(b.mp * 1000).toFixed(1)}<span class="u">g</span>`);
  html('#b-df', ro(b.df, 'Hz', 3));
  const m = modes(S.last.si, S.last.fret);
  bodyPartials = Array.from(m.w.subarray(0, Math.min(m.N, 60)), (w) => w / (2 * Math.PI));
  const pl = bodyPlot(b, bodyPartials);
  $('#b-t1').setAttribute('d', pl.y);
  $('#b-t2').setAttribute('d', pl.p);
  html('#b-mk', pl.marks);
  html('#b-pt', pl.partials);
  html('#b-axes', pl.axes);
  $('#b-svg').setAttribute(
    'aria-label',
    `胴の応答。第 1 共振 ${fmt(b.fm, 'Hz', 4)}、ヘルムホルツ共振 ${fmt(b.fh, 'Hz', 4)}、第 2 共振 ${fmt(b.fpl, 'Hz', 4)}。横軸 50 Hz から 5 kHz の対数、CH1 は駒のアドミタンス（上端 ${Y1_TOP} dB）、CH2 は 1 m 先の音圧 ÷ 力（上端 +${Y2_TOP} dB）`,
  );
}
cursor($<SVGSVGElement>('#b-svg'), BH, (x) => {
  if (x === null) {
    $('#b-cur').setAttribute('d', '');
    txt('#b-rd', '');
    return;
  }
  const f = fAtX(x),
    y = cabs(admittance(G.body, C.cx(2 * Math.PI * f), 0)),
    p = cabs(pressure(G.body, f));
  $('#b-cur').setAttribute('d', `M${x.toFixed(1)} 0V${BH}`);
  txt(
    '#b-rd',
    `f ${fmtR(f, 'Hz', 4)}   CH1 ${minus((20 * Math.log10(y)).toFixed(1))} dB   CH2 ${minus((20 * Math.log10(p)).toFixed(1))} dB`,
  );
});

/** 表示窓のカーソル。fn には表示窓の x（外なら null）を渡す */
function cursor(svg: SVGSVGElement, h: number, fn: (x: number | null) => void): void {
  svg.addEventListener('pointermove', (e) => {
    const m = svg.getScreenCTM();
    if (!m) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    fn(p.x >= 0 && p.x <= SW && p.y >= 0 && p.y <= h ? p.x : null);
  });
  svg.addEventListener('pointerleave', () => fn(null));
}

/* ---------- 残響（部屋。再生の音だけに付ける） ---------- */
function roomView(): void {
  const r = roomOf(room.value),
    off = r.v === 'off',
    a = acoustics(r);
  html('#r-t', off ? '—' : ro(a.t60, 's', 3));
  html('#r-th', off ? '—' : ro(a.t60Hi, 's', 3));
  html('#r-rc', off ? '—' : ro(a.rc, 'm', 3));
  html('#r-dr', off ? '—' : `${minus((20 * Math.log10(V.dist / a.rc)).toFixed(1))}<span class="u">dB</span>`);
  audio.setRoom(reverbSpec(r, V.dist));
}

/* ---------- 音の波形（Web Worker で計算） ---------- */
const OUT_S = 2,
  NFFT = 65536;
let out: Float32Array | null = null,
  outFs = 48000,
  spec = new Float32Array(NFFT / 2 + 1),
  jobId = 0,
  worker: Worker | null = null,
  outTimer: ReturnType<typeof setTimeout> | undefined;
function mkWorker(): Worker | null {
  try {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<Reply>) => {
      if (e.data.id === jobId) gotOut(e.data.y);
    };
    return w;
  } catch {
    return null;
  }
}
/** 音の波形の枠（閉じている間は計算しない） */
const waveBox = $<HTMLDetailsElement>('details.a-wave');
let outDirty = true;
waveBox.addEventListener('toggle', () => {
  if (waveBox.open && outDirty) renderOut();
});
function renderOut(): void {
  clearTimeout(outTimer);
  if (!waveBox.open) {
    outDirty = true;
    return;
  }
  outDirty = false;
  outTimer = setTimeout(() => {
    const { si, fret } = S.last,
      m = modes(si, fret),
      pl = pluckOf(G, si, m, pluckSpec(si)),
      fs = audio.fs,
      j: Job = { id: ++jobId, body: BD, p: msgOf(si, m, pl.f), noise: null, fs, dur: OUT_S };
    outFs = fs;
    worker ??= mkWorker();
    if (worker) worker.postMessage(j);
    else gotOut(renderPluck(j));
  }, 60);
}
function gotOut(y: Float32Array): void {
  out = y;
  const px = new Float32Array(NFFT / 2 + 1);
  spectra(y.subarray(0, NFFT), y.subarray(0, NFFT), NFFT, 'bh', px, new Float32Array(NFFT / 2 + 1));
  spec = px;
  drawOut();
}
let outCur: number | null = null;
function drawOut(): void {
  if (!out) return;
  if (ov.value === 'yt') {
    const w = wavePlot(out, outFs, Number(span.value));
    $('#w-t1').setAttribute('d', w.d);
    html('#w-axes', w.axes);
    txt('#w-vd', `${plain(w.vd, 3)} Pa`);
    txt('#w-hd', fmt(w.hd, 's', 3));
    let pk = 0;
    for (const v of out) pk = Math.max(pk, Math.abs(v));
    txt('#w-st', `PEAK ${fmtR(pk, 'Pa', 3)}`);
    $('#w-svg').setAttribute(
      'aria-label',
      `1 m 先の音圧の波形。弾いてから ${fmt(Number(span.value), 's')} まで、ピーク ${fmt(pk, 'Pa', 3)}`,
    );
  } else {
    const fm = Number(fmax.value),
      s = specPlot(spec, outFs, NFFT, fm);
    $('#s-t1').setAttribute('d', s.d);
    html('#s-axes', s.axes);
    txt('#s-x', `0–${fmt(fm, 'Hz', 3)}`);
  }
  outCursor();
}
function showOut(): void {
  $('#v-yt').hidden = ov.value !== 'yt';
  $('#v-sp').hidden = ov.value !== 'sp';
  outCur = null;
  drawOut();
}
function outCursor(): void {
  const sp = ov.value === 'sp',
    id = sp ? 's' : 'w',
    x = outCur;
  $(`#${sp ? 'w' : 's'}-cur`).setAttribute('d', '');
  if (x === null || !out) {
    $(`#${id}-cur`).setAttribute('d', '');
    txt(`#${id}-rd`, '');
    return;
  }
  if (sp) {
    const fm = Number(fmax.value),
      km = Math.round((fm / outFs) * NFFT),
      c = Math.round((x / SW) * km);
    let b = c;
    for (let i = Math.max(1, c - 6); i <= Math.min(km, c + 6); i++) if (spec[i] > spec[b]) b = i;
    const f = (b / NFFT) * outFs,
      f1 = bodyPartials[0] ?? 0,
      h = f1 ? f / f1 : 0,
      xb = (b / km) * SW;
    $('#s-cur').setAttribute('d', `M${xb.toFixed(1)} 0V${OH}`);
    txt(
      '#s-rd',
      `f ${fmtR(f, 'Hz', 4)}${h > 0.5 ? `（${plain(h, 4, true)} 倍）` : ''}   CH1 ${minus(toDb(spec[b]).toFixed(1))} dB`,
    );
  } else {
    const n = Math.round(Number(span.value) * outFs),
      i = Math.min(out.length - 1, Math.round((x / SW) * n));
    $('#w-cur').setAttribute('d', `M${x.toFixed(1)} 0V${OH}`);
    txt('#w-rd', `t ${i ? fmtR(i / outFs, 's', 4) : '0'}   CH1 ${signedPa(out[i])}`);
  }
}
const signedPa = (v: number) => `${v >= 0 ? '+' : '−'}${fmtR(Math.abs(v), 'Pa', 4)}`;
for (const [id, h] of [
  ['#w-svg', OH],
  ['#s-svg', OH],
] as const)
  cursor($<SVGSVGElement>(id), h, (x) => {
    outCur = x;
    outCursor();
  });

/* ---------- 弾く ---------- */
const NO_SOUND = '音を出せませんでした';
const sndMsg = (s: string) => txt('#snd-msg', s);
const nzLevel = () => Number(nz.value);

/** 指が巻弦の上をすべる音（前に押さえていたフレット a から b へ）。巻弦でなければ弱い雑音 */
function slideOf(si: number, a: number, b: number, dur: number, seed: number): Float32Array | null {
  const lv = nzLevel();
  if (!lv || a === b || a === 0 || b === 0) return null;
  const p = G.str[si],
    cl = Math.sqrt((p.mat.Eax * Math.PI * p.dc * p.dc) / 4 / p.mu);
  return slideNoise(
    {
      wound: p.mat.wound,
      pw: Math.max(5e-5, p.pw),
      fL: cl / (2 * G.L),
      dist: Math.abs(fretX(G.L, b) - fretX(G.L, a)),
      dur,
      level: lv,
      seed,
    },
    audio.fs,
  );
}

let seedN = 1;
/**
 * 弦を弾く（曲の演奏中も、一時停止の間も弾ける）。
 * gain は弾く強さの倍率（弦をなでた速さから）
 */
async function pluck(si: number, fret: number | null, gain = 1): Promise<void> {
  /* コードの形で鳴らさない弦は、右手で弾いても鳴らない。押さえ直せば鳴る */
  if (fret === null && S.mute[si]) return;
  const f = fret ?? S.left[si],
    prev = S.left[si],
    held = neck.get(si);
  S.left[si] = f;
  if (fret !== null) {
    S.mute[si] = false;
    holdFret(si, f);
  }
  const ok = await audio.ready();
  sndMsg(ok ? '' : NO_SOUND);
  const m = modes(si, f),
    pl = pluckOf(G, si, m, pluckSpec(si, Math.min(AMP.max, Math.max(AMP.min, V.amp * gain)))),
    t = nowS();
  let delay = 0;
  /* 押さえたまま別のフレットへ動いたら、すべる音を先に鳴らす */
  if (held && held.damp === Infinity && held.fret > 0 && f > 0 && prev !== f) {
    const dur = Math.min(0.18, 0.05 + 0.012 * Math.abs(f - prev)),
      buf = slideOf(si, prev, f, dur, seedN++);
    if (buf) {
      audio.noise(si, buf, 0, slidePan(si, prev, f));
      delay = dur * 0.85;
    }
  }
  const an = audio.now();
  audio.pluck(msgOf(si, m, pl.f), delay && an !== null ? an + delay : 0, panOf(si, f));
  neck.set(si, { pl, t0: t + delay, damp: Infinity, fret: f, dir: (V.ang * Math.PI) / 180, xb: posOf(si) });
  txt('#nk-live', `${si + 1} 弦 ${f ? `${f} フレット` : '開放'}`);
  if (P) return;
  if (S.last.si !== si || S.last.fret !== f) {
    S.last = { si, fret: f };
    results();
    bodyView();
  }
  renderOut();
}

/* ---------- コード ---------- */
/** 押さえているコード: 根音・種類・押さえ方の候補と選んでいる番号（形は弦を押さえ直すと変わる） */
let CH: { root: number; q: Quality; list: Voicing[]; i: number; f: number[] } | null = null;
/** 最後に選んだ根音と種類（片方だけ選んだときに、もう片方に使う） */
const chLast = { root: 0, q: QUALITIES[0] };
const chdBox = $<HTMLDetailsElement>('details.a-chd'),
  chdSnd = $<HTMLButtonElement>('#chdSnd');
chdSnd.setAttribute('aria-pressed', String(stored('chdSnd') === true));
$('#chdLed').classList.toggle('on', stored('chdSnd') === true);
chdSnd.addEventListener('click', () => {
  const on = chdSnd.getAttribute('aria-pressed') !== 'true';
  chdSnd.setAttribute('aria-pressed', String(on));
  $('#chdLed').classList.toggle('on', on);
  store('chdSnd', on);
});

/** 次によく続くコードとして並べているもの（キー Z〜, の順） */
let NX: Next[] = [];
/** 曲の演奏中に、鳴っている音から推定したコード（押さえているコードがなく、3 本以上の弦が鳴っている間） */
let EST: { root: number; q: Quality } | null = null;
/** コードの枠の表示を、押さえているコード（なければ演奏から推定したコード）に合わせる */
function chordView(): void {
  const cur = CH ?? EST,
    /* 次によく続くコード: 根音の鍵は、その根音の最も重い種類の重みで色を付けて種類を添え、種類のボタンは同じ根音のままの重み */
    nx = cur ? nextChords(cur.root, cur.q) : [],
    byRoot = new Map<number, Next>();
  for (const x of nx) if (x.root !== cur?.root && !byRoot.has(x.root)) byRoot.set(x.root, x);
  for (const b of $$<HTMLElement>('.ck', $('#ckb'))) {
    const r = Number(b.dataset.v),
      x = byRoot.get(r),
      s = b.querySelector('.ck-s') as HTMLElement;
    b.setAttribute('aria-pressed', String(!!CH && r === CH.root));
    b.classList.toggle('est', !CH && !!EST && r === EST.root);
    b.style.setProperty('--w', x ? x.w.toFixed(2) : '0');
    if (s.textContent !== (x?.q.sfx ?? '')) s.textContent = x?.q.sfx ?? '';
  }
  for (const b of $$<HTMLElement>('.chip', $('#p-cq'))) {
    const x = nx.find((y) => y.root === cur?.root && y.q.v === b.dataset.v);
    b.setAttribute('aria-pressed', String(!!CH && b.dataset.v === CH.q.v));
    b.classList.toggle('est', !CH && !!EST && b.dataset.v === EST.q.v);
    b.style.setProperty('--w', x ? x.w.toFixed(2) : '0');
  }
  showNext(nx.slice(0, NEXT_KEYS.length));
  const n = CH?.list.length ?? 0,
    name = cur ? chordName(cur.root, cur.q) : '';
  $<HTMLButtonElement>('#cvPrev').disabled = !CH || CH.i <= 0;
  $<HTMLButtonElement>('#cvNext').disabled = !CH || CH.i >= n - 1;
  $<HTMLButtonElement>('#chdRel').disabled = !CH;
  txt('#cv-shape', CH && n ? shapeText(CH.f) : '—');
  txt(
    '#chd-name',
    CH
      ? n
        ? `${name}  ${CH.i + 1} / ${n}`
        : `${name}  押さえ方が見つかりません`
      : EST
        ? `${name}（演奏から推定）`
        : '',
  );
  const tag = $('#nk-chd');
  tag.hidden = !cur;
  txt('#nk-chd', CH && n ? `${name}  ${shapeText(CH.f)}` : EST && !CH ? `${name}（推定）` : name);
}

/** 次によく続くコードの行で、大きく出す候補の数（それより後は小さく） */
const NEXT_BIG = 3;
/**
 * 次によく続くコードを 1 行に並べる。行に入りきらない候補は外す（行の高さを変えない。キーは並んでいるものだけに効く）。
 * 枠を閉じている間は幅が測れないので、開いたときに並べ直す
 */
function showNext(list: Next[]): void {
  const row = $('#cnx');
  row.innerHTML = list.length
    ? list
        .map((x, i) => {
          const nm = chordName(x.root, x.q);
          return `<button type="button" class="chip${i >= NEXT_BIG ? ' sm' : ''}" data-i="${i}" style="--w:${x.w.toFixed(2)}" aria-label="${esc(nm)}（キー ${NEXT_KEYS[i]}）">${esc(nm)}<span class="ky">${NEXT_KEYS[i]}</span></button>`;
        })
        .join('')
    : '<span class="cnx-e">コードを押さえると出ます</span>';
  NX = list;
  if (!chdBox.open || !list.length) return;
  const right = row.getBoundingClientRect().right,
    kids = [...row.children] as HTMLElement[];
  let k = kids.findIndex((c) => c.getBoundingClientRect().right > right + 0.5);
  if (k < 0) return;
  k = Math.max(1, k);
  for (const c of kids.slice(k)) c.remove();
  NX = list.slice(0, k);
}
chdBox.addEventListener('toggle', () => chdBox.open && chordView());
{
  let rt: ReturnType<typeof setTimeout> | undefined;
  addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(chordView, 100);
  });
}

/** 推定に数える弦:弾いてから、第 1 部分音の振幅が初めの 1/10 より大きい間（指を離すまで） */
const EST_FLOOR = 0.1;
/** 曲の演奏中に、鳴っている弦の音からコードを推定して出す（変わったときだけ書き直す） */
function estimate(): void {
  let next: typeof EST = null;
  if (P && !CH) {
    const t = nowS(),
      notes = tuningOf(tun.value).notes,
      on: number[] = [];
    for (let si = 0; si < 6; si++) {
      const s = neck.get(si);
      if (!s || t < s.t0 || t >= s.damp) continue;
      const { a, modes: m } = s.pl,
        dt = t - s.t0,
        a0 = Math.hypot(a[0], a[m.N]),
        at = Math.hypot(a[0] * Math.exp(-m.s[0] * dt), a[m.N] * Math.exp(-m.s[m.N] * dt));
      if (a0 > 0 && at > EST_FLOOR * a0) on.push(notes[si] + s.fret);
    }
    if (on.length >= 3) next = guessChord(on);
  }
  if (next?.root === EST?.root && next?.q === EST?.q) return;
  EST = next;
  chordView();
}

/** 弦 si の指を、今の押さえ方から変えるなら離す（鳴っている音を止める） */
function lift(si: number, f: number, mute: boolean): void {
  const s = neck.get(si),
    t = nowS();
  if (s && s.damp > t && (mute || s.fret !== f)) {
    audio.damp(si, 0, 0, 0.06);
    neck.set(si, { ...s, damp: t });
  }
}

/** 押さえ方 i に変える（候補の範囲に丸める）。play なら、太い弦から順にかき鳴らす */
function useVoicing(i: number, play: boolean): void {
  if (!CH) return;
  const v = CH.list[Math.max(0, Math.min(CH.list.length - 1, i))];
  if (!v) {
    chordView();
    return;
  }
  CH.i = CH.list.indexOf(v);
  CH.f = v.f.slice();
  v.f.forEach((f, si) => {
    const mute = f < 0,
      nf = mute ? 0 : f;
    lift(si, nf, mute);
    S.left[si] = nf;
    S.mute[si] = mute;
  });
  neck.setHold({ f: CH.f, barre: v.barre });
  chordView();
  if (play) strumChord();
}

/** コード（根音 root、種類 q）を押さえる。いつもの押さえ方（最も良いもの）にする */
function setChord(root: number, q: Quality): void {
  chLast.root = root;
  chLast.q = q;
  const { list, best } = voicings(tuningOf(tun.value).notes, G.frets, root, q);
  CH = { root, q, list, i: best, f: [] };
  if (!list.length) {
    neck.setHold(null);
    chordView();
    return;
  }
  useVoicing(best, chdSnd.getAttribute('aria-pressed') === 'true');
}

/** 左手を弦から離して、コードの形をやめる（すべて開放弦にして、押さえていた弦の音を止める） */
function releaseChord(): void {
  if (!CH) return;
  CH = null;
  for (let si = 0; si < 6; si++) {
    lift(si, 0, S.mute[si]);
    S.left[si] = 0;
    S.mute[si] = false;
  }
  neck.setHold(null);
  chordView();
}

/** 弦 si をフレット f で押さえ直した（コードの形を変える） */
function holdFret(si: number, f: number): void {
  if (!CH || CH.f[si] === f) return;
  CH.f[si] = f;
  neck.setHold({ f: CH.f, barre: CH.list[CH.i]?.barre ?? false });
  chordView();
}

/** 調弦やフレットの数が変わったら、押さえているコードを求め直す（鳴らさない） */
function chordRetune(): void {
  if (!CH) return;
  const { list, best } = voicings(tuningOf(tun.value).notes, G.frets, CH.root, CH.q);
  CH.list = list;
  if (list.length) useVoicing(best, false);
  else releaseChord();
}

/** 押さえているコードを、太い弦から順にかき鳴らす（鳴らさない弦は飛ばす） */
const STRUM_MS = 14;
function strumChord(): void {
  let k = 0;
  for (let si = 5; si >= 0; si--) {
    if (S.mute[si]) continue;
    const s = si;
    setTimeout(() => void pluck(s, null, 1), STRUM_MS * k++);
  }
}

$('#ckb').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('.ck');
  if (b) setChord(Number(b.dataset.v), CH?.q ?? chLast.q);
});
$('#cnx').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('.chip');
  const x = b ? NX[Number(b.dataset.i)] : undefined;
  if (x) setChord(x.root, x.q);
});
$('#p-cq').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('.chip');
  if (b) setChord(CH?.root ?? chLast.root, qualityOf(b.dataset.v ?? ''));
});
$('#cvPrev').addEventListener(
  'click',
  () => CH && useVoicing(CH.i - 1, chdSnd.getAttribute('aria-pressed') === 'true'),
);
$('#cvNext').addEventListener(
  'click',
  () => CH && useVoicing(CH.i + 1, chdSnd.getAttribute('aria-pressed') === 'true'),
);
$('#chdRel').addEventListener('click', releaseChord);

/*
 * コードの枠を開いている間は、キーでコードを選ぶ（入力欄・指板の図で使うキーは除く）。
 * 押し続けたときの繰り返しは無視する（「コードを鳴らす」で何度も鳴らさない）
 */
document.addEventListener('keydown', (e) => {
  if (!chdBox.open || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.isComposing) return;
  const t = e.target as HTMLElement | null;
  if (t?.closest('input, select, textarea, [contenteditable]')) return;
  const play = chdSnd.getAttribute('aria-pressed') === 'true',
    r = ROOT_CODES.indexOf(e.code),
    qi = CHORD_CODES.indexOf(e.code as (typeof CHORD_CODES)[number]),
    ni = NEXT_CODES.indexOf(e.code as (typeof NEXT_CODES)[number]),
    nx = ni >= 0 ? NX[ni] : undefined,
    arrow = (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !!CH;
  if (r < 0 && qi < 0 && !nx && !arrow && !(e.key === 'Escape' && CH)) return;
  e.preventDefault();
  if (e.repeat) return;
  if (r >= 0) setChord(r, CH?.q ?? chLast.q);
  else if (qi >= 0) setChord(CH?.root ?? chLast.root, QUALITIES[qi]);
  else if (nx) setChord(nx.root, nx.q);
  else if (CH && e.key === 'ArrowUp') useVoicing(CH.i + 1, play);
  else if (CH && e.key === 'ArrowDown') useVoicing(CH.i - 1, play);
  else releaseChord();
});

/* テンポと音量（演奏中も効く） */
movePlayStore();
new ParamGroup<PlayKey>([TEMPO, outVol(VOL0)], (v, k) => {
  V.tempo = v.tempo;
  audio.vol(v.vol);
  /* 生成時の 1 回目（k なし）は、演奏の操作を作る前 */
  if (k) transport.refresh();
});
/* 曲のビブラートの幅と速さ（まだ予約していない音から効く） */
const PV = new ParamGroup<'vw' | 'vh'>([VIB_W, VIB_HZ], () => {});

/** 指板の図の、鳴っている弦を今止める（予定した撥弦はそのまま） */
function dampNeck(): void {
  const t = nowS();
  for (let si = 0; si < 6; si++) {
    const s = neck.get(si);
    if (s && s.damp > t) neck.set(si, { ...s, damp: t });
  }
}
/* リリース: 鳴っている弦をすべて止めるが、演奏は続ける */
$('#relBtn').addEventListener('click', () => {
  for (let si = 0; si < 6; si++) audio.damp(si, 0, 0, 0.06);
  dampNeck();
});
/* 消音: 鳴っている弦をすべて止める（手のひらで弦に触れる）。演奏は続け、止めたときに消えた先の予約は、今から先の出来事として予約し直す */
$('#muteBtn').addEventListener('click', () => {
  audio.stop(0.06);
  dampNeck();
  const p = P,
    an = audio.now();
  if (!p || an === null) return;
  while (p.i > 0 && atOf(p, p.ev[p.i - 1].b) + p.ev[p.i - 1].jit >= an) p.i--;
  p.until = an;
  neck.clearPending();
  tick();
});

/* ---------- 演奏 ---------- */
/**
 * 演奏の出来事。時刻は拍で持ち、予約するときに今のテンポで秒に直す（演奏中にテンポを変えられる）。
 * 拍は、曲の途中のテンポの変化を織り込んで、標準のテンポでの拍の長さに直したもの（TempoMap の τ）
 */
interface Ev {
  /** 曲の初めからの拍 */
  b: number;
  /** 時刻の揺らぎ [s] */
  jit: number;
  si: number;
  f: number;
  amp: number;
  /** 指を離す拍（開放弦・同じ弦をすぐ弾き直すときは null） */
  off: number | null;
  /** すべる音の、前のフレットと、前の音からの拍（その半分の時間ですべる） */
  slide: { from: number; gap: number } | null;
  /** 音の終わりの拍と、旋律（鳴り始めに最も高い音）か（ビブラートを掛ける音を選ぶ） */
  end: number;
  top: boolean;
  /** ビブラートの速さの揺らぎ（−1〜1） */
  vr: number;
}
interface Play {
  ev: Ev[];
  i: number;
  /** 拍と AudioContext の時刻の対応（テンポを変えたら、その時点で付け直す） */
  at0: number;
  b0: number;
  spb: number;
  /** 予約を済ませた先の AudioContext の時刻 */
  until: number;
  /** 最後の音の拍（τ）と、曲の終わりの拍（楽譜の拍。演奏の位置の表示の上限） */
  last: number;
  end: number;
  timer: ReturnType<typeof setInterval>;
  piece: Piece;
  /** 曲の途中のテンポの変化（小節の表示で、拍へ戻すのに使う） */
  tm: TempoMap;
}
let P: Play | null = null;
const fingerCache = new Map<string, PieceData>();
const spbOf = (pc: Piece) => 60 / (pc.bpm * (V.tempo / 100));
/** 拍 b（τ）の AudioContext の時刻 */
const atOf = (p: Play, b: number) => p.at0 + (b - p.b0) * p.spb;
/** 曲の音符と運指（読み込む曲は読み込み、ほかは運指を求める）と、テンポの変化 */
async function placedOf(pc: Piece): Promise<PieceData> {
  const open = tuningOf(pc.tuning).notes,
    key = `${pc.v}|${open.join(',')}|${G.frets}`;
  let pl = fingerCache.get(key);
  if (!pl) {
    pl = pc.load ? await pc.load() : { notes: finger(pc.notes, open, G.frets), tempo: [] };
    fingerCache.set(key, pl);
  }
  return pl;
}
function eventsOf(data: PieceData, pc: Piece, tmap: TempoMap): Ev[] {
  const r = rng(7),
    notes = data.notes.filter((x) => x.s >= 0).sort((a, b) => a.t - b.t || a.s - b.s),
    /* MIDI のベロシティがある曲はそれを、ない曲は拍子と声部から決めた強弱を、弾く強さに掛ける（強さの入力の範囲に収める） */
    dy = dynamics(notes) ?? accents(notes, pc.bar, pc.pickup),
    pt = parts(notes),
    last = Math.max(...notes.map((x) => x.t + x.d)),
    ev: Ev[] = [];
  let rollJit = 0;
  notes.forEach((x, i) => {
    const next = notes.slice(i + 1).find((y) => y.s === x.s),
      prev = [...notes.slice(0, i)].reverse().find((y) => y.s === x.s),
      end = x.t + x.d,
      /* 少し揺らす（時刻 ±6 ms、強さ ±6%）。低い弦は少し強く。
         少しずらして弾く和音（前の音から 0.1 拍未満）は、ずらし方を崩さないよう最初の音と同じだけ動かす */
      dt = i ? x.t - notes[i - 1].t : 1,
      rj = (r() - 0.5) * 0.012,
      jit = dt > 1e-6 && dt < 0.1 ? rollJit : rj,
      amp = Math.min(AMP.max, V.amp * dy[i] * (0.94 + 0.12 * r()) * (x.s >= 3 ? 1.1 : 1)),
      /* 最後の和音は響かせたままにする */
      off = x.f > 0 && end < last - 1e-6 && (!next || next.t > end + 1e-6) ? tmap.tau(end) : null;
    let slide: Ev['slide'] = null;
    if (prev && prev.f > 0 && x.f > 0 && prev.f !== x.f && x.t - (prev.t + prev.d) < 0.6 && r() < 0.7)
      slide = { from: prev.f, gap: tmap.tau(x.t) - tmap.tau(prev.t) };
    rollJit = jit;
    ev.push({
      b: tmap.tau(x.t),
      jit,
      si: x.s,
      f: x.f,
      amp,
      off,
      slide,
      end: tmap.tau(end),
      /* 鳴っている間にほかの音を弾かない旋律の音（左手が空く） */
      top: pt[i] === 'top' && !notes.some((y) => y.t > x.t + 0.1 && y.t < end - 1e-6),
      vr: 2 * r() - 1,
    });
  });
  return ev;
}
const endOf = (d: PieceData) => Math.max(...d.notes.map((n) => n.t + n.d));
const lineOf = (pc: Piece, d: PieceData): Line => {
  const tmap = new TempoMap(d.tempo);
  return evenLine({ bar: pc.bar, pickup: pc.pickup, end: endOf(d), sec: (b) => (tmap.tau(b) * 60) / pc.bpm });
};
/** 選んだ曲を読み込んで、演奏の位置の欄に小節を描く */
async function showLine(): Promise<void> {
  const pc = pieceOf(piece.value);
  transport.setLine(null);
  let pl: PieceData;
  try {
    pl = await placedOf(pc);
  } catch {
    sndMsg('曲を読み込めませんでした');
    return;
  }
  if (piece.value === pc.v) transport.setLine(lineOf(pc, pl));
}
function syncPlay(): void {
  transport.sync();
}
/** 拍 from（楽譜の拍）から演奏する */
async function startPiece(from: number): Promise<void> {
  const ok = await audio.ready();
  if (!ok) {
    sndMsg(NO_SOUND);
    return;
  }
  sndMsg('');
  const pc = pieceOf(piece.value);
  if (tun.value !== pc.tuning) {
    tun.set(pc.tuning);
    store('c:p-tun', pc.tuning);
    retune();
    rebuild();
    chordRetune();
  }
  if (tm.value === 'man') sndMsg('張力を手で決めているため、音程がずれることがあります');
  let pl: PieceData;
  try {
    pl = await placedOf(pc);
  } catch {
    sndMsg('曲を読み込めませんでした');
    return;
  }
  if (P || piece.value !== pc.v) return;
  /* 押さえていたコードは離す（左手は曲の運指で動く） */
  releaseChord();
  const tmap = new TempoMap(pl.tempo),
    all = eventsOf(pl, pc, tmap),
    /* 途中から弾くときは、その拍より前の音を飛ばす（運指は曲の全体で決めてあるので、そのまま使える） */
    b0 = tmap.tau(from),
    i0 = all.findIndex((e) => e.b >= b0 - 1e-6),
    i = i0 < 0 ? all.length : i0,
    /* その拍で鳴っている音（弦ごとに、その前に最後に弾いた音がまだ終わらないとき）は、その拍で弾き直す */
    again = [0, 1, 2, 3, 4, 5].flatMap((si) => {
      const e = all.slice(0, i).findLast((x) => x.si === si);
      return e && e.end > b0 + 1e-6 ? [{ ...e, b: b0, jit: 0, slide: null }] : [];
    }),
    ev = [...again, ...all.slice(i)];
  /* 飛ばした音からすべる音は鳴らさない */
  for (const e of ev) if (e.slide && e.b - e.slide.gap < b0 - 1e-6) e.slide = null;
  /* 使うモードを先に求める */
  for (const e of ev) modes(e.si, e.f);
  const now = audio.now() ?? 0;
  P = {
    ev,
    i: 0,
    at0: now + 0.15,
    b0,
    spb: spbOf(pc),
    until: now + AHEAD,
    last: Math.max(...ev.map((e) => e.b)),
    end: endOf(pl),
    timer: setInterval(tick, 40),
    piece: pc,
    tm: tmap,
  };
  syncPlay();
  tick();
}
function stopPiece(): void {
  if (!P) return;
  clearInterval(P.timer);
  P = null;
  audio.stop(0.08);
  neck.clearPending();
  const t = nowS();
  for (let si = 0; si < 6; si++) {
    const s = neck.get(si);
    if (s && s.damp > t) neck.set(si, { ...s, damp: t });
  }
  syncPlay();
  estimate();
}
/** 一時停止: 予約を消す（指を離す予定も消すので、鳴っている弦は自然に減衰し、その間も手で弾ける）。止めた拍を返す */
function pausePiece(): number {
  const p = P;
  if (!p) return 0;
  const beat = Math.min(p.end, p.tm.beat(tauOf(p, audio.now() ?? p.at0)));
  clearInterval(p.timer);
  P = null;
  audio.pause();
  neck.clearPending();
  const t = nowS();
  for (let si = 0; si < 6; si++) {
    const s = neck.get(si);
    if (s && s.damp > t) neck.set(si, { ...s, damp: Infinity });
  }
  syncPlay();
  estimate();
  return beat;
}
/** AudioContext の時刻 an での拍（τ。鳴り始める前は、弾き始める位置） */
const tauOf = (p: Play, an: number) => p.b0 + Math.max(0, an - p.at0) / p.spb;
/** 先に予約する時間 [s] */
const AHEAD = 0.3;
/** ビブラートを掛ける音の長さの下限と、掛け始めるまでの時間 [s] */
const VIB_MIN = 0.45,
  VIB_DELAY = 0.15;
/**
 * 曲の音のビブラート: 押さえた旋律の音のうち、長さ dur [s] が長いものにだけ、少し遅れてから掛ける。
 * ナイロン弦は指を弦の向きに揺らし（上下に揺れる）、スチール弦は弦を押し上げる（高い側だけに揺れる）
 */
function vibOf(e: Ev, dur: number): VibSpec | undefined {
  if (vib.value !== '1' || e.f <= 0 || !e.top || dur < VIB_MIN || PV.get('vw') <= 0) return undefined;
  return {
    t0: VIB_DELAY,
    t1: dur,
    hz: PV.get('vh') * (1 + 0.04 * e.vr),
    cent: PV.get('vw'),
    up: S.set === 'steel',
  };
}
function tick(): void {
  const p = P;
  if (!p) return;
  const an = audio.now();
  if (an === null) return;
  /* 画面が隠れている間は、タイマーが間引かれるぶん先まで予約する */
  const ahead = lookahead(AHEAD);
  /* タイマーが止まっていた間（スリープ、重い処理）に過ぎた分は、後ろへずらして続きから弾く（遅れた音をまとめて鳴らさない） */
  if (an > p.until) p.at0 += an - p.until;
  p.until = Math.max(p.until, an + ahead);
  /* テンポが変わったら、今の拍を基準に付け直す */
  const spb = spbOf(p.piece);
  if (spb !== p.spb) {
    p.b0 += Math.max(0, an - p.at0) / p.spb;
    p.at0 = Math.max(an, p.at0);
    p.spb = spb;
  }
  const toPerf = (a: number) => nowS() + (a - an);
  while (p.i < p.ev.length && atOf(p, p.ev[p.i].b) + p.ev[p.i].jit < an + ahead) {
    const e = p.ev[p.i++],
      at = Math.max(an, atOf(p, e.b) + e.jit),
      m = modes(e.si, e.f),
      pl = pluckOf(G, e.si, m, pluckSpec(e.si, e.amp));
    if (e.slide) {
      const dur = Math.min(0.12, Math.max(0.04, e.slide.gap * spb * 0.5)),
        buf = slideOf(e.si, e.slide.from, e.f, dur, p.i);
      if (buf) audio.noise(e.si, buf, at - dur, slidePan(e.si, e.slide.from, e.f));
    }
    /* 指を離すのは、この音だけ（離す前に同じ弦をずらした和音で弾き直していても、その音は止めない） */
    const off = e.off !== null ? atOf(p, e.off) + 0.02 : null,
      id = audio.pluck(msgOf(e.si, m, pl.f, vibOf(e, atOf(p, e.end) - at)), at, panOf(e.si, e.f));
    if (off !== null) audio.damp(e.si, off, id);
    neck.set(e.si, {
      pl,
      t0: toPerf(at),
      damp: off !== null ? toPerf(off) : Infinity,
      fret: e.f,
      dir: (V.ang * Math.PI) / 180,
      xb: posOf(e.si),
    });
  }
  /* 鳴り始める前（予約の 0.15 秒）は、弾き始める位置に置く */
  const beat = tauOf(p, an);
  transport.setPos(Math.min(p.tm.beat(beat), p.end));
  if (p.i >= p.ev.length && beat > p.last + 2) {
    clearInterval(p.timer);
    P = null;
    transport.stopped(true);
    syncPlay();
  }
  estimate();
}
const transport = new Transport({
  active: () => !!P,
  start: startPiece,
  stop: stopPiece,
  pause: pausePiece,
  tempo: () => V.tempo,
});
autoPause(audio, { pause: () => transport.pause(), hidden: tick });

/* ---------- 起動 ---------- */
bodyDefaults();
retune();
rebuild();
void showLine();
neck.setPos(posAll());
neckBar();
showOut();
roomView();
/* 保存した値を戻したあと（マイクロタスク）にもう一度合わせる */
queueMicrotask(() => {
  neck.setPos(posAll());
  table();
});
