/**
 * 音律とうなりの入口: 入力（音律・和音・音色）→ 和音の音と部分音・うなり（tem.ts）→ 純正の物差し・拡大図・うなりの表・
 * 鍵盤・調ごとの 3 度・音律の表、和音の音（audio.ts）。入力が変わるたびに描き直して鳴らし直し、うなりの灯りと包絡の今の位置は毎フレーム動かす
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { fmtR } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { addRow } from '../../lib/reset';
import { forget, store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { Synth } from './audio';
import { A4, AB_MS, type Key, REHIT_MS, VOL } from './params';
import {
  analyze,
  type Coin,
  chordOf,
  coins,
  firstOrder,
  intervalName,
  isMinor,
  justRatios,
  keyStats,
  NAMES,
  noteName,
  type Pair,
  pcOf,
  pure,
  type Setup,
  TEMPERAMENTS,
  type Timbre,
  temperamentOf,
} from './tem';
import { envPath, lampOpacity, ruler, sg, zoomX } from './view';

initToolPage();

const txt = (el: Element, s: string) => {
  if (el.textContent !== s) el.textContent = s;
};

/* ---------- 状態 ---------- */
const S = {
  tem: 'et',
  /** 比べる音律 B（'none' はなし） */
  cmp: 'mt4',
  ton: 0,
  a4: 440,
  vol: -10,
  chord: 'maj',
  root: 0,
  oct: 4,
  tb: 'organ' as Timbre,
  pt: 'concert',
  st: false,
  /** 選んだ音の組 */
  sel: 0,
  play: false,
  ab: false,
};
/** 交互に比べている間、B を鳴らしているか */
let sideB = false;
/** 鳴り始め・A と B を入れ替えた時刻・打ち直した時刻 [ms] */
let t0 = 0,
  abT = 0,
  hitT = 0;
let ready = false;
const synth = new Synth();

const curTem = (): string => (S.ab && S.cmp !== 'none' && sideB ? S.cmp : S.tem);
const setup = (tem = curTem()): Setup => ({ tem, ton: S.ton, a4: S.a4, tb: S.tb, pt: S.pt, st: S.st });
const rootMidi = (): number => 12 * (S.oct + 1) + S.root;

/* ---------- 入力 ---------- */
const g = new ParamGroup<Key>([A4, VOL], (v, k) => {
  S.a4 = v.ref;
  S.vol = v.vol;
  if (k) update();
});
S.a4 = g.get('ref');
S.vol = g.get('vol');

const choice = <V extends string>(id: string, fn: (v: V) => void): Choice<V> => {
  const c = new Choice<V>($(id), (v) => {
    fn(v);
    update();
  });
  fn(c.value);
  return c;
};
/* 音律 A・B は表の列（行ではないので、枠の「↺ n」にだけ数える） */
for (const c of [
  choice<string>('#p-tem', (v) => {
    S.tem = v;
  }),
  choice<string>('#p-cmp', (v) => {
    S.cmp = v;
  }),
])
  addRow(c.root, c);
choice<string>('#p-ton', (v) => {
  S.ton = Number(v);
});
choice<string>('#p-chord', (v) => {
  S.chord = v;
  S.sel = 0;
});
choice<Timbre>('#p-tb', (v) => {
  S.tb = v;
});
choice<string>('#p-pt', (v) => {
  S.pt = v;
});
choice<string>('#p-st', (v) => {
  S.st = v === '1';
});

/* 根音: 鍵盤と調ごとの 3 度で選ぶ。保存のキーは、前に選択肢の行だったときと同じ */
const ROOT_K = 'c:p-root',
  OCT_K = 'c:p-oct';
{
  const r = stored(ROOT_K),
    o = stored(OCT_K);
  if (typeof r === 'string' && Number(r) >= 0 && Number(r) < 12) S.root = Number(r);
  if (typeof o === 'string' && ['3', '4', '5'].includes(o)) S.oct = Number(o);
}
function setRoot(p: number, oct = S.oct): void {
  S.root = p;
  S.oct = oct;
  if (p) store(ROOT_K, String(p));
  else forget(ROOT_K);
  if (oct !== 4) store(OCT_K, String(oct));
  else forget(OCT_K);
  update();
}

/* 鳴らす・交互 */
const playBtn = $('#playBtn'),
  abBtn = $('#abBtn');
function setPlay(on: boolean): void {
  S.play = on;
  if (on) {
    sideB = false;
    abT = performance.now();
  }
  update();
}
playBtn.addEventListener('click', () => setPlay(!S.play));
abBtn.addEventListener('click', () => {
  S.ab = !S.ab;
  sideB = false;
  abT = performance.now();
  if (S.ab && !S.play) S.play = true;
  update();
});

/* 鍵盤: 押した鍵を根音にする（オクターブは 3〜5 に収める） */
$('#kb').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('button[data-m]');
  if (!b) return;
  const m = Number(b.dataset.m);
  setRoot(pcOf(m), Math.max(3, Math.min(5, Math.floor(m / 12) - 1)));
});
/* 調ごとの 3 度: 押した調の主和音を鳴らす */
$('#k12').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('button[data-p]');
  if (!b) return;
  setRoot(Number(b.dataset.p));
  if (!S.play) setPlay(true);
});
/* 音の組を選ぶ（表・拡大図） */
for (const el of [$('#prs-b'), $('#zms')])
  el.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-i]');
    if (!b) return;
    S.sel = Number(b.dataset.i);
    draw();
  });

/** 非調和性係数の表記（3.35 × 10⁻⁴。0 は —） */
function sci(v: number): string {
  if (!v) return '—';
  const e = Math.floor(Math.log10(v));
  return `${(v / 10 ** e).toFixed(2)} × 10<sup>−${-e}</sup>`;
}

/* ---------- 描画 ---------- */
let pairs: Pair[] = [],
  cs: Coin[] = [];
const kbKeys = $$<HTMLButtonElement>('#kb button[data-m]'),
  k12 = $$<HTMLButtonElement>('#k12 button[data-p]');

/** 入力が変わった: 描き直し、鳴っていれば鳴らし直す */
function update(): void {
  if (!ready) return;
  draw();
  sound();
}

function sound(): void {
  if (!S.play) {
    synth.stop();
    return;
  }
  const r = analyze(setup(), rootMidi(), chordOf(S.chord).iv);
  t0 = synth.start(r.notes, S.tb, S.vol);
  hitT = performance.now();
}

/** うなりの速さ [回/秒]（一致する部分音を持たない組は —） */
const beatT = (p: Pair): string => (p.c ? Math.abs(p.b).toFixed(2) : '—');

function draw(): void {
  const s = setup(),
    ch = chordOf(S.chord),
    r = analyze(s, rootMidi(), ch.iv),
    minor = isMinor(S.chord),
    t3 = minor ? '短 3 度' : '長 3 度',
    tn = temperamentOf(curTem()).name;
  pairs = r.pairs;
  cs = coins(r);
  if (S.sel >= pairs.length) S.sel = 0;
  const sp = pairs[S.sel];

  /* 状態の帯 */
  txt($('#s-a'), temperamentOf(S.tem).name);
  $('#s-bw').hidden = S.cmp === 'none';
  txt($('#s-b'), S.cmp === 'none' ? '' : temperamentOf(S.cmp).name);
  txt($('#s-ch'), `${noteName(rootMidi())} の${ch.name}`);
  txt($('#s-tb'), { sine: '正弦波', organ: 'オルガン（第 1〜8 部分音）', piano: 'ピアノ（非調和性あり）' }[S.tb]);
  $('#s-now').hidden = !S.play;
  txt($('#s-cur'), (S.ab && S.cmp !== 'none' ? (sideB ? 'B ' : 'A ') : '') + tn);
  playBtn.setAttribute('aria-pressed', String(S.play));
  $('#playLed').classList.toggle('on', S.play);
  txt($('#playT'), S.play ? '停止' : '鳴らす');
  abBtn.setAttribute('aria-pressed', String(S.ab));
  $('#abLed').classList.toggle('on', S.ab);
  (abBtn as HTMLButtonElement).disabled = S.cmp === 'none';
  txt($('#o-ab'), tn);

  /* 純正の物差し。一致する部分音を持つ組が 3 つまでなら組ごとに色、4 つ以上なら選んだ組だけ */
  const ratios = justRatios(ch.iv),
    withC = pairs.flatMap((p, i) => (p.c ? [i] : [])),
    cls = (i: number) => (withC.length <= 3 ? `k${withC.indexOf(i)}` : i === S.sel ? 'k0' : ''),
    lampCls = (p: Pair, i: number) => `lamp ${cls(i) || 'g'}${p.c && !pure(p) ? '' : ' still'}`;
  txt($('#s-rt'), `純正 ${ratios.join(' : ')} の物差し`);
  $('#lad-g').innerHTML = ruler(r.notes, cs, ratios, cls);
  $('#lad').setAttribute(
    'aria-label',
    `${noteName(rootMidi())} の${ch.name}（${tn}）の部分音を、純正 ${ratios.join(' : ')} の目盛りに並べた図と、同じ目盛りに来る部分音のうなり`,
  );
  $('#lg-e').hidden = !cs.some((c) => !firstOrder(c));

  /* 拡大図 */
  $('#zms').innerHTML = pairs
    .map((p, i) => {
      if (!p.c) return '';
      /* 2 次のうなりは部分音がないので、第 1 部分音の何倍かで書く */
      const one = firstOrder(p),
        [lo, hi] = one
          ? [`下の第 ${p.c[0]} 部分音`, `上の第 ${p.c[1]} 部分音`]
          : [`下の音の ${p.c[0]} 倍`, `上の音の ${p.c[1]} 倍`];
      return (
        `<button type="button" class="zm${i === S.sel ? ' on' : ''}" data-i="${i}" aria-pressed="${i === S.sel}">` +
        `<span class="zh"><span>${intervalName(p.d)} ${noteName(p.lo.m)}–${noteName(p.hi.m)}</span><i class="${lampCls(p, i)}" data-i="${i}" aria-hidden="true"></i></span>` +
        `<span class="zb">${beatT(p)}<small>回/秒${one ? '' : '・2 次'}</small></span>` +
        '<svg viewBox="0 0 200 46" aria-hidden="true"><path class="za" d="M10 32H190M10 28V36M40 30V34M70 30V34M100 26V38M130 30V34M160 30V34M190 28V36"/>' +
        `<path class="z1" d="M100 10V30"/><path class="z2" d="M${zoomX(p.ct).toFixed(1)} 10V30"/>` +
        '<text x="10" y="45">−30</text><text x="100" y="45">0</text><text x="190" y="45">+30</text></svg>' +
        `<span class="zs">${lo} ${p.fl.toFixed(1)} Hz</span>` +
        `<span class="zs">${hi} ${p.fh.toFixed(1)} Hz（${sg(p.ct)} セント）</span></button>`
      );
    })
    .join('');

  /* 鍵盤 */
  const inCh = new Set(r.notes.map((n) => n.m)),
    rm = rootMidi();
  for (const b of kbKeys) {
    const m = Number(b.dataset.m);
    b.classList.toggle('on', inCh.has(m));
    b.classList.toggle('rt', m === rm);
    txt(b.querySelector('.dv') as Element, sg(r.dev[pcOf(m)]));
    b.setAttribute('aria-label', `${noteName(m)}（平均律から ${sg(r.dev[pcOf(m)])} セント）`);
    b.setAttribute('aria-pressed', String(m === rm));
  }

  /* 調ごとの 3 度 */
  const ks = keyStats(s, S.oct, minor);
  txt($('#k12-l'), `調ごとの${t3}（主和音、純正からのずれ [セント]）`);
  for (const b of k12) {
    const p = Number(b.dataset.p),
      k = ks[p];
    b.setAttribute('aria-pressed', String(p === S.root));
    txt(b.querySelector('b') as Element, minor ? NAMES[p].toLowerCase() : NAMES[p]);
    txt(b.querySelector('.v') as Element, sg(k.t3));
    (b.querySelector('.bx i') as HTMLElement).style.height =
      `${Math.max(2, Math.min(100, (Math.abs(k.t3) / 42) * 100)).toFixed(1)}%`;
  }

  /* 音律の表: 今の根音の 3 度と 5 度の、純正からのずれ */
  const third = (S.root + (minor ? 3 : 4)) % 12,
    fifth = (S.root + 7) % 12;
  txt($('#tt-3'), `${NAMES[S.root]}–${NAMES[third]}`);
  txt($('#tt-5'), `${NAMES[S.root]}–${NAMES[fifth]}`);
  txt($('#tt-n'), `右の 2 列は、${NAMES[S.root]} の${t3}と 5 度の純正からのずれ [セント]。棒は 25 セントで端まで`);
  for (const t of TEMPERAMENTS) {
    const k = keyStats({ ...s, tem: t.v }, S.oct, minor)[S.root];
    for (const [sel, v] of [
      [`.v3[data-t="${t.v}"]`, k.t3],
      [`.v5[data-t="${t.v}"]`, k.p5],
    ] as const) {
      const el = $(sel);
      txt(el.querySelector('span') as Element, sg(v));
      (el.querySelector('i') as HTMLElement).style.width = `${Math.min(100, Math.abs(v) * 4).toFixed(0)}%`;
    }
  }

  /* うなりの表 */
  $('#prs-b').innerHTML = pairs
    .map((p, i) => {
      const ok = !!p.c,
        dir = !ok ? '協和しない' : pure(p) ? '純正' : p.ct > 0 ? '広い' : '狭い';
      return (
        `<div class="r${i === S.sel ? ' on' : ''}${ok ? '' : ' na'}" role="row">` +
        `<span role="cell"><button type="button" class="prb" data-i="${i}" aria-pressed="${i === S.sel}">${intervalName(p.d)}</button></span>` +
        `<span role="cell">${noteName(p.lo.m)}–${noteName(p.hi.m)}</span>` +
        `<span class="hn" role="cell">${ok && p.c ? `${p.c[0]} : ${p.c[1]}` : '—'}</span>` +
        `<span role="cell">${ok ? sg(p.ct) : '—'}<span class="dir">${ok ? `セント・${dir}` : dir}</span></span>` +
        `<span class="bt" role="cell">${beatT(p)}<span class="dir">回/秒${ok && !firstOrder(p) ? '・2 次' : ''}</span></span>` +
        `<span class="lc" role="cell"><i class="${lampCls(p, i)}" data-i="${i}" aria-hidden="true"></i></span></div>`
      );
    })
    .join('');
  txt($('#env-n'), sp ? `${intervalName(sp.d)}（${noteName(sp.lo.m)}–${noteName(sp.hi.m)}）の音量の揺れ` : '');
  $('#env-p').setAttribute('d', envPath(sp?.c ? sp : null, 300, 64, 2));
  const msg = !sp?.c
    ? 'この音程には一致する部分音がありません'
    : firstOrder(sp)
      ? ''
      : pure(sp)
        ? '比がちょうど整数比なので、うなりません'
        : `第 ${sp.c[0]}・第 ${sp.c[1]} 部分音がないので音量は揺れませんが、2 つの音の波の形が 1 秒に ${Math.abs(sp.b).toFixed(2)} 回移り変わり、2 次のうなりとして聞こえます`;
  txt($('#env-m'), msg);
  $('#nts-b').innerHTML = r.notes
    .map(
      (n) =>
        `<div class="r" role="row"><span role="cell">${noteName(n.m)}</span><span role="cell">${fmtR(n.f, 'Hz', 5)}</span>` +
        `<span role="cell">${sg(n.dev)}</span><span role="cell">${sci(n.B)}</span></div>`,
    )
    .join('');

  /* ピアノだけの行 */
  for (const el of $$('.pno')) el.hidden = S.tb !== 'piano';

  /* 要約の帯 */
  txt($('#mt'), tn);
  txt($('#mc'), `${NAMES[S.root]} ${ch.name}`);
  txt($('#mb'), sp?.c ? `${beatT(sp)} 回/秒${firstOrder(sp) ? '' : '（2 次）'}` : '—');
  frame(performance.now());
}

/** 毎フレーム: 灯りと包絡の今の位置 */
function frame(now: number): void {
  const T = Math.max(0, S.play ? (now - t0) / 1000 : 0);
  for (const el of $$<HTMLElement>('[data-i].lamp')) {
    const p = pairs[Number(el.dataset.i)];
    if (p) el.style.opacity = lampOpacity(p.c ? p : null, T, S.play).toFixed(3);
  }
  for (const el of $$<SVGElement>('#lad-g .lmp')) {
    const c = cs[Number(el.dataset.c)];
    if (c) el.style.opacity = lampOpacity(c, T, S.play).toFixed(3);
  }
  const sp = pairs[S.sel],
    x = sp?.c && firstOrder(sp) && S.play ? (300 * ((T % 2) / 2)).toFixed(1) : '-10';
  $('#env-now').setAttribute('d', `M${x} 0V64`);
}

function loop(now: number): void {
  requestAnimationFrame(loop);
  if (!S.play) return;
  if (S.ab && S.cmp !== 'none' && now - abT > AB_MS) {
    abT = now;
    sideB = !sideB;
    update();
    return;
  }
  if (S.tb === 'piano' && now - hitT > REHIT_MS) sound();
  frame(now);
}

/* 選択肢・入力に戻した保存の値は生成の直後（マイクロタスク）に届くので、そのあとで描く */
queueMicrotask(() => {
  ready = true;
  draw();
  requestAnimationFrame(loop);
});
