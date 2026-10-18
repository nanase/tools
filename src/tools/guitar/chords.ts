/**
 * コードの押さえ方（ボイシング）を、調弦とフレットの数から自動で求める（DOM に依存しない）。
 * 4 フレットの幅に収まり、指 4 本（人差し指のセーハを含む）で押さえられ、最も低い音が根音のものを探して、
 * 鳴る弦の多さ・開放弦・低い位置を良しとする点で並べる
 */

/** 根音の名前（0 = C） */
export const ROOTS = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'] as const;

/** コードの種類: 名前に付ける記号、ボタンの表示、根音からの半音、省いてよい音（完全 5 度） */
export interface Quality {
  v: string;
  /** ボタンの表示 */
  l: string;
  /** コードの名前で根音の後ろに付ける記号 */
  sfx: string;
  iv: readonly number[];
  /** 省いてよい音（根音からの半音） */
  opt: readonly number[];
}
export const QUALITIES: readonly Quality[] = [
  { v: 'M', l: 'M', sfx: '', iv: [0, 4, 7], opt: [] },
  { v: 'm', l: 'm', sfx: 'm', iv: [0, 3, 7], opt: [] },
  { v: '7', l: '7', sfx: '7', iv: [0, 4, 7, 10], opt: [7] },
  { v: 'M7', l: 'M7', sfx: 'M7', iv: [0, 4, 7, 11], opt: [7] },
  { v: 'm7', l: 'm7', sfx: 'm7', iv: [0, 3, 7, 10], opt: [7] },
  { v: '6', l: '6', sfx: '6', iv: [0, 4, 7, 9], opt: [7] },
  { v: 'sus4', l: 'sus4', sfx: 'sus4', iv: [0, 5, 7], opt: [] },
  { v: '7sus4', l: '7sus4', sfx: '7sus4', iv: [0, 5, 7, 10], opt: [7] },
  { v: 'dim7', l: 'dim7', sfx: 'dim7', iv: [0, 3, 6, 9], opt: [] },
  { v: 'aug', l: 'aug', sfx: 'aug', iv: [0, 4, 8], opt: [] },
  { v: 'm7b5', l: 'm7♭5', sfx: 'm7♭5', iv: [0, 3, 6, 10], opt: [] },
  { v: 'add9', l: 'add9', sfx: 'add9', iv: [0, 4, 7, 2], opt: [7] },
];
/**
 * 根音を選ぶキー（0 = C から。表示と KeyboardEvent.code）。パソコンのキーボードを鍵盤に見立て、
 * 中段の A S D F G H J を白鍵、上段の W E T Y U を黒鍵にする
 */
export const ROOT_KEYS = ['A', 'W', 'S', 'E', 'D', 'F', 'T', 'G', 'Y', 'H', 'U', 'J'] as const;
export const ROOT_CODES = ROOT_KEYS.map((k) => `Key${k}`);
/** 次によく続くコードを選ぶキー（下段。重みの大きい順。表示と KeyboardEvent.code） */
export const NEXT_KEYS = ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ','] as const;
export const NEXT_CODES = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma'] as const;
/** 種類を選ぶキー（QUALITIES の順。表示と KeyboardEvent.code） */
export const CHORD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '−', '^'] as const;
export const CHORD_CODES = [
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'Digit6',
  'Digit7',
  'Digit8',
  'Digit9',
  'Digit0',
  'Minus',
  'Equal',
] as const;
export const qualityOf = (v: string): Quality => QUALITIES.find((q) => q.v === v) ?? QUALITIES[0];
/** コードの名前（Am7 など） */
export const chordName = (root: number, q: Quality): string => `${ROOTS[root]}${q.sfx}`;

/** 押さえ方: 弦ごとのフレット（1 弦から。0 は開放、−1 は鳴らさない） */
export interface Voicing {
  f: number[];
  /** セーハ（人差し指で複数の弦を押さえる）するか */
  barre: boolean;
  /** 点（小さいほど押さえやすく、よく使う形） */
  cost: number;
}

/** 押さえる幅（最も高いフレット − 最も低いフレット）の上限と、鳴らす弦の数の下限、探す位置の上限 */
const SPAN = 3,
  MIN_STR = 4,
  MAX_POS = 12;

/** 押さえ方の表記（6 弦から。鳴らさない弦は x、10 以上のフレットは括弧で囲む） */
export const shapeText = (f: readonly number[]): string =>
  [...f]
    .reverse()
    .map((x) => (x < 0 ? 'x' : x < 10 ? String(x) : `(${x})`))
    .join('');

/** 押さえ方 f（1 弦から）を調べる。押さえられなければ null */
function judge(f: readonly number[], open: readonly number[], root: number, q: Quality): Voicing | null {
  const n = f.length,
    snd = f.flatMap((x, s) => (x >= 0 ? [s] : []));
  if (snd.length < MIN_STR) return null;
  /* 最も低い音（いちばん太い鳴る弦）が根音 */
  const bass = snd[snd.length - 1];
  if ((open[bass] + f[bass] - root + 1200) % 12 !== 0) return null;
  const have = new Set(snd.map((s) => (open[s] + f[s] - root + 1200) % 12));
  for (const i of q.iv) if (!have.has(i % 12) && !q.opt.includes(i)) return null;
  const fr = snd.filter((s) => f[s] > 0),
    fs = fr.map((s) => f[s]),
    lo = fs.length ? Math.min(...fs) : 0,
    span = fs.length ? Math.max(...fs) - lo : 0;
  if (span > SPAN) return null;
  /* 指 4 本。足りなければ人差し指で最も低いフレットをセーハする（その範囲の細い弦に、開放と鳴らさない弦があってはいけない） */
  let barre = false;
  if (fr.length > 4) {
    const at = fr.filter((s) => f[s] === lo),
      reach = Math.max(...at);
    if (at.length < 2 || fr.length - at.length + 1 > 4) return null;
    for (let s = 0; s <= reach; s++) if (f[s] < lo) return null;
    barre = true;
  }
  const opens = snd.length - fr.length,
    avg = fs.length ? fs.reduce((a, b) => a + b, 0) / fs.length : 0,
    miss = q.iv.filter((i) => !have.has(i % 12)).length;
  /* 3 度の音を重ねると濁るので少し嫌う */
  const third = snd.filter((s) => {
    const i = (open[s] + f[s] - root + 1200) % 12;
    return i === 3 || i === 4;
  }).length;
  /*
   * 開放弦は、3 フレットまでで押さえる形（ローコード）では良しとし、それより上へ届く形では嫌う（指板の上の離れた音と混ぜない）。
   * 4 フレットいっぱいに広げる形も嫌う
   */
  const cost =
    0.5 * avg +
    (barre ? 1 : 0) +
    0.4 * span +
    (span >= SPAN ? 1 : 0) -
    0.8 * snd.length +
    (lo + span <= 3 ? -0.2 : 1.2) * opens +
    0.6 * miss +
    0.1 * Math.max(0, third - 1);
  return { f: f.slice(0, n), barre, cost };
}

/**
 * コード（根音 root、種類 q）の押さえ方の候補。open は 1 弦から順の開放弦の音（MIDI のノート番号）、frets はフレットの数。
 * 押さえる位置（最も低いフレット）ごとに最も良いものを 1 つ選び、低い位置から並べる。best は最も良いものの番号
 */
export function voicings(
  open: readonly number[],
  frets: number,
  root: number,
  q: Quality,
): { list: Voicing[]; best: number } {
  const pcs = new Set(q.iv.map((i) => (root + i) % 12)),
    ok = (s: number, x: number) => pcs.has((open[s] + x) % 12),
    seen = new Map<string, Voicing>(),
    n = open.length;
  for (let p = 0; p <= Math.min(MAX_POS, frets - SPAN); p++) {
    /* 弦ごとの候補: 鳴らさない・開放・位置 p から 4 フレットの中の、コードの音 */
    const cand = open.map((_, s) => {
      const c = [-1];
      if (ok(s, 0)) c.push(0);
      for (let x = Math.max(1, p); x <= p + SPAN && x <= frets; x++) if (ok(s, x)) c.push(x);
      return c;
    });
    const f = new Array<number>(n).fill(-1);
    /* 太い弦から決める。鳴らさない弦は、太い側に続けて並ぶものだけ */
    const rec = (s: number, muting: boolean): void => {
      if (s < 0) {
        const v = judge(f, open, root, q);
        if (v) {
          const key = f.join(',');
          if (!seen.has(key)) seen.set(key, v);
        }
        return;
      }
      for (const x of cand[s]) {
        if (x < 0 && !muting) continue;
        f[s] = x;
        rec(s - 1, muting && x < 0);
      }
      f[s] = -1;
    };
    rec(n - 1, true);
  }
  /* 位置（最も低いフレット。開放だけなら 0）ごとに最も良いもの */
  const byPos = new Map<number, Voicing>();
  for (const v of seen.values()) {
    const fs = v.f.filter((x) => x > 0),
      pos = fs.length ? Math.min(...fs) : 0,
      cur = byPos.get(pos);
    if (!cur || v.cost < cur.cost) byPos.set(pos, v);
  }
  const list = [...byPos.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  let best = 0;
  list.forEach((v, i) => {
    if (v.cost < list[best].cost) best = i;
  });
  return { list, best };
}

/* ---------- 次に続きやすいコード ---------- */
/** 次のコード: 根音からの半音（上へ）、種類、重み */
type Step = readonly [number, string, number];
type Family = 'maj' | 'dom' | 'sus' | 'sus7' | 'min' | 'min7' | 'hdim' | 'dim' | 'aug';
/**
 * 今のコードの働きごとの、よく続くコード。調は決めずに、今のコードを主和音（I）・属和音（V）・
 * 平行調の主和音（vi）などと見たときに、和声の教本とポピュラー音楽によくある進行を目安にして重みを付けた
 */
const NEXT: Record<Family, readonly Step[]> = {
  /* 長三和音を I と見る: IV・V・vi・ii・V7・iii・♭VII・I7（IV へ）・iv、副属和音（V/V・V/vi・V/ii）、sus4 */
  maj: [
    [5, 'M', 1],
    [7, 'M', 1],
    [9, 'm', 0.8],
    [2, 'm', 0.5],
    [7, '7', 0.5],
    [4, 'm', 0.3],
    [10, 'M', 0.25],
    [0, '7', 0.25],
    [5, 'm', 0.2],
    [2, '7', 0.15],
    [4, '7', 0.15],
    [9, '7', 0.15],
    [0, 'sus4', 0.15],
  ],
  /* 属七を V7 と見る: I・i、偽終止の vi、ブルースの I7 → IV7 */
  dom: [
    [5, 'M', 1],
    [5, 'm', 0.6],
    [2, 'm', 0.4],
    [5, '7', 0.3],
  ],
  /* sus4 は同じ根音へ解決する */
  sus: [
    [0, 'M', 1],
    [0, '7', 0.3],
    [5, 'M', 0.3],
  ],
  sus7: [
    [0, '7', 1],
    [5, 'M', 0.6],
  ],
  /* 短三和音を vi・ii・i と見る: vi → IV・V・I、ii → V7・V、i → iv・V7・v */
  min: [
    [8, 'M', 0.8],
    [5, '7', 0.7],
    [10, 'M', 0.6],
    [5, 'M', 0.5],
    [3, 'M', 0.5],
    [5, 'm', 0.4],
    [7, '7', 0.4],
    [7, 'm', 0.3],
  ],
  /* 短七を ii7・vi7 と見る: ii7 → V7・IM7、vi7 → IVM7・IM7・ii7 */
  min7: [
    [5, '7', 1],
    [10, 'M7', 0.5],
    [8, 'M7', 0.5],
    [3, 'M7', 0.4],
    [5, 'm7', 0.3],
    [7, 'm7', 0.2],
  ],
  /* 半減七を短調の ii と見る: V7 へ */
  hdim: [
    [5, '7', 1],
    [10, 'm', 0.2],
  ],
  /* 減七を導音の和音と見る: 半音上の I・i */
  dim: [
    [1, 'M', 1],
    [1, 'm', 0.8],
  ],
  /* 増三和音を V と見る: I、I → I+ → I6 の決まった流れ */
  aug: [
    [5, 'M', 0.8],
    [0, '6', 0.4],
    [9, 'm', 0.3],
  ],
};
const FAMILY: Record<string, Family> = {
  '7': 'dom',
  sus4: 'sus',
  '7sus4': 'sus7',
  m: 'min',
  m7: 'min7',
  m7b5: 'hdim',
  dim7: 'dim',
  aug: 'aug',
};

/** 次に続きやすいコード */
export interface Next {
  root: number;
  q: Quality;
  /** 重み（最も続きやすいものを 1 とする） */
  w: number;
}
/**
 * コード（根音 root、種類 q）の次に続きやすいコードを、重みの大きい順に。今のコードは除く。
 * 今のコードが M7 なら、続くコードも 7 の音を含む形にする（M → M7、ただし V は 7。m → m7）
 */
export function nextChords(root: number, q: Quality): Next[] {
  const sev = q.v === 'M7',
    acc = new Map<string, Next>();
  for (const [iv, v, w] of NEXT[FAMILY[q.v] ?? 'maj']) {
    const r = (root + iv) % 12,
      tv = sev && v === 'M' ? (iv === 7 ? '7' : 'M7') : sev && v === 'm' ? 'm7' : v;
    if (r === root && tv === q.v) continue;
    const k = `${r}:${tv}`,
      cur = acc.get(k);
    if (cur) cur.w += w;
    else acc.set(k, { root: r, q: qualityOf(tv), w });
  }
  const list = [...acc.values()].sort((a, b) => b.w - a.w),
    top = list[0]?.w ?? 1;
  for (const n of list) n.w /= top;
  return list;
}

/* ---------- 鳴っている音からコードを推定する ---------- */
/** 推定に使う音の数の下限（音名の種類） */
const GUESS_MIN = 3;
/**
 * 鳴っている音（MIDI のノート番号）から、コードを 1 つ推定する（第一候補だけ）。音名が 3 種類より少なければ null。
 * 根音と種類のすべての組み合わせに、含む音を足し、足りない音とコードにない音を引いた点を付け、
 * 最も低い音が根音なら足す。同じ点なら音の少ない種類、QUALITIES の順を選ぶ。
 * 省けない音が 2 つ以上足りない、またはコードにない音が 2 つ以上あるものは採らない
 */
export function guessChord(notes: readonly number[]): { root: number; q: Quality } | null {
  const pcs = new Set(notes.map((n) => ((n % 12) + 12) % 12));
  if (pcs.size < GUESS_MIN) return null;
  const bass = ((Math.min(...notes) % 12) + 12) % 12;
  let best: { root: number; q: Quality } | null = null,
    bestS = -Infinity;
  for (let root = 0; root < 12; root++)
    for (const q of QUALITIES) {
      const tones = new Set(q.iv.map((i) => (root + i) % 12)),
        miss = q.iv.filter((i) => !q.opt.includes(i) && !pcs.has((root + i) % 12)).length,
        missOpt = q.opt.filter((i) => !pcs.has((root + i) % 12)).length,
        hit = [...pcs].filter((p) => tones.has(p)).length,
        extra = pcs.size - hit;
      if (miss > 1 || extra > 1) continue;
      const s = 2 * hit - 2 * miss - 1.5 * missOpt - 2.5 * extra + (bass === root ? 1.5 : 0) - 0.1 * q.iv.length;
      if (s > bestS + 1e-9) {
        best = { root, q };
        bestS = s;
      }
    }
  return best;
}
