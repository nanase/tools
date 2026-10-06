/**
 * 演奏する曲（著作権の切れた曲を、このツールのためにギターへ編曲したもの）と、運指（弦とフレット）の自動割り当て。
 * 音の高さは実際に鳴る高さ（ギターの楽譜は 1 オクターブ上に書くが、ここでは使わない）。DOM に依存しない
 */

/** 音符: 開始と長さ（拍）、音の高さ（MIDI のノート番号） */
export interface Note {
  t: number;
  d: number;
  n: number;
}

export interface Piece {
  v: string;
  name: string;
  /** 作曲者・出典 */
  by: string;
  /** 調弦（strings.ts の Tuning.v） */
  tuning: string;
  /** 1 分あたりの拍の数（拍は beat の音符） */
  bpm: number;
  beat: string;
  /** 1 小節の拍の数 */
  bar: number;
  /** 最初の小節の前の拍（弱起） */
  pickup: number;
  notes: Note[];
  /** 音符と運指を別のファイルから読む曲（notes は空）。長い曲を、選んだときだけ読み込む */
  load?: () => Promise<Placed[]>;
}

const SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 音名（C4 = 60、♯ は # か ♯、♭ は b か ♭） */
export function midiOf(s: string): number {
  const m = s.match(/^([A-G])([#♯b♭]?)(-?\d)$/);
  if (!m) throw new Error(`bad note: ${s}`);
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + SEMI[m[1]] + acc;
}

/**
 * 「音名/拍」を空白で並べた列を、t0 から順に置く。和音は「G2+D3/3」、休符は「r/1」。
 * shift は半音で足す（オクターブ下げるなら −12）
 */
export function seq(t0: number, text: string, shift = 0): Note[] {
  const out: Note[] = [];
  let t = t0;
  for (const tok of text.trim().split(/\s+/)) {
    const [p, d] = tok.split('/'),
      len = Number(d);
    if (p !== 'r') for (const x of p.split('+')) out.push({ t, d: len, n: midiOf(x) + shift });
    t += len;
  }
  return out;
}

/* ---------- 1. J. S. バッハ: 平均律クラヴィーア曲集 第 1 巻 前奏曲 ハ長調 BWV 846 ---------- */
/**
 * 実音で 2 半音上げてニ長調にし、6 弦を D に下げた調弦で弾く（原曲の C2〜A5 が D2〜B5 に入る）。
 * 各小節の 5 つの音を 1 2 3 4 5 3 4 5 の順に 16 分音符で 2 回弾く
 */
const PRELUDE_BARS = [
  'D4 F#4 A4 D5 F#5',
  'D4 E4 B4 E5 G5',
  'C#4 E4 A4 E5 G5',
  'D4 F#4 A4 D5 F#5',
  'D4 F#4 B4 F#5 B5',
  'D4 E4 G#4 B4 E5',
  'C#4 E4 A4 E5 A5',
  'C#4 D4 F#4 A4 D5',
  'B3 D4 F#4 A4 D5',
  'E3 B3 E4 G#4 D5',
  'A3 C#4 E4 A4 C#5',
  'A3 C4 F#4 A4 D#5',
  'G3 B3 E4 B4 E5',
  'G3 Bb3 E4 G4 C#5',
  'F#3 A3 D4 A4 D5',
  'F#3 G3 B3 D4 G4',
  'E3 G3 B3 D4 G4',
  'A2 E3 A3 C#4 G4',
  'D3 F#3 A3 D4 F#4',
  'D3 A3 C4 D4 F#4',
  'G2 G3 B3 D4 F#4',
  'G#2 D3 B3 D4 F4',
  'Bb2 G3 C#4 D4 E4',
  'A2 G3 A3 C#4 E4',
  'A2 F#3 A3 D4 F#4',
  'A2 E3 A3 D4 G4',
  'A2 E3 A3 C#4 G4',
  'A2 F3 B3 D4 G#4',
  'A2 F#3 A3 D4 A4',
  'A2 E3 A3 D4 G4',
  'A2 E3 A3 C#4 G4',
  'D2 D3 A3 C4 F#4',
];
function prelude(): Note[] {
  const out: Note[] = [];
  PRELUDE_BARS.forEach((b, i) => {
    const p = b.split(' ').map(midiOf);
    for (const h of [0, 2]) {
      const t = 4 * i + h;
      out.push({ t, d: 2, n: p[0] }, { t: t + 0.25, d: 1.75, n: p[1] });
      [2, 3, 4, 2, 3, 4].forEach((k, j) => {
        out.push({ t: t + 0.5 + 0.25 * j, d: 1.5 - 0.25 * j, n: p[k] });
      });
    }
  });
  /* 終わりの 3 小節: 低音を伸ばして 14 個の 16 分音符、最後の和音 */
  const end = (bar: number, bass: string, run: string) => {
    const t = 4 * bar;
    out.push({ t, d: 4, n: midiOf(bass.split(' ')[0]) }, { t: t + 0.25, d: 3.75, n: midiOf(bass.split(' ')[1]) });
    run.split(' ').forEach((x, j) => {
      out.push({ t: t + 0.5 + 0.25 * j, d: 0.5, n: midiOf(x) });
    });
  };
  end(32, 'D2 D3', 'G3 B3 D4 G4 D4 B3 D4 B3 G3 B3 G3 E3 G3 E3');
  end(33, 'D2 C#3', 'A4 C#5 E5 G5 E5 C#5 E5 C#5 A4 C#5 E4 G4 F#4 E4');
  for (const x of ['D2', 'D3', 'F#4', 'A4', 'D5']) out.push({ t: 4 * 34, d: 4, n: midiOf(x) });
  return out;
}

/* ---------- 2. メヌエット ト長調 BWV Anh. 114 ---------- */
/** 旋律は原曲（鍵盤の高さ）を 1 オクターブ下げる。低音はこのツールの編曲（各小節の初めに 1 音） */
const MINUET_A = `D5/1 G4/.5 A4/.5 B4/.5 C5/.5 D5/1 G4/1 G4/1 E5/1 C5/.5 D5/.5 E5/.5 F#5/.5 G5/1 G4/1 G4/1
C5/1 D5/.5 C5/.5 B4/.5 A4/.5 B4/1 C5/.5 B4/.5 A4/.5 G4/.5 F#4/1 G4/.5 A4/.5 B4/.5 G4/.5 A4/3`;
const MINUET_A2 = `D5/1 G4/.5 A4/.5 B4/.5 C5/.5 D5/1 G4/1 G4/1 E5/1 C5/.5 D5/.5 E5/.5 F#5/.5 G5/1 G4/1 G4/1
C5/1 D5/.5 C5/.5 B4/.5 A4/.5 B4/1 C5/.5 B4/.5 A4/.5 G4/.5 A4/1 B4/.5 A4/.5 G4/.5 F#4/.5 G4/3`;
const MINUET_B = `B5/1 G5/.5 A5/.5 B5/.5 G5/.5 A5/1 D5/.5 E5/.5 F#5/.5 D5/.5 G5/1 E5/.5 F#5/.5 G5/.5 D5/.5
C#5/1 B4/.5 C#5/.5 A4/1 A4/.5 B4/.5 C#5/.5 D5/.5 E5/.5 F#5/.5 G5/1 F#5/1 E5/1 F#5/1 A4/1 C#5/1 D5/3
D5/1 G4/.5 F#4/.5 G4/1 E5/1 G4/.5 F#4/.5 G4/1 D5/1 C5/1 B4/1 A4/.5 G4/.5 F#4/.5 G4/.5 A4/1
D4/.5 E4/.5 F#4/.5 G4/.5 A4/.5 B4/.5 C5/1 B4/1 A4/1 B4/.5 D5/.5 G4/1 F#4/1 G4/3`;
const MINUET_BASS = `G2/3 B2/3 C3/3 B2/3 A2/3 G2/3 D3/3 F#2/3 G2/3 B2/3 C3/3 B2/3 A2/3 G2/3 D3/3 G2/3
G2/3 F#2/3 E2/3 A2/3 D3/3 A2/3 D3/1 A2/2 D3/3 B2/3 C3/3 B2/3 C3/3 B2/3 C3/3 D3/3 G2/3`;
const minuet = (): Note[] => [
  ...seq(0, MINUET_A, -12),
  ...seq(24, MINUET_A2, -12),
  ...seq(48, MINUET_B, -12),
  ...seq(0, MINUET_BASS),
];

/* ---------- 3. グリーンスリーブス（16 世紀のイングランドの旋律） ---------- */
/** 8 分音符を 1 拍とする 6/8 拍子。旋律（ギターの楽譜の高さで書き、1 オクターブ下げる）と、各小節の初めの低音と内声（このツールの編曲） */
const GREEN_MEL = `A4/1 C5/2 D5/1 E5/1.5 F5/.5 E5/1 D5/2 B4/1 G4/1.5 A4/.5 B4/1 C5/2 A4/1 A4/1.5 G#4/.5 A4/1 B4/2 G#4/1 E4/2 A4/1
C5/2 D5/1 E5/1.5 F5/.5 E5/1 D5/2 B4/1 G4/1.5 A4/.5 B4/1 C5/1.5 B4/.5 A4/1 G#4/1.5 F#4/.5 G#4/1 A4/3 A4/3
G5/3 G5/1.5 F#5/.5 E5/1 D5/2 B4/1 G4/1.5 A4/.5 B4/1 C5/2 A4/1 A4/1.5 G#4/.5 A4/1 B4/2 G#4/1 E4/3
G5/3 G5/1.5 F#5/.5 E5/1 D5/2 B4/1 G4/1.5 A4/.5 B4/1 C5/1.5 B4/.5 A4/1 G#4/1.5 F#4/.5 G#4/1 A4/6`;
const GREEN_BASS = `A2+E3/6 G2+D3/6 A2+E3/6 E2+B2/6 A2+E3/6 G2+D3/6 A2+E3/3 E2+B2/3 A2+E3/6
C3+G3/6 G2+D3/6 A2+E3/6 E2+B2/6 C3+G3/6 G2+D3/6 A2+E3/3 E2+B2/3 A2+E3+A3/6`;
const green = (): Note[] => [...seq(0, GREEN_MEL, -12), ...seq(1, GREEN_BASS)];

export const PIECES: readonly Piece[] = [
  {
    v: 'bwv846',
    name: '前奏曲 ハ長調 BWV 846',
    by: 'J. S. バッハ（平均律クラヴィーア曲集 第 1 巻）。ニ長調・ドロップ D に移した',
    tuning: 'dropd',
    bpm: 66,
    beat: '4 分音符',
    bar: 4,
    pickup: 0,
    notes: prelude(),
  },
  {
    v: 'bwv1004',
    name: 'シャコンヌ ニ短調 BWV 1004',
    by: 'J. S. バッハ（無伴奏ヴァイオリンのためのパルティータ第 2 番）。原曲を 1 オクターブ下げた',
    tuning: 'std',
    bpm: 60,
    beat: '4 分音符',
    bar: 3,
    pickup: 2,
    notes: [],
    load: () => import('./chaconne').then((m) => m.chaconne()),
  },
  {
    v: 'minuet',
    name: 'メヌエット ト長調 BWV Anh. 114',
    by: 'J. S. バッハ「アンナ・マグダレーナ・バッハのための音楽帳」（C. ペツォールト作とされる）',
    tuning: 'std',
    bpm: 112,
    beat: '4 分音符',
    bar: 3,
    pickup: 0,
    notes: minuet(),
  },
  {
    v: 'green',
    name: 'グリーンスリーブス',
    by: 'イングランド民謡（16 世紀）',
    tuning: 'std',
    bpm: 150,
    beat: '8 分音符',
    bar: 6,
    pickup: 1,
    notes: green(),
  },
];
export const pieceOf = (v: string): Piece => PIECES.find((p) => p.v === v) ?? PIECES[0];

/* ---------- 運指 ---------- */
/** 割り当てた音: 弦（0 = 1 弦）とフレット */
export interface Placed extends Note {
  s: number;
  f: number;
}

interface Beam {
  cost: number;
  /** 手の位置（人差し指のフレット。開放弦だけなら前のまま） */
  pos: number;
  /** 弦ごとの、鳴らしている音と、押さえ続ける終わりの拍 */
  held: number[];
  end: number[];
  fret: number[];
  /** 割り当て（音の番号 → 弦） */
  pick: Int8Array;
}

/** 1 つの音の置き場所の候補 */
const spots = (n: number, open: readonly number[], frets: number): [number, number][] =>
  open.flatMap((o, s) => (n - o >= 0 && n - o <= frets ? [[s, n - o] as [number, number]] : []));

/**
 * 運指を決める（ビーム探索）。同時に鳴らす音は別の弦に置き、手の移動・広げる幅・高い位置・
 * まだ伸ばしている音を途中で止めることに罰を与えて、全体の罰が小さい割り当てを選ぶ。
 * open は 1 弦から順の開放弦の音、frets はフレットの数
 */
export function finger(notes: readonly Note[], open: readonly number[], frets: number, width = 64): Placed[] {
  const idx = notes.map((_, i) => i).sort((a, b) => notes[a].t - notes[b].t || notes[b].n - notes[a].n);
  /* 同じ時刻の音をまとめる */
  const groups: number[][] = [];
  for (const i of idx) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(notes[g[0]].t - notes[i].t) < 1e-6) g.push(i);
    else groups.push([i]);
  }
  let beams: Beam[] = [
    {
      cost: 0,
      pos: 1,
      held: [-1, -1, -1, -1, -1, -1],
      end: [0, 0, 0, 0, 0, 0],
      fret: [0, 0, 0, 0, 0, 0],
      pick: new Int8Array(notes.length).fill(-1),
    },
  ];
  for (const g of groups) {
    const t = notes[g[0]].t,
      cand = g.map((i) => spots(notes[i].n, open, frets));
    const next: Beam[] = [];
    for (const b of beams) {
      /* 候補の組み合わせ（別の弦） */
      const combos: [number, number][][] = [];
      const rec = (k: number, acc: [number, number][]) => {
        if (k === g.length) {
          combos.push(acc.slice());
          return;
        }
        if (!cand[k].length) {
          rec(k + 1, [...acc, [-1, 0]]);
          return;
        }
        for (const c of cand[k]) if (!acc.some(([s]) => s === c[0])) rec(k + 1, [...acc, c]);
      };
      rec(0, []);
      for (const cb of combos) {
        let cost = b.cost;
        const used = new Set(cb.map(([s]) => s)),
          fr = cb.filter(([s, f]) => s >= 0 && f > 0).map(([, f]) => f),
          lo = fr.length ? Math.min(...fr) : b.pos,
          span = fr.length ? Math.max(...fr) - lo : 0;
        /* 届かない広さは大きな罰（ほかに置き場所がないときだけ選ばれる） */
        if (span > 3) cost += (span - 3) * 2 + (span > 5 ? 40 * (span - 5) : 0);
        const pos = fr.length ? lo : b.pos;
        cost += Math.abs(pos - b.pos) * 0.8 + (pos !== b.pos ? 0.6 : 0) + 0.04 * pos;
        const nb: Beam = {
          cost: 0,
          pos,
          held: b.held.slice(),
          end: b.end.slice(),
          fret: b.fret.slice(),
          pick: b.pick.slice(),
        };
        /* 押さえ続けているほかの音が手の届く範囲を外れたら止める */
        for (let s = 0; s < 6; s++) {
          const f = b.fret[s];
          if (used.has(s) || b.end[s] <= t + 1e-6 || f === 0) continue;
          if (f < pos - 1 || f > pos + 5 || (fr.length && Math.max(...fr, f) - Math.min(...fr, f) > 5)) {
            cost += 2 + 2 * (b.end[s] - t);
            nb.end[s] = t;
          }
        }
        cb.forEach(([s, f], k) => {
          if (s < 0) {
            cost += 50;
            return;
          }
          cost += f > 0 ? 0.15 : 0;
          /* 鳴らしている別の音を止める */
          if (b.end[s] > t + 1e-6 && b.held[s] !== notes[g[k]].n) cost += 3 + 2 * (b.end[s] - t);
        });
        nb.cost = cost;
        cb.forEach(([s, f], k) => {
          const i = g[k];
          nb.pick[i] = s;
          if (s < 0) return;
          nb.held[s] = notes[i].n;
          nb.end[s] = t + notes[i].d;
          nb.fret[s] = f;
        });
        next.push(nb);
      }
    }
    /* 同じ状態（手の位置と弦の音）は良いほうだけ残す */
    next.sort((a, b) => a.cost - b.cost);
    const seen = new Set<string>();
    beams = [];
    for (const b of next) {
      const key = `${b.pos}|${b.held.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      beams.push(b);
      if (beams.length >= width) break;
    }
  }
  const best = beams[0];
  return notes.map((x, i) => {
    const s = best.pick[i];
    return { ...x, s, f: s >= 0 ? x.n - open[s] : 0 };
  });
}
