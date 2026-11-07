/**
 * カードの図柄（ToolCard の svg の中身。viewBox は 0 0 120 48）。
 * 図柄は時刻 t [s] の関数で、t = 0 が止まっているときの絵である。ビルド時に t = 0 を HTML に出し、
 * マウスを乗せている間だけブラウザで t を進めて描き直す（scripts/card-motion.ts）。
 * 線の class は site.css の .ic にある: a = ch1、b = ch2、c = 画面の線、d = 破線、t = 細線、g = 残像、
 * w = 黒鍵の太線、fa・fb・fc = 塗り、pl・pd・il・ih = SVG テーマの図柄の明るい地と暗い地とその線、
 * sn・sr・ml・md・mn・sk = 同じく太陽・光・昼の山・夜の山・月・星
 */
import { czaAlt, parDist, R22 } from '../tools/halo/labels';
import { fanPath } from '../tools/jjy/fan';
import { FEAT, PG2, PG3, PW2, PW3, Q_FIG } from '../tools/piano-action/geom';
import { OUTLINE as PA_OUT } from '../tools/piano-action/outline';
import { type Encoded, encode } from '../tools/qr-code/encode';
import {
  BODY_LEN,
  BRIDGE_M,
  CHINREST,
  crPts,
  FHOLE,
  OUTLINE,
  PEG,
  PEGBOX,
  PEGS,
  SCROLL,
  STR_NUT,
  STR_TAIL,
  STR_U,
} from '../tools/violin/shapes';

export type Art = (t: number) => string;

/** ソートの図柄のコマ: 配列・比べている位置・交換したか */
const SO_FRAMES: { a: readonly number[]; i: number; sw: boolean }[] = [];
function soFrames(): void {
  const a = [9, 3, 12, 6, 1, 14, 8, 4, 11, 2, 13, 7, 5, 10, 0, 15];
  SO_FRAMES.push({ a: [...a], i: -1, sw: false });
  for (let e = a.length - 1; e > 0; e--)
    for (let i = 0; i < e; i++) {
      const sw = a[i] > a[i + 1];
      if (sw) [a[i], a[i + 1]] = [a[i + 1], a[i]];
      SO_FRAMES.push({ a: [...a], i, sw });
    }
  /* 最後は並んだ絵のまま少し止める */
  for (let k = 0; k < 16; k++) SO_FRAMES.push({ a: [...a], i: -1, sw: false });
}

/** カードの QR コード（バージョン 1・M の「QR」。初めて描くときに作る） */
let qr0: Encoded | null = null;
function QR(): Encoded {
  if (!qr0) {
    const r = encode('QR', { ecc: 'M', ver: 1, mask: -1, mode: 'auto', boost: false });
    if ('err' in r) throw new Error(r.err);
    qr0 = r;
  }
  return qr0;
}

/** 二分ヒープの図柄のコマ: 配列・光らせる添字・動かしたか。空から全部追加して全部取り出す */
const HP_FRAMES: { a: readonly number[]; i: readonly number[]; w: boolean }[] = [];
function hpFrames(): void {
  const a: number[] = [],
    push = (i: readonly number[], w: boolean) => HP_FRAMES.push({ a: [...a], i, w });
  for (const v of [3, 6, 2, 7, 5, 1, 4]) {
    a.push(v);
    push([a.length - 1], true);
    for (let i = a.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      push([i, p], false);
      if (a[i] <= a[p]) break;
      [a[i], a[p]] = [a[p], a[i]];
      push([i, p], true);
      i = p;
    }
  }
  push([], false);
  push([], false);
  while (a.length) {
    push([0], false);
    const last = a.pop() as number;
    if (a.length) a[0] = last;
    push(a.length ? [0] : [], true);
    for (let i = 0; ; ) {
      const l = 2 * i + 1,
        b = l + 1 < a.length && a[l + 1] > a[l] ? l + 1 : l;
      if (l >= a.length) break;
      push([i, b], false);
      if (a[b] <= a[i]) break;
      [a[i], a[b]] = [a[b], a[i]];
      push([i, b], true);
      i = b;
    }
  }
  push([], false);
  push([], false);
}
/** 二分ヒープの図柄の 1 秒あたりのコマ数 */
const HP_FPS = 5;

/** B木の図柄のノード */
interface BtNode {
  k: number[];
  c: BtNode[];
}
/** B木の図柄の 1 コマ: hot は動かしたキー、w は書いたノードかあふれたノード */
interface BtFrame {
  root: BtNode;
  hot: readonly number[];
  w: readonly BtNode[];
}
const BT_FRAMES: BtFrame[] = [];
/** 次数 4 の B木へキーを順に入れる。全部入れたあと、同じコマを逆に再生して空へ戻す */
function btFrames(): void {
  const copy = (n: BtNode, map: Map<BtNode, BtNode>): BtNode => {
    const v: BtNode = { k: [...n.k], c: n.c.map((x) => copy(x, map)) };
    map.set(n, v);
    return v;
  };
  let root: BtNode = { k: [], c: [] };
  const push = (hot: readonly number[], w: readonly BtNode[]): void => {
    const map = new Map<BtNode, BtNode>(),
      r = copy(root, map);
    BT_FRAMES.push({ root: r, hot, w: w.map((x) => map.get(x) as BtNode) });
  };
  for (const key of [8, 3, 13, 6, 11, 1, 15, 9, 4, 14, 2, 12, 7, 10, 5]) {
    const path: BtNode[] = [];
    let n = root;
    while (n.c.length) {
      path.push(n);
      n = n.c[n.k.filter((v) => v < key).length];
    }
    n.k.splice(n.k.filter((v) => v < key).length, 0, key);
    push([key], [n]);
    while (n.k.length > 3) {
      push([], [n]);
      const mid = n.k.length >> 1,
        sep = n.k[mid],
        r: BtNode = { k: n.k.slice(mid + 1), c: n.c.slice(mid + 1) };
      n.k = n.k.slice(0, mid);
      n.c = n.c.slice(0, mid + 1);
      let p = path.pop();
      if (!p) {
        p = { k: [], c: [n] };
        root = p;
      }
      const i = p.c.indexOf(n);
      p.k.splice(i, 0, sep);
      p.c.splice(i + 1, 0, r);
      push([sep], [n, r, p]);
      n = p;
    }
  }
  push([], []);
  BT_FRAMES.push(...[...BT_FRAMES].reverse());
}
/** B木の図柄の 1 秒あたりのコマ数 */
const BT_FPS = 5;
/** 式の構文解析の図柄の字句の線: 幅 5・高さ 8 の箱の中心が原点 */
const EP_GLYPH: Record<string, [number, number][][]> = {
  '1': [
    [
      [-1, -2.5],
      [0.5, -4],
      [0.5, 4],
    ],
  ],
  '2': [
    [
      [-2.5, -4],
      [2.5, -4],
      [2.5, 0],
      [-2.5, 0],
      [-2.5, 4],
      [2.5, 4],
    ],
  ],
  '3': [
    [
      [-2.5, -4],
      [2.5, -4],
      [2.5, 4],
      [-2.5, 4],
    ],
    [
      [-2.5, 0],
      [2.5, 0],
    ],
  ],
  '4': [
    [
      [-2.5, -4],
      [-2.5, 0.5],
      [2.5, 0.5],
    ],
    [
      [2.5, -4],
      [2.5, 4],
    ],
  ],
  '+': [
    [
      [-2.6, 0],
      [2.6, 0],
    ],
    [
      [0, -2.6],
      [0, 2.6],
    ],
  ],
  '-': [
    [
      [-2.6, 0],
      [2.6, 0],
    ],
  ],
  x: [
    [
      [-2.2, -2.2],
      [2.2, 2.2],
    ],
    [
      [2.2, -2.2],
      [-2.2, 2.2],
    ],
  ],
};
/** 2 + 3 × 4 − 1 の字句。番号は左から 0〜6 */
const EP_TOK = ['2', '+', '3', 'x', '4', '-', '1'];
/** 木の親 → 子 */
const EP_KIDS: Record<number, readonly number[]> = { 1: [0, 3], 3: [2, 4], 5: [1, 6] };
/** 式の構文解析の図柄のコマ: 読んだ字句の数・木にした演算子・スタック・光らせる字句・木に足したか */
const EP_FRAMES: {
  read: number;
  made: readonly number[];
  stk: readonly number[];
  hot: readonly number[];
  w: boolean;
}[] = [
  { read: 0, made: [], stk: [], hot: [], w: false },
  { read: 1, made: [], stk: [], hot: [0], w: true },
  { read: 2, made: [], stk: [1], hot: [1], w: true },
  { read: 3, made: [], stk: [1], hot: [2], w: true },
  { read: 4, made: [], stk: [1], hot: [1, 3], w: false },
  { read: 4, made: [], stk: [1, 3], hot: [3], w: true },
  { read: 5, made: [], stk: [1, 3], hot: [4], w: true },
  { read: 6, made: [], stk: [1, 3], hot: [3, 5], w: false },
  { read: 6, made: [3], stk: [1], hot: [3], w: true },
  { read: 6, made: [3], stk: [1], hot: [1, 5], w: false },
  { read: 6, made: [3, 1], stk: [], hot: [1], w: true },
  { read: 6, made: [3, 1], stk: [5], hot: [5], w: true },
  { read: 7, made: [3, 1], stk: [5], hot: [6], w: true },
  { read: 7, made: [3, 1, 5], stk: [], hot: [5], w: true },
  { read: 7, made: [3, 1, 5], stk: [], hot: [], w: false },
  { read: 7, made: [3, 1, 5], stk: [], hot: [], w: false },
  { read: 7, made: [3, 1, 5], stk: [], hot: [], w: false },
];
/** 式の構文解析の図柄の 1 秒あたりのコマ数 */
const EP_FPS = 4;
/** 画像の拡大縮小の図柄のドット絵（屋根 a・壁 b・戸 c） */
const RZ_SPRITE = ['...aa...', '..aaaa..', '.aaaaaa.', 'aaaaaaaa', '.bbbbbb.', '.bbccbb.', '.bbccbb.', '.bbccbb.'];

const TAU = 2 * Math.PI;
const r1 = (v: number): number => Math.round(v * 10) / 10;
const mod = (a: number, n: number): number => ((a % n) + n) % n;
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const pl = (pts: [number, number][]): string => `M${pts.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}`;
/** y = g(x) を x0〜x1 の n 区間で折れ線にする */
const fx = (g: (x: number) => number, x0: number, x1: number, n: number): string => {
  const a: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    a.push([x, g(x)]);
  }
  return pl(a);
};
const P = (c: string, d: string, ex = ''): string => `<path class="${c}" d="${d}"${ex}/>`;
/** 整数ごとに決まる 0〜1 の擬似乱数（ノイズの図柄を毎回同じ形にする） */
const hn = (i: number): number => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
/** 折れ線を先頭から割合 r だけ描く */
function partial(pts: [number, number][], r: number): string {
  const out: [number, number][] = [pts[0]];
  let rest = 0;
  for (let i = 1; i < pts.length; i++) rest += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  rest *= clamp(r, 0, 1);
  for (let i = 1; i < pts.length && rest > 0; i++) {
    const [x0, y0] = pts[i - 1],
      [x1, y1] = pts[i],
      l = Math.hypot(x1 - x0, y1 - y0);
    out.push(rest >= l ? pts[i] : [x0 + ((x1 - x0) * rest) / l, y0 + ((y1 - y0) * rest) / l]);
    rest -= l;
  }
  return out.length > 1 ? pl(out) : '';
}

/** クラスタリングの図柄の点: 傾いた 2 つの塊 */
const GM_PTS: [number, number][] = [];
{
  const C = [
    [32, 26, 16, 6, 0.5],
    [84, 22, 15, 5, -0.55],
  ];
  for (let i = 0; i < 30; i++) {
    const q = C[i % 2],
      a = (hn(i * 11) * 2 - 1) * 1.6,
      b = (hn(i * 13 + 5) * 2 - 1) * 1.4;
    GM_PTS.push([
      q[0] + a * q[2] * Math.cos(q[4]) - b * q[3] * Math.sin(q[4]),
      q[1] + a * q[2] * Math.sin(q[4]) + b * q[3] * Math.cos(q[4]),
    ]);
  }
}
interface GmFrame {
  mu: [number, number][];
  S: [number, number, number][];
  lab: number[];
}
let gmF: GmFrame[] | null = null;
/** クラスタリングの図柄のコマ: 2 成分の EM を実際に回す（初めて描くときに作る） */
function gmFrames(): GmFrame[] {
  if (gmF) return gmF;
  let mu: [number, number][] = [
      [52, 18],
      [66, 30],
    ],
    S: [number, number, number][] = [
      [260, 0, 150],
      [260, 0, 150],
    ],
    w = [0.5, 0.5];
  const out: GmFrame[] = [];
  for (let it = 0; it < 14; it++) {
    const lab: number[] = [],
      R = GM_PTS.map((p) => {
        const v = mu.map((m, c) => {
            const [a, b, e] = S[c],
              det = a * e - b * b,
              u = p[0] - m[0],
              t = p[1] - m[1];
            return (w[c] / Math.sqrt(det)) * Math.exp(-0.5 * ((e * u * u - 2 * b * u * t + a * t * t) / det));
          }),
          sum = v[0] + v[1] || 1;
        lab.push(v[0] >= v[1] ? 0 : 1);
        return [v[0] / sum, v[1] / sum];
      });
    out.push({ mu: mu.map((m) => [m[0], m[1]]), S: S.map((s) => [s[0], s[1], s[2]]), lab });
    const N = [0, 1].map((c) => R.reduce((s, r) => s + r[c], 0));
    mu = [0, 1].map((c) => {
      let x = 0,
        y = 0;
      GM_PTS.forEach((p, i) => {
        x += R[i][c] * p[0];
        y += R[i][c] * p[1];
      });
      return [x / N[c], y / N[c]];
    }) as [number, number][];
    S = [0, 1].map((c) => {
      let a = 0,
        b = 0,
        e = 0;
      GM_PTS.forEach((p, i) => {
        const u = p[0] - mu[c][0],
          t = p[1] - mu[c][1];
        a += R[i][c] * u * u;
        b += R[i][c] * u * t;
        e += R[i][c] * t * t;
      });
      return [a / N[c] + 1, b / N[c], e / N[c] + 1];
    }) as [number, number, number][];
    w = N.map((v) => v / GM_PTS.length);
  }
  gmF = out;
  return out;
}
/** 共分散の楕円（1.6σ）の SVG パス */
function gmEllipse(m: [number, number], s: [number, number, number]): string {
  const [a, b, e] = s,
    t = (a + e) / 2,
    q = Math.sqrt(((a - e) / 2) ** 2 + b * b),
    l1 = 1.6 * Math.sqrt(t + q),
    l2 = 1.6 * Math.sqrt(Math.max(0.01, t - q)),
    ang = 0.5 * Math.atan2(2 * b, a - e),
    deg = r1((ang * 180) / Math.PI),
    x1 = m[0] - l1 * Math.cos(ang),
    y1 = m[1] - l1 * Math.sin(ang);
  return `M${r1(x1)} ${r1(y1)}A${r1(l1)} ${r1(l2)} ${deg} 1 0 ${r1(2 * m[0] - x1)} ${r1(2 * m[1] - y1)}A${r1(l1)} ${r1(l2)} ${deg} 1 0 ${r1(x1)} ${r1(y1)}Z`;
}

/* ---------- JJY: 1・0・マーカの秒（高出力の長さ 0.5・0.8・0.2 秒） ---------- */
const hiLen = (c: string): number => (c === 'P' ? 0.2 : c === '1' ? 0.5 : 0.8);
/** 符号の列 code を 1 秒 = S で並べたとき、位置 u が高出力か */
const jjyHi = (code: string, S: number, u: number): boolean => {
  const k = Math.floor(u / S);
  return (u - k * S) / S < hiLen(code[mod(k, code.length)]);
};

/** 符号の列を、高出力 yh・低出力 yl の矩形波にする（off だけ左へずらす） */
const jjySteps = (code: string, S: number, off: number, yh: number, yl: number): string => {
  const lv = (u: number): number => (jjyHi(code, S, u) ? yh : yl);
  let d = `M4 ${lv(4 + off)}`;
  for (let k = Math.floor((4 + off) / S); k * S - off < 116; k++)
    for (const e of [k * S, k * S + hiLen(code[mod(k, code.length)]) * S]) {
      const x = e - off;
      if (x > 4 && x < 116) d += `H${r1(x)}V${lv(e + 1e-6)}`;
    }
  return `${d}H116`;
};

/* ---------- ノイズ: 7 ビットの LFSR（帰還は b6 ⊕ b5、最大周期 127） ---------- */
const LFSR = (() => {
  let s = [1, 0, 0, 1, 0, 1, 1];
  const st: number[][] = [],
    out: number[] = [];
  for (let i = 0; i < 127; i++) {
    st.push(s);
    out.push(s[6]);
    s = [s[6] ^ s[5], ...s.slice(0, 6)];
  }
  return { st, out };
})();

/* ---------- ギター: 弦長 87 のフレット（12 平均律） ---------- */
const fret = (n: number): number => 14 + 87 * (1 - 2 ** (-n / 12));

/* ---------- ピアノ: 上から見たグランドの、弦の奥の端 ---------- */
const ptop = (x: number): number => 4 + 26 * ((x - 4) / 112) ** 1.5;

/*
 * ---------- ピアノのアクション: ページの横から見た図（部品の外形は mm、y は上向き）を 0.245 倍にしたもの ----------
 * 高さは弦から鍵の下までで決まるので、横は鍵の後ろの端（x = −236 mm）をカードの x = 5 に置き、鍵の前の端を少し切る。
 * 鍵の支点の高さは y = 45。外形の数は mm の整数に丸める（カードでは 1 mm が 0.3 px ほどなので、形は変わらない）
 */
const PA = (() => {
  const k = 0.245,
    X0 = 5 + 236 * k,
    Y0 = 45,
    mm = (p: readonly number[]): [number, number] => [p[0] * 1000, p[1] * 1000],
    out = Object.fromEntries(
      Object.entries(PA_OUT).map(([b, d]) => [b, d.replace(/-?\d+\.\d+/g, (m) => String(Math.round(Number(m))))]),
    ) as Record<keyof typeof PA_OUT, string>,
    /* ハンマーの頭の上端の高さ [mm]。弦は、静止の頭の上端から打弦距離 48 mm（ページの標準）の高さ */
    hd = FEAT.Ph4.f as { p: readonly [number, number]; r: number },
    head = (a: number): number => (PG3[1] + hd.p[0] * Math.sin(a) + hd.p[1] * Math.cos(a) + hd.r) * 1000;
  return {
    k,
    X0,
    Y0,
    out,
    g2: mm(PG2),
    g3: mm(PG3),
    w2: mm(PW2),
    w3: mm(PW3),
    str: head(Q_FIG[4]) + 48,
    /** 弦の端（アグラフ）の x [mm] */
    agr: -138,
  };
})();
const paRot = (a: number, [x, y]: [number, number]): [number, number] => [
  x * Math.cos(a) - y * Math.sin(a),
  x * Math.sin(a) + y * Math.cos(a),
];
/** 0〜1 をなめらかに（両端で速さ 0） */
const ease = (v: number): number => {
  const c = clamp(v, 0, 1);
  return c * c * (3 - 2 * c);
};

/* ---------- エンジン: 内径 50・行程 63.1・連接棒 100 mm の比の単気筒 ---------- */
const EN = { cx: 22, cy: 35, r: 4, l: 12.7 };
const pinY = (th: number): number => EN.cy - (EN.r * Math.cos(th) + Math.sqrt(EN.l ** 2 - (EN.r * Math.sin(th)) ** 2));
/** 排気の圧力。deg はクランク角 [°]（0 = 燃焼の上死点）。排気弁は 140° で開く */
const exhP = (deg: number): number => {
  const ph = mod(deg - 140, 720),
    q = mod(ph - 200, 720);
  return Math.exp(-ph / 90) * Math.sin(ph / 14) + 0.25 * Math.exp(-q / 60) * Math.sin(q / 10);
};

/*
 * ---------- ヴァイオリン: ページの「上から」の図と同じ形（渦巻きの先を左、E 線を上）を縮めたもの ----------
 * 長さは渦巻きの先からの mm。弓は A 線を駒から 0.1 の位置で擦る
 */
const VN = (() => {
  const scr = Math.max(...SCROLL.map((q) => q[0])),
    nut = scr + PEGBOX.len,
    top = nut + 130,
    k = 112 / (top + BODY_LEN),
    X = (mm: number): number => 4 + mm * k,
    Y = (w: number): number => 24 - w * k,
    /** 胴の上端からの m・中心からの h */
    B = (m: number, h: number): [number, number] => [X(top + m), Y(h)],
    loop = (pts: [number, number][]): string => `${pl(pts)}Z`,
    /** n 点ごとに間引く（カードは小さいので、細かい点は要らない） */
    every = <T>(pts: T[], n: number): T[] => pts.filter((_, i) => i % n === 0),
    half = (o: number[][]): [number, number][] => {
      const p = crPts(o, 2);
      return p
        .map(([m, h]) => B(m, h))
        .concat(
          p
            .slice(0, -1)
            .reverse()
            .map(([m, h]) => B(m, -h)),
        );
    },
    /* 弦の間は上駒のあたりを少し広げる（細い線が重ならないように） */
    sNut = (i: number): [number, number] => [X(nut), Y(STR_NUT[i] * 1.3)],
    sBr = (i: number): [number, number] => B(BRIDGE_M, STR_U[i]),
    sTail = (i: number): [number, number] => B(244, STR_TAIL[i]),
    wall = (d: number): number => PEGBOX.w0 - ((PEGBOX.w0 - PEGBOX.w1) * d) / PEGBOX.len;
  let pegs = '';
  for (const g of PEGS) {
    const sg = g.s <= 1 ? 1 : -1,
      x = X(nut - g.d),
      w = wall(g.d);
    pegs += loop(every(PEG, 2).map(([a, c]): [number, number] => [x + c * k, Y(sg * (w + a))]));
  }
  const fh = [1, -1].map((sg) => loop(every(FHOLE, 3).map(([m, h]) => B(m, sg * h)))).join(''),
    board = `M${r1(X(nut))} ${r1(Y(12))}L${r1(X(nut + 270))} ${r1(Y(21))}Q${r1(X(nut + 273.5))} 24 ${r1(X(nut + 270))} ${r1(Y(-21))}L${r1(X(nut))} ${r1(Y(-12))}Z`,
    box = `M${r1(X(nut))} ${r1(Y(PEGBOX.w0))}L${r1(X(scr))} ${r1(Y(PEGBOX.w1))}V${r1(Y(-PEGBOX.w1))}L${r1(X(nut))} ${r1(Y(-PEGBOX.w0))}Z`,
    [tx0] = B(244, 0),
    [tx1] = B(343, 0),
    tail = `M${r1(tx0 + 0.7)} ${r1(Y(20))}L${r1(tx1 - 1)} ${r1(Y(11))}Q${r1(tx1 + 0.6)} 24 ${r1(tx1 - 1)} ${r1(Y(-11))}L${r1(tx0 + 0.7)} ${r1(Y(-20))}Q${r1(tx0 - 0.5)} 24 ${r1(tx0 + 0.7)} ${r1(Y(20))}Z`,
    [bx] = B(BRIDGE_M, 0),
    other = [0, 2, 3].map((i) => pl([sNut(i), sBr(i), sTail(i)])).join(''),
    still =
      P('c', loop(half(OUTLINE))) +
      P('c t', fh + loop(every(CHINREST, 2).map(([m, h]) => B(m, -h)))) +
      P('c', box + loop(every(SCROLL, 3).map(([d, w]): [number, number] => [X(scr - d), Y(w)]))) +
      P('c t', pegs) +
      P('c', `${board}${tail}M${r1(bx)} ${r1(Y(22.5))}V${r1(Y(-22.5))}`) +
      P('c t', other + pl([sBr(1), sTail(1)]));
  return {
    still,
    k,
    /** 弓の毛の位置（駒から A 線の長さ 328 mm の 0.1） */
    bow: X(top + BRIDGE_M - 32.8),
    a0: sNut(1),
    a1: sBr(1),
  };
})();
/**
 * 弓（上から見た形。lat は毛からの横のずれ [カードの単位]、s は毛の元から先へ [mm]）: 棹・毛箱・ねじ・頭。
 * 横のずれは見えるように実物より広げてある
 */
const BOW_STICK = -2.4,
  BOW_FROG: [number, number][] = [
    [1.4, 0],
    [1.4, -47],
    [0.6, -50],
    [-4, -50],
    [-4, 0],
  ],
  BOW_BUTTON: [number, number][] = [
    [-1.2, -66],
    [-1.2, -83],
    [-3.6, -83],
    [-3.6, -66],
  ],
  BOW_HEAD: [number, number][] = [
    [1.4, 650],
    [-3.6, 644],
    [-4, 662],
    [-2.6, 676],
    [0.4, 674],
    [1.4, 662],
  ];
/** 弓の 1 往復のうち、片道の位置（0〜1）と速さ（0〜1）。返すところは片道の 8 % で速さを上げ下げする */
const bowStroke = (u: number): { pos: number; v: number } => {
  const r = 0.08,
    v = Math.min(1, u / r, (1 - u) / r),
    p = u < r ? (u * u) / (2 * r) : u > 1 - r ? 1 - r - ((1 - u) * (1 - u)) / (2 * r) : u - r / 2;
  return { pos: p / (1 - r), v };
};

/** 分岐図の図柄の地（周期 1〜8 の枝の線とカオスの点。初めて描くときに作る） */
let bf0 = '';
function BF(): string {
  if (bf0) return bf0;
  const X = (r: number): number => 4 + (112 * (r - 2.9)) / 1.1,
    Y = (x: number): number => 44 - 40 * x,
    orb = (r: number, p: number): number[] => {
      let x = 0.3;
      for (let i = 0; i < 6000; i++) x = r * x * (1 - x);
      const o: number[] = [];
      for (let i = 0; i < p; i++) {
        x = r * x * (1 - x);
        o.push(x);
      }
      return o.sort((a, b) => a - b);
    };
  /* 周期 p の区間 [a, b]。端は収束が遅いので少し内側から */
  const SEG: [number, number, number][] = [
    [2.9, 3, 1],
    [3, 1 + Math.sqrt(6), 2],
    [1 + Math.sqrt(6), 3.5441, 4],
    [3.5441, 3.5644, 8],
  ];
  let line = '';
  for (const [a, b, p] of SEG) {
    const n = Math.max(2, Math.round((X(b) - X(a)) / 2)),
      br: [number, number][][] = Array.from({ length: p }, () => []);
    for (let i = 0; i <= n; i++) {
      const r = a + 0.002 + ((b - a - 0.004) * i) / n,
        o = orb(r, p);
      for (let k = 0; k < p; k++) br[k].push([X(r), Y(o[k])]);
    }
    line += br.map(pl).join('');
  }
  let dot = '';
  for (let c = X(3.5644) + 1.2; c <= 116; c += 1.2) {
    const r = 2.9 + (1.1 * (c - 4)) / 112;
    let x = 0.3;
    for (let i = 0; i < 400; i++) x = r * x * (1 - x);
    for (let i = 0; i < 16; i++) {
      x = r * x * (1 - x);
      dot += `M${r1(c)} ${r1(Y(x))}h0`;
    }
  }
  bf0 = P('c t', line) + P('c t', dot);
  return bf0;
}

/* ---------- PNG: 山・塔・地面の絵。1 = 山と地面、2 = 塔、0 = 空 ---------- */
const PNG_W = 16;
const PNG_H = 10;
const PNG_PIC: readonly (readonly number[])[] = Array.from({ length: PNG_H }, (_, r) =>
  Array.from({ length: PNG_W }, (_, c) => {
    const u = (c + 0.5) / PNG_W,
      v = (r + 0.5) / PNG_H;
    if (v >= 0.86) return 1;
    if (u >= 0.64 && u < 0.84 && v >= 0.3) return 2;
    return v >= 0.1 + Math.abs(u - 0.3) * 1.9 ? 1 : 0;
  }),
);
/** 行ごとに左との差と上との差を取り、0 でない数が少ないほうを残す。raw は差を取る前の 0 でない数 */
const PNG_ROWS = PNG_PIC.map((row, r) => {
  const sub = row.map((x, c) => (c ? row[c - 1] : 0) !== x),
    up = row.map((x, c) => (r ? PNG_PIC[r - 1][c] : 0) !== x),
    count = (a: boolean[]): number => a.filter(Boolean).length;
  return {
    dif: count(up) < count(sub) ? up : sub,
    raw: row.filter(Boolean).length,
  };
});

/**
 * ADPCM の図柄の波と段階。小さい音が急に大きくなる波を小さな ADPCM で追う。
 * 16 段階は線が重なるので 5 段に割り切り、間隔は表の代わりに 2 倍と 0.88 倍で変える
 */
const ADP = (() => {
  const LEN = 72,
    FROM = 19,
    COLS = 19,
    x = Array.from(
      { length: LEN },
      (_, n) => (n < 24 ? 0.1 : 0.95 * Math.exp(-(n - 24) / 40)) * Math.sin((TAU * n) / 12),
    ),
    p = new Array<number>(LEN),
    y = new Array<number>(LEN),
    g = new Array<number>(LEN);
  let last = 0,
    gap = 0.03;
  /* 間隔が落ち着くまで 3 周流す */
  for (let pass = 0; pass < 3; pass++)
    for (let n = 0; n < LEN; n++) {
      const q = Math.max(-2, Math.min(2, Math.round((x[n] - last) / gap)));
      p[n] = last;
      g[n] = gap;
      last += q * gap;
      y[n] = last;
      gap = Math.abs(q) === 2 ? Math.min(0.22, gap * 2) : Math.max(0.018, gap * 0.88);
    }
  const cut = (a: number[]) => a.slice(FROM, FROM + COLS);
  return { x: cut(x), p: cut(p), y: cut(y), g: cut(g) };
})();

/* ---------- マクスウェルの悪魔: 箱の中の分子を悪魔がより分けるコマ ---------- */
const MX = { x0: 4, x1: 116, y0: 16, y1: 46, gap: 14, n: 12, r: 2, L: 5, fps: 12 };
interface MxFrame {
  /** 分子 [x, y, 速いか] */
  p: [number, number, boolean][];
  /** 扉: 0 閉、1 右へ開く、-1 左へ開く */
  open: number;
}
/**
 * 分子どうしはぶつからない。速い分子は右へ、遅い分子は左へだけ扉を通す。最後の 0.5 秒は止める。
 * 乱数の種 34 は、最後のコマで 12 個中 11 個が正しい側に並ぶものを選んだ
 */
const MX_FRAMES: MxFrame[] = (() => {
  const { x0, x1, y0, y1, gap, n, r, L, fps } = MX,
    mid = (x0 + x1) / 2,
    yc = (y0 + y1) / 2;
  let sd = 34;
  const R = (): number => {
    sd ^= sd << 13;
    sd >>>= 0;
    sd ^= sd >>> 17;
    sd ^= sd << 5;
    sd >>>= 0;
    return sd / 4294967296;
  };
  const ps: { x: number; y: number; vx: number; vy: number; fast: boolean; side: number }[] = [];
  for (let i = 0; i < n; i++) {
    const fast = i % 2 === 0,
      side = (i >> 1) % 2,
      sp = fast ? 46 + 10 * R() : 15 + 6 * R(),
      a = 2 * Math.PI * R();
    ps.push({
      x: side ? mid + r + 1 + R() * (x1 - mid - 2 * r - 2) : x0 + r + 1 + R() * (mid - x0 - 2 * r - 2),
      y: y0 + r + R() * (y1 - y0 - 2 * r),
      vx: sp * Math.cos(a),
      vy: sp * Math.sin(a),
      fast,
      side,
    });
  }
  const out: MxFrame[] = [],
    sub = 8,
    dt = 1 / fps / sub,
    nf = Math.round(L * fps),
    still = Math.round(0.5 * fps);
  let open = 0;
  for (let f = 0; f < nf; f++) {
    out.push({ p: ps.map((q) => [q.x, q.y, q.fast]), open });
    open = 0;
    if (f >= nf - still - 1) continue;
    for (let k = 0; k < sub; k++)
      for (const q of ps) {
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        if (q.x < x0 + r) {
          q.x = x0 + r;
          q.vx = Math.abs(q.vx);
        } else if (q.x > x1 - r) {
          q.x = x1 - r;
          q.vx = -Math.abs(q.vx);
        }
        if (q.y < y0 + r) {
          q.y = y0 + r;
          q.vy = Math.abs(q.vy);
        } else if (q.y > y1 - r) {
          q.y = y1 - r;
          q.vy = -Math.abs(q.vy);
        }
        const hit = q.side === 0 ? q.x > mid - r && q.vx > 0 : q.x < mid + r && q.vx < 0;
        if (!hit) continue;
        const ok = Math.abs(q.y - yc) < gap / 2 - r * 0.6 && (q.side === 0 ? q.fast : !q.fast);
        if (ok) {
          q.side = 1 - q.side;
          open = q.side === 1 ? 1 : -1;
          q.x = q.side ? mid + r : mid - r;
        } else {
          q.vx = -q.vx;
          q.x = q.side ? mid + r : mid - r;
        }
      }
  }
  return out;
})();
/** 円のパス（塗り用） */
const mxDot = (x: number, y: number, r: number): string =>
  `M${r1(x - r)} ${r1(y)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
/**
 * I2C の図柄の列: 1 回の通信を 1/4 ビット刻みの High・Low にする（開始・アドレス 0x48 書き込み・ACK・データ・ACK・終了）。
 * who は SDA を下げている機器（0 マスタ、2 宛先のスレーブ、-1 誰も）
 */
const I2C = (() => {
  const scl: number[] = [],
    sda: number[] = [],
    who: number[] = [];
  const push = (c: number, d: number, w = 0) => {
    scl.push(c);
    sda.push(d);
    who.push(d ? -1 : w);
  };
  for (let k = 0; k < 6; k++) push(1, 1);
  push(1, 0);
  push(1, 0);
  let prev = 0;
  const bit = (b: number, w = 0) => {
    push(0, prev, w);
    push(0, b, w);
    push(1, b, w);
    push(1, b, w);
    prev = b;
  };
  for (const v of [0x90, 0x2a]) {
    for (let k = 7; k >= 0; k--) bit((v >> k) & 1);
    bit(0, 2);
  }
  push(0, prev);
  push(0, 0);
  push(1, 0);
  push(1, 0);
  for (let k = 0; k < 8; k++) push(1, 1);
  return { scl, sda, who };
})();
/** 1 秒に進む 1/4 ビットの数と、見えている数 */
const I2C_QPS = 12,
  I2C_N = 40;
/** 列を階段の線にする（i0 から n 個） */
const i2cLine = (a: readonly number[], i0: number, yH: number, yL: number): string => {
  const dx = 112 / I2C_N;
  let d = '';
  for (let k = 0; k < I2C_N; k++) {
    const y = a[mod(i0 + k, a.length)] ? yH : yL,
      x = 4 + k * dx;
    d += `${k ? 'L' : 'M'}${r1(x)} ${y}L${r1(x + dx)} ${y}`;
  }
  return d;
};

export const ART: Record<string, Art> = {
  /* タイマIC 555: 出力（周期 36、High 24）と C1 の電圧。時間が流れる */
  sq(t) {
    const s = t * 30,
      p4 = mod(4 - 16 + s, 36);
    let hi = p4 < 24,
      x = 4 + (hi ? 24 - p4 : 36 - p4),
      d = `M4 ${hi ? 10 : 38}`;
    for (; x < 116; x += hi ? 24 : 12) {
      hi = !hi;
      d += `H${r1(x)}V${hi ? 10 : 38}`;
    }
    d += 'H116';
    const v = (x: number): number => {
      const p = mod(x - 16 + s, 36);
      return p < 24 ? 1 - (2 / 3) * 2 ** (-p / 24) : (2 / 3) * 2 ** (-(p - 24) / 12);
    };
    return (
      P('a', d) +
      P(
        'b',
        fx((x) => 31 - 42 * (v(x) - 1 / 3), t ? 4 : 16, 116, t ? 112 : 100),
      )
    );
  },
  /* 受動素子組み合わせ: 配線を電流が流れる */
  rr(t) {
    return (
      P(
        'c',
        'M4 24H22M46 24H60M60 12V36M60 12H70M94 12H106M60 36H70M94 36H106M106 12V36M106 24H116',
        t ? ` stroke-dasharray="4 3" stroke-dashoffset="${r1(-t * 14)}"` : '',
      ) +
      '<rect class="a" x="22" y="18" width="24" height="12"/><rect class="a" x="70" y="6" width="24" height="12"/><rect class="b" x="70" y="30" width="24" height="12"/>'
    );
  },
  /* PID 制御: 減衰比が変わり、行き過ぎが増減する */
  pid(t) {
    const z = 0.32 + 0.22 * Math.sin(t * 1.6),
      w = 0.17,
      q = Math.sqrt(1 - z * z);
    const y = (x: number): number => {
      const u = x - 18;
      return u < 0 ? 40 : 40 - 23 * (1 - Math.exp(-z * w * u) * (Math.cos(w * q * u) + (z / q) * Math.sin(w * q * u)));
    };
    return P('c d', 'M4 17H116') + P('a', fx(y, 4, 116, 112));
  },
  /* 倒立振子: 振子が揺れ、台車が支える。右は角度の履歴 */
  ip(t) {
    const th = (s: number): number => 0.3 * Math.sin((t - s) * 2.4),
      a = th(0) + 0.43,
      px = 60 + 5 * (Math.sin(t * 2.4 + 0.6) - Math.sin(0.6));
    return (
      P('c', 'M4 42H116') +
      P('c', `M${r1(px - 14)} 30H${r1(px + 14)}V38H${r1(px - 14)}Z`) +
      P('c d', `M${r1(px)} 30V4`) +
      P('a', `M${r1(px)} 30L${r1(px + 26 * Math.sin(a))} ${r1(30 - 26 * Math.cos(a))}`) +
      P(
        'b',
        fx((x) => 18 - 14 * th((116 - x) * 0.04), 84, 116, 32),
      )
    );
  },
  /* カルマンフィルタ: 予測（破線）と観測の山を掛け合わせた推定の山。観測が左右に動くと推定も寄る */
  kf(t) {
    const g = (m: number, s: number, h: number) => (x: number) => 44 - h * Math.exp(-0.5 * ((x - m) / s) ** 2);
    const mp = 48,
      sp = 13,
      mz = 70 + 10 * Math.sin(t * 1.4),
      sz = 9,
      K = (sp * sp) / (sp * sp + sz * sz),
      me = mp + K * (mz - mp),
      se = Math.sqrt((1 - K) * sp * sp);
    return (
      P('c', 'M4 44H116') +
      P('c d', fx(g(mp, sp, 18), 4, 116, 56)) +
      P('b', fx(g(mz, sz, 26), 4, 116, 56)) +
      P('a', fx(g(me, se, Math.min(38, (18 * sp) / se)), 4, 116, 80))
    );
  },
  /* 双2次フィルタ: 遮断周波数が動く */
  bq(t) {
    const lp = (r: number, Q: number): number => -10 * Math.log10((1 - r * r) ** 2 + (r / Q) ** 2);
    const c = 10 ** (0.35 * Math.sin(t * 1.3)),
      F = (x: number): number => 10 ** (((x - 4) / 112) * 3 - 1.4) / c;
    return (
      P('c d', 'M4 24H116') +
      P(
        'a',
        fx((x) => Math.min(44, 12 - 0.55 * lp(F(x), 1.5)), 4, 116, 56),
      ) +
      P(
        'b',
        fx((x) => Math.min(44, 30 - 0.42 * lp(F(x) * 1.6, 0.5)), 4, 116, 56),
      )
    );
  },
  /* IIR フィルタ: 通過域の端が規格の中で動く */
  iir(t) {
    return (
      P('c d', 'M4 16H58V44M66 4V34H116') +
      `<g${t ? ` transform="translate(${r1(3 * Math.sin(t * 1.5))} 0)"` : ''}>` +
      P(
        'a',
        'M4 11C9 11 11 14 16 14S24 10 30 10S38 14 44 14S52 10 56 11C59 12 60 26 64 44C66 38 68 35 72 35S78 40 80 44C82 39 85 35 92 35S104 37 116 38',
      ) +
      '</g>'
    );
  },
  /* JJY シミュレータ: 秒の扇と、1・0・マーカで塗り分けたタイムコード。扇はページと同じく、
     偶数の秒で 12 時から時計回りに開き、奇数の秒で同じ向きに閉じる。今の秒の枠が進む */
  jjy(t) {
    const u = t + 0.55,
      sec = Math.floor(u),
      fan = fanPath(u * 1000);
    let s = `<g transform="translate(16 24) scale(1.1)"><circle class="c" r="9"/>${fan ? `<path class="fa" d="${fan}"/>` : ''}</g>`;
    const C = 'P0110100M01001';
    for (let i = 0; i < C.length; i++) {
      const x = 33 + i * 6,
        c = C[i];
      if (c === 'P' || c === 'M')
        s +=
          `<rect class="c t" x="${x + 0.5}" y="11.5" width="3" height="25"/>` +
          P('c t', `M${x} 19L${x + 4} 15M${x} 27L${x + 4} 23M${x} 35L${x + 4} 31`);
      else s += `<rect class="${c === '1' ? 'fa' : 'fb'}" x="${x}" y="11" width="4" height="26"/>`;
      if (i === sec % C.length) s += `<rect class="c" x="${r1(x - 1.6)}" y="8" width="7.2" height="32" rx="1"/>`;
    }
    return s;
  },
  /* JJY デコーダ: 受けた信号と復号したビットが流れる */
  jjyd(t) {
    const S = 14,
      off = t * 21,
      CODE = 'P1001011010';
    const b: [number, number][] = [];
    for (let x = 4; x <= 116; x++) {
      const u = x + off,
        z = mod(Math.floor(u), 2) ? 1 : -1;
      b.push([x, 16 + (jjyHi(CODE, S, u) ? 9 : 1.5) * z]);
    }
    return P('b', pl(b)) + P('a', jjySteps(CODE, S, off - 3, 33, 43));
  },
  /* QR コード: バージョン 1 の QR コードの上をしみが動き、しみのかかった符号語（右の 26 本）が伸びる */
  qr(t) {
    const q = QR(),
      n = q.n,
      cx = 25 + 15 * Math.sin(t * 0.9),
      cy = 24 + 9 * Math.cos(t * 1.35),
      hit = new Set<number>();
    let d = '';
    for (let i = 0; i < n * n; i++)
      if (q.cwAt[i] >= 0 && Math.hypot(5 + (i % n) * 2 - cx, 4 + Math.floor(i / n) * 2 - cy) < 6.5) hit.add(q.cwAt[i]);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (!q.mods[y * n + x]) continue;
        let w = 1;
        while (x + w < n && q.mods[y * n + x + w]) w++;
        d += `M${4 + x * 2} ${3 + y * 2}h${w * 2}v2h-${w * 2}z`;
        x += w - 1;
      }
    let bars = '',
      lo = '';
    q.cw.forEach((_, c) => {
      const x = r1(57 + c * 2.25 + (q.src[c].ec ? 2.5 : 0));
      if (hit.has(c)) bars += `M${x} 40V10`;
      else lo += `M${x} 40V33`;
    });
    return (
      P('fc', d) +
      `<circle class="fa g" cx="${r1(cx)}" cy="${r1(cy)}" r="6.5"/>` +
      P('c t', lo) +
      P('a', bars || 'M57 40H57') +
      P('c d', 'M55 44H116')
    );
  },
  /* FIR フィルタ: 遮断周波数が変わり、係数（窓をかけた sinc）と特性の幅が変わる */
  fir(t) {
    const fc = 0.2 + 0.08 * Math.sin(t * 1.8);
    let d = '';
    for (let k = 0; k < 13; k++) {
      const n = k - 6,
        h = n === 0 ? 2 * fc : Math.sin(TAU * fc * n) / (Math.PI * n),
        w = 0.54 + 0.46 * Math.cos((Math.PI * n) / 6.5);
      d += `M${12 + 8 * k} 34V${r1(34 - (26 * h * w) / 0.4)}`;
    }
    const sg = 4.4 / fc,
      top = 34 - (26 * 2 * fc) / 0.4;
    return (
      P('c d', 'M4 34H116') +
      P(
        'b',
        fx((x) => 34 - (34 - top) * Math.exp(-(((x - 60) / sg) ** 2)), 4, 116, 56),
      ) +
      P('a', d)
    );
  },
  /* 極と零点: 極の対が単位円の近くを動く */
  pz(t) {
    const ang = (3 * Math.PI) / 4 + 0.32 * Math.sin(t * 1.4),
      r = 18 - 2 * (1 - Math.cos(t * 2.1)),
      x = r1(60 + r * Math.cos(ang)),
      y = r * Math.sin(ang);
    return (
      P('c d', 'M32 24H88M60 2V46') +
      '<circle class="c" cx="60" cy="24" r="18"/>' +
      P('a', 'M66 12L72 18M66 18L72 12M66 30L72 36M66 36L72 30') +
      `<circle class="b" cx="${x}" cy="${r1(24 - y)}" r="3.5"/><circle class="b" cx="${x}" cy="${r1(24 + y)}" r="3.5"/>`
    );
  },
  /* 抵抗カラーコード: 色帯を 1 本ずつ読む */
  cc(t) {
    const k = t ? Math.floor(t * 2.5) % 5 : -1;
    return (
      P('c', 'M4 24H30M90 24H116') +
      '<rect class="c" x="30" y="14" width="60" height="20" rx="8"/>' +
      [42, 52, 62, 78]
        .map((x, i) =>
          P(i === 3 ? 'b' : 'a', i === k ? `M${x} 11V37` : `M${x} 14V34`, i === k ? ' style="stroke-width:4"' : ''),
        )
        .join('')
    );
  },
  /* オシロスコープ: CH1 はトリガがかかって止まり、CH2 は流れる */
  os(t) {
    return (
      P('c d', 'M4 24H116') +
      P(
        'a',
        fx((x) => 24 - 12.6 * Math.sin((TAU * (x - 4)) / 36), 4, 112, 54),
      ) +
      P(
        'b',
        fx((x) => 30 - 9.7 * Math.sin((TAU * (x - 4 + t * 17)) / 48), 4, 116, 56),
      )
    );
  },
  /* スペクトラムアナライザ: 測るたびにピークと雑音の床がゆらぐ。ゆらぎは 2 秒（24 回）でくり返す */
  sp(t) {
    const T = Math.floor(t * 12) % 24,
      pk = [
        [22, 32],
        [44, 15],
        [67, 9],
        [91, 6],
      ];
    return (
      P('c d', 'M4 44H116') +
      P(
        'a',
        fx(
          (x) => {
            let y = 41 + (x - 4) * 0.018 + (t ? 1.6 * (hn(x * 3.1 + T * 17) - 0.5) : 0);
            pk.forEach(([px, h], j) => {
              y -= h * (t ? 0.75 + 0.5 * hn(T * 7 + j) : 1) * Math.exp(-(((x - px) / 1.8) ** 2));
            });
            return Math.min(44, y);
          },
          4,
          116,
          112,
        ),
      )
    );
  },
  /* FM 音源: 変調指数が変わり、波形が変わる */
  fm(t) {
    const I = 2.2 + 1.2 * Math.sin(t * 1.5);
    return (
      P('c d', 'M4 24H116') +
      P(
        'a',
        fx(
          (x) => {
            const p = (TAU * (x - 4)) / 56;
            return 24 - 15 * Math.sin(p + I * Math.sin(p));
          },
          4,
          116,
          112,
        ),
      )
    );
  },
  /* ドップラー効果: 道路を右へ走る音源（マッハ 0.5）の波面。前で詰まり後ろで広がる。波面はストロボのようにゆっくり広がる */
  dp(t) {
    const g = 8,
      ph = mod(t / 1.2, 1),
      sx = 78;
    let s = P('c d', 'M4 24H116');
    for (let k = 0; k < 7; k++) {
      const a = (k + ph) * g,
        u = (k + ph) / 7;
      s += `<circle class="b" cx="${r1(sx - 0.5 * a)}" cy="24" r="${r1(a)}" opacity="${r1(Math.min(1, u * 8) * (1 - u))}"/>`;
    }
    return `${s}<path class="fc" d="M${sx - 4} 22h8v4h-8Z"/><circle class="fa" cx="104" cy="38" r="2.2"/>`;
  },
  /* ノイズジェネレータ: ホワイトノイズの波形と、LFSR のセル・⊕ の帰還・出力のビット列。ビットが 1 つずつ送られる */
  nz(t) {
    const k = Math.floor(t / 0.2),
      wave: [number, number][] = [];
    for (let i = 0; i <= 56; i++) wave.push([4 + i * 2, 14 + 18 * (hn(i + k * 3) - 0.5)]);
    let s = P('a', pl(wave));
    LFSR.st[k % 127].forEach((b, i) => {
      const x = 9 + i * 8;
      if (b) s += `<rect class="fc" x="${x + 1}" y="34" width="5" height="6"/>`;
      s += `<rect class="c t" x="${x}" y="33" width="7" height="8"/>`;
    });
    s +=
      P('c t', 'M60.5 33V28.5H55M52.5 33V31M50 28.5H4V37H9M65 37H70M52.5 26V31M50 28.5H55') +
      '<circle class="c t" cx="52.5" cy="28.5" r="2.5"/>';
    const bits: [number, number][] = [];
    for (let j = 0; j < 12; j++) {
      const y = LFSR.out[mod(k - 1 - j, 127)] ? 33 : 41,
        x = 71 + j * 3.8;
      bits.push([x, y], [x + 3.8, y]);
    }
    return s + P('b', pl(bits));
  },
  /* ギター音響モデル: 横に倒したギター。5 フレットを押さえた 1 本を弾き、振れて減衰する */
  gt(t) {
    let s = P(
      'c',
      'M60 24C60 13 64 9 72 9C79 9 81 12 86 12C91 12 93 4 102 4C112 4 116 13 116 24C116 35 112 44 102 44C93 44 91 36 86 36C81 36 79 39 72 39C64 39 60 35 60 24Z',
    );
    s += '<circle class="c" cx="78" cy="24" r="6.5"/><circle class="b t" cx="78" cy="24" r="8.2"/>';
    s += P('c', 'M14 19.5L5 18.2V29.8L14 28.5ZM14 19.5L70 17.5V30.5L14 28.5');
    let fr = '',
      st = '';
    for (let n = 1; n <= 14; n++) {
      const x = fret(n),
        h = 4.5 + ((x - 14) / 56) * 2;
      fr += `M${r1(x)} ${r1(24 - h)}V${r1(24 + h)}`;
    }
    for (let i = 0; i < 6; i++) if (i !== 3) st += `M14 ${r1(24 + (i - 2.5) * 1.6)}L101 ${r1(24 + (i - 2.5) * 2)}`;
    s += `${P('c t', fr)}<rect class="c" x="99.5" y="18" width="3.5" height="12"/>${P('c t', st)}`;
    /* 弾く弦: ナットで 24.8、駒で 25 */
    const x5 = fret(5),
      len = 101 - x5,
      y0 = (x: number): number => 24.8 + (0.2 * (x - 14)) / 87;
    s += P('c t', `M14 24.8L${r1(x5)} ${r1(y0(x5))}`);
    if (!t) {
      const env = (sg: number): string =>
        fx((x) => y0(x) + sg * 3.2 * Math.sin((Math.PI * (x - x5)) / len), x5, 101, 24);
      return s + P('a', env(1)) + P('a', env(-1));
    }
    /* 駒から 0.35 の位置を弾いた弦のモードの和（基本の周期はゆっくり見せるため 0.6 s） */
    const u0 = 0.65,
      tt = mod(t, 3),
      A = 3.4 * Math.exp(-0.9 * tt);
    const disp = (u: number): number => {
      let v = 0;
      for (let n = 1; n <= 10; n++)
        v +=
          (2 / (n * n * Math.PI * Math.PI * u0 * (1 - u0))) *
          Math.sin(n * Math.PI * u0) *
          Math.sin(n * Math.PI * u) *
          Math.cos(n * TAU * 1.6 * tt);
      return v;
    };
    return (
      s +
      P(
        'a',
        fx((x) => y0(x) - A * disp((x - x5) / len), x5, 101, 60),
      )
    );
  },
  /* ピアノ音響モデル: 上から見たグランド。分散和音を弾き、打った弦が振れて輪が広がる */
  pn(t) {
    const out: [number, number][] = [
      [4, 38],
      [4, 2],
    ];
    for (let x = 8; x <= 116; x += 4) out.push([x, ptop(x) - 2]);
    out.push([116, 38]);
    let st = '',
      wk = '',
      bk = '';
    for (let x = 7; x <= 113; x += 3.5) st += `M${x} 37V${r1(ptop(x) + 0.5)}`;
    for (let k = 1; k < 28; k++) {
      wk += `M${4 + 4 * k} 38V46`;
      if ([1, 2, 4, 5, 6].includes(k % 7)) bk += `M${4 + 4 * k} 38V43`;
    }
    let s =
      P('c', pl(out)) +
      P('c t', st) +
      P(
        'b',
        fx((x) => ptop(x) + 4.5, 8, 112, 26),
      ) +
      `<rect class="c" x="4" y="38" width="112" height="8"/>${P('c t', wk)}${P('c w', bk)}`;
    /* ド・ミ・ソ… の白鍵。止まっているときは 4 つ目を打った直後 */
    const NOTES = [7, 9, 11, 14, 16, 18, 21],
      per = 0.32,
      tt = mod(t, per * NOTES.length + 1.2);
    NOTES.forEach((k, i) => {
      const tau = t ? tt - i * per : i === 3 ? 0.12 : -1;
      if (tau < 0) return;
      const x = 6 + 4 * k,
        top = r1(ptop(x) + 0.5),
        m = r1((37 + top) / 2),
        d = 1.6 * Math.exp(-1.2 * tau) * (0.4 + 0.6 * Math.abs(Math.cos(TAU * 3 * tau)));
      if (d > 0.15) s += P('a', `M${x} 37Q${r1(x + 2 * d)} ${m} ${x} ${top}Q${r1(x - 2 * d)} ${m} ${x} 37Z`);
      if (tau < 0.7)
        s += `<circle class="a t" cx="${x}" cy="33" r="${r1(1.5 + 16 * tau)}" opacity="${r1(1 - tau / 0.7)}"/>`;
    });
    return s;
  },
  /* ピアノのアクション: 横から見た鍵・ウィッペン・ジャック・レペティションレバー・ハンマーと弦（ページの図を縮めた形）。
     鍵が沈み、ジャックが抜けたハンマーが弦を打ち、落ちてバックチェックに止まり、鍵が戻ると元の姿勢に戻る。3 秒で 1 回打つ */
  pa(t) {
    const u = mod(t, 3),
      /* 鍵の沈み（0〜1）。0〜0.4 s で沈み、1.6〜2.1 s で戻る */
      dn = ease(u / 0.4) * (1 - ease((u - 1.6) / 0.5)),
      /* ハンマーの回り（打弦で 1）。加速して 0.45 s で弦を打ち、跳ね返ってチェック（0.68）に止まり、鍵と戻る */
      hm = u < 0.45 ? (u / 0.45) ** 1.6 : u < 1.6 ? 0.68 + 0.32 * (1 - clamp((u - 0.45) / 0.3, 0, 1)) ** 2 : 0.68 * dn,
      /* 弦の手前で、レペティションレバーはドロップねじで止まり、ジャックはレットオフで抜ける（ウィッペンから測る）。
         鍵が戻ると元へ */
      jk = u < 1 ? ease((u - 0.39) / 0.07) : dn,
      rp = u < 1 ? ease((u - 0.34) / 0.08) : dn,
      q = [
        Q_FIG[0] - 0.046 * dn,
        Q_FIG[1] + 0.088 * dn,
        Q_FIG[2] - 0.1 * jk,
        Q_FIG[3] - 0.07 * rp,
        Q_FIG[4] - 0.36 * hm,
      ];
    const [w2x, w2y] = paRot(q[1], PA.w2),
      [w3x, w3y] = paRot(q[1], PA.w3),
      part = (c: string, b: keyof typeof PA.out, o: readonly number[], a: number): string =>
        `<g transform="translate(${r1(o[0])} ${r1(o[1])}) rotate(${r1((a * 180) / Math.PI)})">${P(c, PA.out[b])}</g>`;
    const X = (x: number): number => PA.X0 + x * PA.k,
      ys = r1(PA.Y0 - PA.str * PA.k),
      xa = r1(X(PA.agr)),
      /* 打ったあとの弦の振れ（カードの左の端で）。鍵が戻るとダンパーで止まる */
      A =
        u < 0.45
          ? 0
          : 1.6 * Math.exp(-1.2 * (u - 0.45)) * Math.exp(-12 * Math.max(0, u - 1.6)) * Math.sin(TAU * 7 * (u - 0.45));
    return (
      '<clipPath id="ca-pa"><rect x="4" y="0" width="112" height="48"/></clipPath><g clip-path="url(#ca-pa)">' +
      P(
        'c',
        Math.abs(A) > 0.05 ? `M${xa} ${ys}Q${r1((xa + 4) / 2)} ${r1(ys - A / 2)} 4 ${r1(ys - A)}` : `M4 ${ys}H${xa}`,
      ) +
      `<g transform="matrix(${PA.k} 0 0 ${-PA.k} ${r1(PA.X0)} ${PA.Y0})">` +
      part('c t', 'key', [0, 0], q[0]) +
      part('b t', 'whippen', PA.g2, q[1]) +
      part('a t', 'rep', [PA.g2[0] + w3x, PA.g2[1] + w3y], q[1] + q[3]) +
      part('c t', 'jack', [PA.g2[0] + w2x, PA.g2[1] + w2y], q[1] + q[2]) +
      part('c', 'hammer', PA.g3, q[4]) +
      '</g></g>'
    );
  },
  /*
   * ヴァイオリン音響モデル: 上から見たヴァイオリンと弓（実物の長さ）。弓は A 線を擦りながら、元から先まで弓をいっぱいに
   * 使って往復するので、元の毛箱と先の頭が交互に見える。弦は Helmholtz の運動の折れ目が回り、弓を返すと回る向きが変わる。
   * 止まっているときは下げ弓を始めるところ（毛箱が見える）で、弦の振れる範囲を描く
   */
  vn(t) {
    const [x0, y0] = VN.a0,
      [x1, y1] = VN.a1,
      env = (u: number): number => 4 * u * (1 - u),
      /* 弓の 1 往復は 3.2 s。弓の毛の元から 0.04〜0.62 m のところで弦を擦る */
      cyc = mod(t, 3.2) / 1.6,
      down = cyc < 1,
      st = bowStroke(down ? cyc : cyc - 1),
      pos = 40 + 580 * (down ? st.pos : 1 - st.pos),
      A = 1.8 * (t ? 0.55 + 0.45 * st.v : 1),
      at = (u: number, dy: number): [number, number] => [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u - dy],
      band = (sg: number): string => {
        const p: [number, number][] = [];
        for (let i = 0; i <= 24; i++) p.push(at(i / 24, sg * A * env(i / 24)));
        return pl(p);
      };
    let s = VN.still;
    if (!t) s += P('a', band(1) + band(-1));
    else {
      /* 折れ目は前半で駒から上駒へ（上の枝）、後半で上駒から駒へ（下の枝）。上げ弓では上下が逆。片道に 3 回まわる */
      const ph = mod(t * 1.875, 1),
        u = ph < 0.5 ? 1 - 2 * ph : 2 * ph - 1,
        side = (ph < 0.5 ? 1 : -1) * (down ? 1 : -1);
      s += P('a g', band(1) + band(-1)) + P('a', pl([at(0, 0), at(u, side * A * env(u)), at(1, 0)]));
    }
    /*
     * 弓: 毛・棹（渦巻きの側へ傾けて持つ）・毛箱・ねじ・頭。元が上（E 線の側）で、下げ弓では弓が上へ動く。
     * 弦に触れる点（y = 24）が、毛の元から pos [mm] のところ
     */
    const bx = VN.bow,
      Yb = (s2: number): number => 24 + (s2 - pos) * VN.k,
      Q = (pts: [number, number][]): string => `${pl(pts.map(([l, s2]): [number, number] => [bx + l, Yb(s2)]))}Z`;
    return (
      s +
      P('b', `M${r1(bx)} ${r1(Yb(0))}V${r1(Yb(650))}`) +
      P('c', `M${r1(bx + BOW_STICK)} ${r1(Yb(-66))}V${r1(Yb(648))}`) +
      P('fc', Q(BOW_FROG) + Q(BOW_BUTTON) + Q(BOW_HEAD))
    );
  },
  /* トランペット音響モデル: マウスピース・リードパイプ・主管の抜差し・ピストン・ベル（ページの横から見た図を 1/10 にした形）。
     ハ長調の音階の運指でピストンを押し、管を圧力の波が進み、ベルから音が広がる */
  tp(t) {
    const air = 'M7 22.9H74.6A5.4 5.4 0 0 1 74.6 33.6H23.7A6.9 6.9 0 0 1 23.7 19.8H68',
      F = [
        [0, 0, 0],
        [1, 0, 1],
        [1, 1, 0],
        [1, 0, 0],
        [0, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
        [0, 0, 0],
      ],
      v = t ? F[Math.floor(t / 0.6) % F.length] : F[0];
    let s =
      P('c', `${air}M4 20.6Q5.2 22.6 7 22.9Q5.2 23.2 4 25.2Z`) +
      P('c', 'M68 19.5C88 19.3 96 16 99 9.1M68 20.1C88 20.3 96 23.6 99 30.5') +
      P('c t', 'M99 9.1C100.4 9.1 101 14 101 19.8S100.4 30.5 99 30.5C97.6 30.5 97 25.6 97 19.8S97.6 9.1 99 9.1Z');
    [40.5, 44.5, 48.5].forEach((x, i) => {
      const y = 15.6 + 1.6 * v[i];
      s +=
        P('c w', `M${x} 18.8V38.2`) +
        P('c t', `M${x} ${r1(y)}V18.8`) +
        P(v[i] ? 'a w' : 'c w', `M${x - 1.7} ${r1(y)}H${x + 1.7}`);
    });
    /* 運指の 1 巡（4.8 s）に、圧力の波は 7 つ、ベルの輪は 3 つ進む */
    if (t) s += P('b', air, ` stroke-dasharray="3 26" stroke-dashoffset="${r1((-t * 29 * 7) / 4.8)}"`);
    for (let j = 0; j < 3; j++) {
      const r = t ? mod((t * 15 * 3) / 4.8 + j * 5, 15) : 3 + j * 5,
        x = r1(102 + r),
        h = r1(6 + r * 0.6);
      s += P('a', `M${x} ${r1(19.8 - h)}Q${r1(x + 2.5)} 19.8 ${x} ${r1(19.8 + h)}`, ` opacity="${r1(1 - r / 16)}"`);
    }
    return s;
  },
  /* PCB コイル: うずまきを電流が流れる */
  pc(t) {
    const d = 'M42 6H78V42H42V10H74V38H46V14H70V34H50V18H66V30H54V22H62';
    return (
      P('c', 'M4 6H42') +
      P('a', d) +
      (t ? P('b', d, ` stroke-dasharray="2 14" stroke-dashoffset="${r1(-t * 30)}" style="stroke-width:3"`) : '') +
      P('c d', 'M62 22H116')
    );
  },
  /* JPEG: ジグザグに走査し、係数の棒が順に立つ */
  jp(t) {
    const Z: [number, number][] = [
      [9, 9],
      [19, 9],
      [9, 19],
      [9, 29],
      [29, 9],
      [39, 9],
      [9, 39],
      [19, 39],
      [39, 19],
      [39, 29],
      [29, 39],
      [39, 39],
    ];
    const r = t ? mod(t, 3) / 2 : 1;
    let bars = '';
    [6, 18, 27, 33, 37, 40, 41.5, 42.5].forEach((h, i) => {
      const s = clamp(r * 9 - i, 0, 1);
      if (s > 0) bars += `M${56 + 8 * i} 44V${r1(44 - (44 - h) * s)}`;
    });
    return (
      P('c', 'M4 4H44V44H4Z') +
      (t ? P('c g', pl(Z)) : '') +
      P('a', partial(Z, r * 1.15)) +
      P('c d', 'M52 44H116') +
      (bars ? P('b', bars) : '')
    );
  },
  /* 画像の畳み込み: 升目の画像の上を 3×3 の窓が左から右へ滑り、通った列はぼける（3×3 の平均） */
  icv(t) {
    const CW = 14,
      RH = 5,
      on = (c: number, r: number): number =>
        c < 0 || c >= CW || r < 0 || r >= RH
          ? 0
          : c === 1 ||
              c === 2 ||
              (c === 4 && r === 2) ||
              ((c === 6 || c === 7) && (c + r) % 2 === 0) ||
              (c >= 9 && c <= 12 && r >= 1 && r <= 3)
            ? 1
            : 0;
    /* 窓の中心の列（1〜12）。止まっているときは中ほど */
    const wx = t ? 1 + Math.floor(mod(t, 3) / (3 / 12)) : 7;
    let s = '';
    for (let r = 0; r < RH; r++)
      for (let c = 0; c < CW; c++) {
        let v = on(c, r);
        if (c < wx) {
          v = 0;
          for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) v += on(c + i, r + j) / 9;
        }
        if (v > 0.01)
          s += `<rect class="fa" x="${4 + c * 8}" y="${4 + r * 8}" width="8" height="8" fill-opacity="${r1(v)}"/>`;
      }
    return (
      s +
      `<rect class="c t" x="4" y="4" width="${CW * 8}" height="${RH * 8}"/>` +
      `<rect class="b" x="${4 + (wx - 1) * 8}" y="12" width="24" height="24"/>` +
      `<rect class="b t" x="${4 + wx * 8}" y="20" width="8" height="8"/>`
    );
  },
  /* デモザイク: 斜めの縁の画像。右はベイヤー配列のモザイク（R の升は ch1、B の升は ch2、G の升は灰）、
     縦の線より左は復元した明るさ。線が左から右へ進む */
  dm(t) {
    const CW = 14,
      RH = 5,
      val = (c: number, r: number): number => (c < 3.5 + 2.2 * r ? 0.95 : 0.12);
    const wx = t ? Math.floor(mod(t, 3) / (3 / 15)) : 7;
    let s = '';
    for (let r = 0; r < RH; r++)
      for (let c = 0; c < CW; c++) {
        const v = val(c, r),
          k = c < wx ? 'fc' : (r & 1) === 0 && (c & 1) === 0 ? 'fa' : (r & 1) === 1 && (c & 1) === 1 ? 'fb' : 'fc';
        s += `<rect class="${k}" x="${4 + c * 8}" y="${4 + r * 8}" width="8" height="8" fill-opacity="${r1(c < wx ? v : v * 0.9)}"/>`;
      }
    return (
      s +
      `<rect class="c t" x="4" y="4" width="${CW * 8}" height="${RH * 8}"/>` +
      (wx > 0 && wx < CW ? P('a', `M${4 + wx * 8} 2V46`) : '')
    );
  },
  /*
   * 画像の拡大縮小: 左の小さいドット絵が右で大きくなる。画素の 1 辺をコマ送りで変える
   */
  rz(t) {
    const S = [2, 3, 4, 5, 4, 3],
      s = S[t ? (2 + Math.floor(t / 0.5)) % S.length : 2],
      sprite = (x0: number, y0: number, u: number): string => {
        let a = '',
          b = '',
          c = '';
        RZ_SPRITE.forEach((row, j) => {
          [...row].forEach((k, i) => {
            const d = `M${x0 + i * u} ${y0 + j * u}h${u}v${u}h-${u}Z`;
            if (k === 'a') a += d;
            else if (k === 'b') b += d;
            else if (k === 'c') c += d;
          });
        });
        const crisp = ' shape-rendering="crispEdges"';
        return P('fa', a, crisp) + P('fb', b, crisp) + P('fc', c, crisp);
      };
    return (
      sprite(8, 16, 2) +
      P('c t', 'M4 12H28V36H4Z') +
      P('c', 'M36 24H46M42 20L46 24L42 28') +
      sprite(84 - s * 4, 44 - s * 8, s) +
      P('c t', 'M56 44H114')
    );
  },
  /*
   * PNG: 絵を上から 1 行ずつフィルタにかける。済んだ行は差の 0 でない所だけが黄で残り、
   * 右の横線（行ごとの 0 でない値の数）が青の長い線から黄の短い線に変わる
   */
  png(t) {
    const done = t ? Math.min(PNG_H, Math.floor(mod(t, 3.4) / 0.26)) : 5,
      cell = (r: number, c: number): string => `M${4 + c * 4} ${4 + r * 4}h4v4h-4Z`,
      crisp = ' shape-rendering="crispEdges"';
    let hill = '',
      tower = '',
      dif = '',
      rawBar = '',
      difBar = '';
    PNG_PIC.forEach((row, r) => {
      const { dif: marks, raw } = PNG_ROWS[r],
        isDone = r < done,
        n = isDone ? marks.filter(Boolean).length : raw,
        bar = n ? `M74 ${6 + r * 4}H${r1(74 + n * 2.6)}` : '';
      if (isDone) difBar += bar;
      else rawBar += bar;
      row.forEach((x, c) => {
        if (isDone) {
          if (marks[c]) dif += cell(r, c);
        } else if (x === 1) hill += cell(r, c);
        else if (x === 2) tower += cell(r, c);
      });
    });
    return (
      (hill ? P('fb', hill, crisp) : '') +
      (tower ? P('fc', tower, crisp) : '') +
      (dif ? P('fa', dif, crisp) : '') +
      P('c t', 'M4 4H68V44H4ZM72 4V44') +
      (rawBar ? P('b', rawBar) : '') +
      (difBar ? P('a', difBar) : '') +
      (done < PNG_H ? P('c t', `M2 ${4 + done * 4}H116`) : '')
    );
  },
  /* ローリングシャッター: 2 枚羽のプロペラを上の行から順に読み出す。走査線より上は行ごとに違う瞬間の羽で曲がって写り、
     下は今の羽。1 走査の間に 0.8 回転する */
  rs(t) {
    const cx = 60,
      cy = 24,
      R = 19,
      ys = t ? 4 + (mod(t, 3) / 3) * 40 : 44;
    const th0 = (y: number): number => 0.4 + TAU * 0.8 * ((y - 4) / 40);
    let s = '';
    for (let k = 0; k < 2; k++) {
      let run: [number, number][] = [];
      const flush = () => {
        if (run.length > 1) s += P('a', pl(run));
        run = [];
      };
      for (let y = 4; y <= ys + 1e-9; y += 0.5) {
        const th = th0(y) + k * Math.PI,
          sn = Math.sin(th),
          rho = Math.abs(sn) < 1e-3 ? -1 : (cy - y) / sn;
        if (rho < 0 || rho > R) flush();
        else run.push([cx + rho * Math.cos(th), y]);
      }
      flush();
    }
    if (ys < 44) {
      const th = th0(ys);
      /* 今の羽は走査線より下だけ描く */
      for (const g of [0, Math.PI]) {
        const ex = cx + R * Math.cos(th + g),
          ey = cy - R * Math.sin(th + g);
        if (Math.max(cy, ey) <= ys) continue;
        /* 中心から先端までのうち、走査線より下の区間 */
        const cut = (ys - cy) / (ey - cy || 1),
          a = cy >= ys ? 0 : cut,
          b = ey >= ys ? 1 : cut;
        s += P(
          'g',
          `M${r1(cx + (ex - cx) * a)} ${r1(cy + (ey - cy) * a)}L${r1(cx + (ex - cx) * b)} ${r1(cy + (ey - cy) * b)}`,
        );
      }
      s += P('b', `M4 ${r1(ys)}H116`);
    }
    return `${s}<circle class="c" cx="${cx}" cy="${cy}" r="2.4"/>`;
  },
  /* レイトレーシング: 箱の部屋の中を光線が反射して天井の光源へ届く。先の点が進み、通った所を線で残す */
  rt(t) {
    const room = 'M38 6H82V42H38ZM22 2L38 6M98 2L82 6M22 46L38 42M98 46L82 42';
    const path: [number, number][] = [
      [60, 47],
      [47, 33],
      [74, 21],
      [50, 13],
      [60, 5],
    ];
    const lens = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], p[1] - path[i][1]));
    const total = lens.reduce((a, b) => a + b, 0);
    let run = t ? (mod(t, 3) / 3) * 1.15 * total : total;
    const pts: [number, number][] = [path[0]];
    for (let i = 0; i < lens.length && run > 0; i++) {
      const u = Math.min(1, run / lens[i]);
      pts.push([path[i][0] + (path[i + 1][0] - path[i][0]) * u, path[i][1] + (path[i + 1][1] - path[i][1]) * u]);
      run -= lens[i];
    }
    const head = pts[pts.length - 1];
    return (
      P('c', room) +
      P('b', 'M52 5H68') +
      '<circle class="c" cx="47" cy="33" r="7"/>' +
      P('a', pl(pts)) +
      `<circle class="b" cx="${r1(head[0])}" cy="${r1(head[1])}" r="1.8"/>`
    );
  },
  /* 画像の破損: 走査線で描いた絵の 1 か所を壊すと、そこから下の行が横にずれて色も変わる。壊れる行が上から下りてくる */
  crp(t) {
    const ROWS = 9,
      /* 行ごとの山の輪郭（中央が高い絵） */
      hi = (r: number): number => 58 - 46 * Math.abs(r - 4.2) * 0.2,
      at = t ? Math.floor((mod(t, 3) / 3) * (ROWS + 2)) : 5;
    let ok = '',
      sky = '',
      bad = '',
      off = '';
    for (let r = 0; r < ROWS; r++) {
      const y = 4 + r * 4.6,
        w = hi(r),
        c = 60;
      if (r < at) {
        sky += `M6 ${r1(y)}H${r1(c - w / 2 - 3)}M${r1(c + w / 2 + 3)} ${r1(y)}H114`;
        ok += `M${r1(c - w / 2)} ${r1(y)}H${r1(c + w / 2)}`;
      } else {
        const d = ((r - at + 1) * 11) % 37,
          x0 = 6 + d;
        bad += `M${r1(x0)} ${r1(y)}H${r1(Math.min(114, x0 + 34))}`;
        off += `M${r1(Math.min(112, x0 + 42))} ${r1(y)}H114M6 ${r1(y)}H${r1(Math.max(6, x0 - 6))}`;
      }
    }
    return P('c t', sky) + P('b', ok) + (bad ? P('a', bad) : '') + (off ? P('c d', off) : '');
  },
  /* シェーディング: 光が動くと、左の球のハイライトと右のローブが一緒に動く。ローブは GGX の断面 */
  sh(t) {
    const th = (Math.PI / 180) * (38 + 22 * Math.sin((t / 3) * TAU)),
      cx = 30,
      cy = 25,
      R = 20,
      hx = cx + R * 0.55 * Math.sin(th / 2 + 0.2),
      hy = cy - R * 0.55 * Math.cos(th / 2 + 0.2);
    let s = `<circle class="c" cx="${cx}" cy="${cy}" r="${R}"/>`;
    for (const r of [5.5, 3.2, 1.2]) s += `<circle class="a" cx="${r1(hx)}" cy="${r1(hy)}" r="${r}"/>`;
    const ox = 84,
      oy = 44,
      a = 0.16;
    const pts: [number, number][] = [[ox, oy]];
    for (let d = -88; d <= 88; d += 4) {
      const q = (d * Math.PI) / 180,
        h = (q - th) / 2,
        c2 = Math.cos(h) ** 2,
        D = (a * a) / (Math.PI * (c2 * (a * a - 1) + 1) ** 2),
        v = Math.min(1, 0.32 + 0.68 * Math.min(1, D / 12));
      pts.push([ox + 32 * v * Math.sin(q), oy - 32 * v * Math.cos(q)]);
    }
    pts.push([ox, oy]);
    s += P('c g', 'M52 44H116') + P('a', pl(pts));
    s += P('b', `M${r1(ox - 36 * Math.sin(th))} ${r1(oy - 36 * Math.cos(th))}L${ox} ${oy}`);
    return s;
  },
  /* GIF: LZW の辞書の木が 1 符号ずつ育つ。足した節を塗り、根からの道すじを色の線で示す */
  gif(t) {
    /* [x, y, 親]。先頭の 3 つが根で、後ろほど後に足す */
    const N: readonly (readonly [number, number, number])[] = [
        [26, 8, -1],
        [62, 8, -1],
        [96, 8, -1],
        [16, 24, 0],
        [62, 24, 1],
        [36, 24, 0],
        [96, 24, 2],
        [50, 40, 4],
        [8, 40, 3],
        [74, 24, 1],
        [24, 40, 3],
        [86, 40, 6],
        [74, 40, 4],
        [106, 40, 6],
      ],
      S = 3.5,
      n = t ? 3 + Math.floor((mod(t, 3) / 3) * (N.length - 2)) : N.length,
      last = Math.min(n, N.length) - 1,
      box = (i: number): string => `M${N[i][0] - S} ${N[i][1] - S}h${2 * S}v${2 * S}h${-2 * S}Z`,
      edge = (i: number): string => {
        const p = N[N[i][2]];
        return `M${p[0]} ${p[1] + S}L${N[i][0]} ${N[i][1] - S}`;
      };
    let lines = '',
      old = '',
      path = '';
    for (let i = 0; i <= last; i++) {
      if (N[i][2] >= 0) lines += edge(i);
      if (i < last) old += box(i);
    }
    for (let i = last; N[i][2] >= 0; i = N[i][2]) path += edge(i);
    return P('c t', lines) + P('fc', old) + (path ? P('a', path) : '') + P('fb', box(last));
  },
  /* ソート: バーをバブルソートで並べる。比べている 2 本を色で示し、位置の決まったバーは濃く描く */
  so(t) {
    if (!SO_FRAMES.length) soFrames();
    const f = SO_FRAMES[t ? Math.min(SO_FRAMES.length - 1, Math.floor((mod(t, 3) / 3) * SO_FRAMES.length)) : 0],
      B = 7.2,
      bar = (i: number, v: number): string => {
        const h = 3 + v * 2.9;
        return `M${(5 + i * B).toFixed(1)} ${(47 - h).toFixed(1)}h5.6v${h.toFixed(1)}h-5.6Z`;
      };
    let base = '',
      hit = '';
    f.a.forEach((v, i) => {
      if (f.i >= 0 && (i === f.i || i === f.i + 1)) hit += bar(i, v);
      else base += bar(i, v);
    });
    return P('fc', base) + (hit ? P(f.sw ? 'fa' : 'fb', hit) : '');
  },
  /* クラスタリング: 混合ガウス分布の EM。大きな楕円がコマ送りで点の広がりに合っていく */
  gm(t) {
    const F = gmFrames(),
      f = F[t ? Math.min(F.length - 1, Math.floor((mod(t, 3.6) / 3) * F.length)) : 1],
      r = 2;
    let a = '',
      b = '';
    GM_PTS.forEach(([x, y], i) => {
      const d = `M${r1(x - r)} ${r1(y)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
      if (f.lab[i]) b += d;
      else a += d;
    });
    return P('a', gmEllipse(f.mu[0], f.S[0])) + P('b', gmEllipse(f.mu[1], f.S[1])) + P('fa', a) + P('fb', b);
  },
  /* リスト・キュー・スタック: 左はバーを積むスタック、右はバーが流れるキュー */
  ls(t) {
    const u = mod(t, 3) / 3,
      count = 1 + Math.round(5 * Math.abs(2 * u - 1)),
      W = [30, 26, 22, 18, 14, 10];
    let pile = '',
      top = '',
      bars = '',
      head = '';
    for (let i = 0; i < count; i++) {
      const d = `M${r1(24 - W[i] / 2)} ${42 - i * 5}h${W[i]}v3.6h-${W[i]}Z`;
      if (i === count - 1) top = d;
      else pile += d;
    }
    const H = [14, 26, 10, 32, 20, 28, 12, 22];
    H.forEach((h, i) => {
      const x = 58 + mod(i * 7.5 + u * 60, 60),
        d = `M${r1(x - 2.6)} ${44 - h}h5.2v${h}h-5.2Z`;
      if (x > 110) head += d;
      else bars += d;
    });
    return (
      P('c', 'M6 8V45H42V8M58 8H118M58 45H118') +
      P('fc', pile + bars) +
      P(u < 0.5 ? 'fb' : 'fa', top) +
      (head ? P('fb', head) : '')
    );
  },
  /* 二分ヒープ: 左に 7 個の木、右に同じ値の配列を置き、同じ要素を両方で光らせる */
  hp(t) {
    if (!HP_FRAMES.length) hpFrames();
    /* 止まった絵は 1 個を取り出したあと、交換している所 */
    const start = HP_FRAMES.findIndex((f) => f.a.length === 6 && f.w && f.i.length === 2),
      f = HP_FRAMES[(start + Math.floor(t * HP_FPS)) % HP_FRAMES.length],
      node = (i: number): [number, number] => {
        const l = Math.floor(Math.log2(i + 1));
        return [4 + ((i + 1.5 - 2 ** l) / 2 ** l) * 50, 8 + l * 16];
      };
    let lines = '',
      base = '',
      hit = '';
    f.a.forEach((v, i) => {
      const [x, y] = node(i),
        r = r1(1.8 + (v / 7) * 2.6),
        h = r1(4 + (v / 7) * 34),
        d =
          `M${r1(x - r)} ${y}a${r} ${r} 0 1 0 ${r1(2 * r)} 0a${r} ${r} 0 1 0 ${r1(-2 * r)} 0Z` +
          `M${r1(63.3 + i * 7.4)} ${r1(45 - h)}h5.4v${h}h-5.4Z`;
      if (i) {
        const [px, py] = node((i - 1) >> 1);
        lines += `M${r1(px)} ${py}L${r1(x)} ${y}`;
      }
      if (f.i.includes(i)) hit += d;
      else base += d;
    });
    return P('c t', lines) + P('fc', base) + (hit ? P(f.w ? 'fa' : 'fb', hit) : '');
  },
  /* B木: 枠のある箱の木。キーで箱が埋まり、あふれると分かれて中央のキーが親へ上がる */
  bt(t) {
    if (!BT_FRAMES.length) btFrames();
    /* 止まった絵は 3 段の木で、キーが親へ上がった所 */
    const deep = (n: BtNode): number => (n.c.length ? 1 + deep(n.c[0]) : 1),
      start = BT_FRAMES.findIndex((q) => q.w.length === 3 && deep(q.root) === 3),
      f = BT_FRAMES[(start + Math.floor(t * BT_FPS)) % BT_FRAMES.length],
      SLOTS = 3,
      GAP = 2.5,
      GY = 16.5,
      CH = 8,
      leaves: BtNode[] = [],
      walk = (n: BtNode): void => {
        if (n.c.length) n.c.forEach(walk);
        else leaves.push(n);
      };
    walk(f.root);
    const L = leaves.length,
      cw = Math.min(6.5, (114 - GAP * (L - 1)) / (L * SLOTS)),
      lw = cw * SLOTS,
      x0 = 3 + (114 - L * lw - (L - 1) * GAP) / 2,
      rect = (x: number, y: number, w: number, h: number): string => `M${r1(x)} ${r1(y)}h${r1(w)}v${r1(h)}h${r1(-w)}Z`;
    let i = 0,
      lines = '',
      box = '',
      wrote = '',
      base = '',
      hit = '';
    const place = (n: BtNode, l: number): number => {
      let x: number;
      if (n.c.length) {
        const xs = n.c.map((c) => place(c, l + 1));
        x = (xs[0] + xs[xs.length - 1]) / 2;
        xs.forEach((cx, j) => {
          lines += `M${r1(x - lw / 2 + j * cw)} ${r1(3 + l * GY + CH)}L${r1(cx)} ${r1(3 + (l + 1) * GY)}`;
        });
      } else x = x0 + i++ * (lw + GAP) + lw / 2;
      const left = x - lw / 2,
        y = 3 + l * GY,
        d = rect(left, y, Math.max(SLOTS, n.k.length) * cw, CH);
      if (f.w.includes(n)) wrote += d;
      else box += d;
      n.k.forEach((v, j) => {
        const q = rect(left + j * cw + 0.8, y + 0.8, cw - 1.6, CH - 1.6);
        if (f.hot.includes(v)) hit += q;
        else base += q;
      });
      return x;
    };
    place(f.root, 0);
    return P('c t', lines) + P('c t', box) + (wrote ? P('a', wrote) : '') + P('fc', base) + (hit ? P('fa', hit) : '');
  },
  /* 式の構文解析: 上に式、左に木、右にスタックを置き、演算子が積まれて木へ移る */
  ep(t) {
    /* 止まった絵は × を木にした直後 */
    const f = EP_FRAMES[(8 + Math.floor(t * EP_FPS)) % EP_FRAMES.length],
      parent = new Map<number, number>(),
      slot: Record<number, number> = { 0: 0, 2: 1, 4: 2, 6: 3 };
    for (const m of f.made) for (const k of EP_KIDS[m]) parent.set(k, m);
    const xOf = (i: number): number => (i in slot ? 6 + slot[i] * 19 : (xOf(EP_KIDS[i][0]) + xOf(EP_KIDS[i][1])) / 2);
    const yOf = (i: number): number => {
      let d = 0;
      for (let q = i; parent.has(q); q = parent.get(q) as number) d++;
      return 20 + d * 8.6;
    };
    const nodes = [...[0, 2, 4, 6].filter((i) => i < f.read), ...f.made];
    let done = '',
      rest = '',
      hit = '',
      lines = '',
      base = '',
      mark = '',
      st = '',
      top = '';
    EP_TOK.forEach((c, i) => {
      const x = 8 + i * 15.5,
        d = EP_GLYPH[c].map((l) => `M${l.map(([a, b]) => `${r1(x + a)} ${r1(7 + b)}`).join('L')}`).join('');
      if (f.hot.includes(i)) hit += d;
      else if (i < f.read) done += d;
      else rest += d;
    });
    for (const i of nodes) {
      const x = xOf(i),
        y = yOf(i),
        d = `M${r1(x - 2.8)} ${r1(y)}a2.8 2.8 0 1 0 5.6 0a2.8 2.8 0 1 0 -5.6 0Z`,
        p = parent.get(i);
      if (p !== undefined) lines += `M${r1(xOf(p))} ${r1(yOf(p))}L${r1(x)} ${r1(y)}`;
      if (f.hot.includes(i)) mark += d;
      else base += d;
    }
    f.stk.forEach((tok, k) => {
      const d = `M90 ${41 - k * 8}h22v-6h-22Z`;
      if (f.hot.includes(tok)) top += d;
      else st += d;
    });
    const fill = f.w ? 'fa' : 'fb';
    return (
      P('c', done) +
      P('c t', rest) +
      P(f.w ? 'a' : 'b', hit) +
      P('c t', lines) +
      P('fc', base) +
      P(fill, mark) +
      P('c', 'M86 20V45H116V20') +
      P('fc', st) +
      P(fill, top)
    );
  },
  /* オルガン音響モデル: 口と円錐の足があるパイプの正面。和音を鳴らし、鳴っている管に定在波を描く */
  og(t) {
    let body = '',
      lip = '',
      foot = '';
    const top = (i: number): number => 4 + Math.abs(i - 5) * 3.4;
    for (let i = 0; i < 11; i++) {
      const x = 10 + i * 10;
      body += `M${x - 3} 34V${r1(top(i))}H${x + 3}V34H${x - 3}`;
      lip += `M${x - 2.2} 34Q${x} 29.6 ${x + 2.2} 34`;
      foot += `M${x - 3} 34L${x - 0.8} 43M${x + 3} 34L${x + 0.8} 43`;
    }
    let s = P('c', body) + P('c', foot) + P('c', 'M4 44H116') + P('a', lip);
    const CH = [
        [5, 2, 8],
        [3, 6, 9],
        [1, 5, 7],
        [4, 2, 8],
      ],
      per = 0.75,
      tau = mod(t, per);
    for (const i of t ? CH[Math.floor(t / per) % CH.length] : [5]) {
      /* 両端が開いた管の音圧の分布（両端が節） */
      const x = 10 + i * 10,
        y0 = top(i),
        len = 34 - y0,
        a = 2.2 * Math.cos((TAU * 7 * t) / 3) * (t ? Math.min(1, tau * 8) : 1);
      const side = (sg: number): string => {
        const p: [number, number][] = [];
        for (let k = 0; k <= 12; k++) p.push([x + sg * a * Math.sin((Math.PI * k) / 12), y0 + (len * k) / 12]);
        return pl(p);
      };
      s += P('b', side(1)) + P('b', side(-1));
      if (t && tau < 0.5)
        s += `<path class="a t" d="M${r1(x - 4 - tau * 10)} ${r1(31 + tau * 4)}Q${x} ${r1(27 - tau * 10)} ${r1(x + 4 + tau * 10)} ${r1(31 + tau * 4)}" opacity="${r1(1 - tau / 0.5)}"/>`;
    }
    return s;
  },
  /* エンジン音響モデル: シリンダ・ピストン・クランクと、マフラーへの排気管、排気の圧力。
     クランクが回り、圧縮上死点で点火し、2 回転に 1 回の排気の脈動が流れる */
  en(t) {
    const deg = (t + 0.04) * 400,
      th = (deg * Math.PI) / 180,
      py = pinY(th),
      cpx = r1(EN.cx + EN.r * Math.sin(th)),
      cpy = r1(EN.cy - EN.r * Math.cos(th)),
      cd = mod(deg + 360, 720) - 360,
      ph = mod(cd - 140, 720);
    let s =
      P('c t', 'M9 2.5H35M9 5H35M9 7.5H35') +
      P('c', 'M14 9V27M30 9V27M14 27C11 47 33 47 30 27') +
      `<rect class="c" x="15" y="${r1(py - 3)}" width="14" height="6" rx="0.6"/><circle class="c" cx="${EN.cx}" cy="${EN.cy}" r="5.2"/>` +
      P('a', `M${cpx} ${cpy}L${EN.cx} ${r1(py)}`) +
      `<circle class="a" cx="${cpx}" cy="${cpy}" r="1.1"/>`;
    if (cd > -12 && cd < 30) s += P('a', 'M22 9.5V12M19.5 11L21 12M24.5 11L23 12');
    s += `${P('c', 'M30 10.5H92M30 14.5H92M117 12.5H112')}<rect class="c" x="92" y="6" width="20" height="13" rx="4"/>`;
    const xp = 32 + ph * 0.22;
    if (xp < 92) s += P('b', `M${r1(Math.max(31, xp - 7))} 12.5H${r1(xp)}`, ' style="stroke-width:3"');
    return (
      s +
      P('c d', 'M40 34H116') +
      P(
        'b',
        fx((x) => 34 - 9 * exhP(deg - (116 - x) * 19), 40, 116, 152),
      )
    );
  },
  /* カメラレンズ: ピントの位置が前後し、像面で光線が広がる */
  ln(t) {
    const fp = 100 - 9 * Math.sin(t * 1.4),
      y1 = 13 + (11 * 60) / (fp - 40),
      y2 = 35 - (11 * 60) / (fp - 40),
      yb = 16 + (14 * 60) / (fp - 40);
    return (
      P('c d', 'M4 24H116') +
      P('c', 'M40 5C49 14 49 34 40 43C31 34 31 14 40 5ZM100 6V42') +
      P('a', `M4 13H40L100 ${r1(y1)}M4 35H40L100 ${r1(y2)}`) +
      P('b', `M4 12L40 16L100 ${r1(yb)}M4 26L40 30L100 30`)
    );
  },
  /* ハロ（暈）: 太陽がゆっくり昇り沈みし、幻日は太陽が高いほど内暈から離れ、環天頂アークは天頂へ寄って
     太陽高度 32° を超えると消える。1° を 0.5 にとり、地平線の下は切る */
  hl(t) {
    const k = 0.5,
      e = 22 + 14 * Math.sin(t * 0.8),
      sx = 60,
      sy = 44 - e * k,
      rr = r1(R22 * k);
    let s = P('c d', `M6 ${r1(sy)}H114`);
    s += `<circle class="b" cx="${sx}" cy="${r1(sy)}" r="${rr}"/>`;
    const pd = parDist(e);
    if (!Number.isNaN(pd))
      for (const g of [-1, 1]) s += `<circle class="a" cx="${r1(sx + g * pd * k)}" cy="${r1(sy)}" r="1.4"/>`;
    /* 上端接弧（内暈の上に接する V） */
    const ty = sy - rr;
    s += P('b', `M${sx - 9} ${r1(ty - 2.6)}Q${sx} ${r1(ty + 1.2)} ${sx + 9} ${r1(ty - 2.6)}`);
    const cz = czaAlt(e);
    if (!Number.isNaN(cz)) {
      const cy = 44 - cz * k,
        w = 10 + (32 - e) * 0.25;
      s += P('a', `M${r1(sx - w)} ${r1(cy - 3)}Q${sx} ${r1(cy + 3)} ${r1(sx + w)} ${r1(cy - 3)}`);
    }
    return `<clipPath id="ca-hl"><rect x="0" y="0" width="120" height="44"/></clipPath><g clip-path="url(#ca-hl)">${s}<circle class="a" cx="${sx}" cy="${r1(sy)}" r="2.2"/></g>${P('c', 'M4 44H116')}`;
  },
  /* フォーカシングマスク: バーティノフマスクの正面と、星の 3 本の光条。ピントが前後し、中央の光条が X の交点の上下を通る */
  fk(t) {
    const cx = 24,
      cy = 24,
      r = 19,
      th = (20 * Math.PI) / 180,
      sp = 4.6;
    /* 直線（点 p・向き d）を、円と条件 ok の範囲で切った線分 */
    const seg = (px: number, py: number, dx: number, dy: number, ok: (x: number, y: number) => boolean): string => {
      const b = dx * (px - cx) + dy * (py - cy),
        c = (px - cx) ** 2 + (py - cy) ** 2 - r * r,
        q = b * b - c;
      if (q <= 0) return '';
      const pts: [number, number][] = [];
      const n = 24,
        t0 = -b - Math.sqrt(q),
        t1 = -b + Math.sqrt(q);
      for (let i = 0; i <= n; i++) {
        const s = t0 + ((t1 - t0) * i) / n,
          x = px + dx * s,
          y = py + dy * s;
        if (ok(x, y)) pts.push([x, y]);
      }
      return pts.length > 1 ? pl([pts[0], pts[pts.length - 1]]) : '';
    };
    let slits = '';
    /* 下半分: 縦のスリット。上半分の左右: ±θ 傾けたスリット */
    for (let k = -6; k <= 6; k++) {
      if (Math.abs(k) <= 4) slits += seg(cx + k * sp, cy, 0, 1, (_, y) => y > cy + 1);
      slits += seg(cx + k * sp, cy, -Math.sin(th), -Math.cos(th), (x, y) => y < cy - 1 && x < cx - 1);
      slits += seg(cx + k * sp, cy, Math.sin(th), -Math.cos(th), (x, y) => y < cy - 1 && x > cx + 1);
    }
    /* 星の光条: 中央はずれの 0.44、X の交点は 0.56 だけ反対へ */
    const off = 5 * Math.sin(t * 2.1),
      sx = 86,
      ym = 24 - 0.44 * off,
      yx = 24 + 0.56 * off,
      L = 30,
      tt = Math.tan(th);
    return (
      `<circle class="c" cx="${cx}" cy="${cy}" r="${r}"/>` +
      P('c t', slits) +
      P('c t', `M${cx - r} ${cy}H${cx + r}M${cx} ${cy - r}V${cy}`) +
      P('a', `M${sx - L} ${r1(ym)}H${sx + L}`) +
      P(
        'b',
        `M${sx - L} ${r1(yx + L * tt)}L${sx + L} ${r1(yx - L * tt)}M${sx - L} ${r1(yx - L * tt)}L${sx + L} ${r1(yx + L * tt)}`,
      ) +
      `<circle class="fc" cx="${sx}" cy="24" r="3"/>`
    );
  },
  /* 日食: 月が太陽を横切り、右の光の量の曲線の上を今の点が進む */
  se(t) {
    const R = 14,
      Rm = 14.6,
      cx = 26,
      cy = 24;
    /** 中心の距離 d で、太陽の面積のうち見えている割合 */
    const vis = (d: number): number => {
      if (d >= R + Rm) return 1;
      if (d <= Rm - R) return 0;
      const a1 = Math.acos((d * d + R * R - Rm * Rm) / (2 * d * R)),
        a2 = Math.acos((d * d + Rm * Rm - R * R) / (2 * d * Rm));
      return 1 - (R * R * (a1 - Math.sin(2 * a1) / 2) + Rm * Rm * (a2 - Math.sin(2 * a2) / 2)) / (Math.PI * R * R);
    };
    const u = mod(0.3 + t * 0.12, 1) * 2 - 1,
      span = 36,
      mx = cx + u * span,
      my = cy + u * 5,
      cur = (x: number): number => 10 + 28 * (1 - vis(Math.abs((x - 86) / 30) * Math.hypot(span, 5))),
      px = 86 + u * 30;
    return (
      `<clipPath id="ca-se"><rect x="4" y="4" width="46" height="40"/></clipPath><g clip-path="url(#ca-se)"><circle class="fa" cx="${cx}" cy="${cy}" r="${R}"/>` +
      `<circle class="c" style="fill:var(--screen)" cx="${r1(mx)}" cy="${r1(my)}" r="${Rm}"/></g>` +
      P('c d', 'M56 38H116') +
      P('b', fx(cur, 56, 116, 90)) +
      `<circle class="fb" cx="${r1(px)}" cy="${r1(cur(px))}" r="2.6"/>`
    );
  },
  /* 月: 左は満ち欠けする月、右は 1 か月の輝面比の曲線の上を今の点が進む */
  mn(t) {
    const R = 17,
      cx = 26,
      cy = 24,
      e = mod(1.2 + t * 0.9, TAU),
      rx = r1(R * Math.abs(Math.cos(e))),
      w = e < Math.PI,
      lit = `M${cx} ${cy - R}A${R} ${R} 0 0 ${w ? 1 : 0} ${cx} ${cy + R}A${rx} ${R} 0 0 ${(Math.cos(e) > 0) === w ? 0 : 1} ${cx} ${cy - R}Z`,
      k = (x: number): number => 40 - 30 * ((1 - Math.cos(((x - 56) / 60) * TAU)) / 2),
      px = 56 + (e / TAU) * 60;
    return (
      `<circle class="c" style="fill:var(--screen)" cx="${cx}" cy="${cy}" r="${R}"/>` +
      `<path class="fa" d="${lit}"/>` +
      P('c d', 'M56 40H116') +
      P('b', fx(k, 56, 116, 60)) +
      `<circle class="fb" cx="${r1(px)}" cy="${r1(k(px))}" r="2.6"/>`
    );
  },
  /* 木星: 縞のある本体の前と後ろを 4 つの衛星が行き来する（周期は 1:2:4:8、裏に回った衛星は隠れる） */
  jv(t) {
    const cx = 60,
      cy = 24,
      R = 12;
    const MO: [number, number, number][] = [
      [18, 1.6, 0.4],
      [27, 3.2, 2.1],
      [38, 6.4, 4.0],
      [53, 12.8, 1.0],
    ];
    let back = '',
      front = '';
    for (const [a, p, ph] of MO) {
      const u = (TAU * t) / p + ph,
        x = cx + a * Math.cos(u),
        behind = Math.sin(u) > 0;
      const dot = `<circle class="fc" cx="${r1(x)}" cy="${cy}" r="1.9"/>`;
      if (behind) {
        if (Math.abs(x - cx) > R + 1) back += dot;
      } else front += dot;
    }
    return (
      P('c t', `M4 ${cy}H116`) +
      back +
      `<clipPath id="ca-jv"><ellipse cx="${cx}" cy="${cy}" rx="${R}" ry="${r1(R * 0.935)}"/></clipPath>` +
      `<ellipse class="fa" cx="${cx}" cy="${cy}" rx="${R}" ry="${r1(R * 0.935)}"/>` +
      `<g clip-path="url(#ca-jv)">${P('c', `M${cx - R} ${cy - 3.5}H${cx + R}M${cx - R} ${cy + 3}H${cx + R}`, ' style="stroke-width:2.2"')}${P('c t', `M${cx - R} ${cy - 7.5}H${cx + R}M${cx - R} ${cy + 7}H${cx + R}`)}<ellipse class="fb" cx="${cx + 4}" cy="${cy + 5}" rx="2.6" ry="1.5"/></g>` +
      front
    );
  },
  /* 土星: 傾いた環の奥と手前で本体をはさみ、環の傾きがゆっくり開いて閉じる。衛星が環の外を行き来する */
  st(t) {
    const cx = 60,
      cy = 24,
      R = 10;
    const open = 0.1 + 0.28 * Math.abs(Math.sin((TAU * t) / 12.8));
    const ring = (rx: number, half: 0 | 1) =>
      `M${r1(cx - rx)} ${cy}A${rx} ${r1(rx * open)} 0 0 ${half} ${r1(cx + rx)} ${cy}`;
    const MO: [number, number, number][] = [
      [31, 3.2, 0.4],
      [42, 6.4, 2.6],
      [53, 12.8, 4.6],
    ];
    let back = '',
      front = '';
    for (const [a, p, ph] of MO) {
      const u = (TAU * t) / p + ph,
        x = cx + a * Math.cos(u),
        y = cy + a * open * 0.5 * Math.sin(u);
      const dot = `<circle class="fc" cx="${r1(x)}" cy="${r1(y)}" r="1.7"/>`;
      if (Math.sin(u) > 0) front += dot;
      else back += dot;
    }
    return (
      back +
      P('c', ring(24, 1)) +
      P('c t', ring(18, 1)) +
      `<ellipse class="fa" cx="${cx}" cy="${cy}" rx="${R}" ry="${r1(R * 0.9)}"/>` +
      P('c', ring(24, 0)) +
      P('c t', ring(18, 0)) +
      front
    );
  },
  /* SVG テーマスキーマチェッカー: 明るい地と暗い地に、テーマで配色と構図が変わる絵を並べる。
     昼は左上の太陽と山（光がゆっくり回る）、夜は右上の三日月と明るい線の山、またたく星 */
  svg(t) {
    const L = 31.5,
      D = 88.5,
      mt = (c: string, x: number): string =>
        P(c, `M${x - 21} 34L${x - 11} 26L${x - 1} 34`) + P(c, `M${x - 7} 34L${x + 5} 16L${x + 18} 34Z`),
      /* 太陽の光は 8 本なので 1/8 回転で同じ絵（角度はその余りを使う）。星の 1 周（2π/2.4 s）で 1/4 回転する */
      sx = L - 13,
      a0 = -Math.PI / 8 + mod(t * 0.6, TAU / 8);
    let ray = '';
    for (let i = 0; i < 8; i++) {
      const q = a0 + (i / 8) * TAU;
      ray += `M${r1(sx + 6 * Math.cos(q))} ${r1(16 + 6 * Math.sin(q))}L${r1(sx + 8 * Math.cos(q))} ${r1(16 + 8 * Math.sin(q))}`;
    }
    const star = (x: number, y: number, ph: number, r = 0.9): string =>
      `<circle class="sk" cx="${x}" cy="${y}" r="${r}" opacity="${r1(55 + 45 * Math.cos(2.4 * t + ph)) / 100}"/>`;
    /* 三日月は右側が光る。暗い部分も薄く描いて丸さを見せる */
    const mx = D + 15,
      R = 4.8,
      moon =
        `<circle class="mn g0" cx="${mx}" cy="14" r="${R}"/>` +
        P('mn', `M${mx} ${14 - R}A${R} ${R} 0 0 1 ${mx} ${14 + R}A${r1(R * 0.55)} ${R} 0 0 0 ${mx} ${14 - R}Z`);
    return (
      '<clipPath id="ca-svg-l"><rect x="6" y="7" width="51" height="34"/></clipPath><clipPath id="ca-svg-r"><rect x="63" y="7" width="51" height="34"/></clipPath>' +
      '<rect class="pl c" x="6" y="7" width="51" height="34" rx="1.5"/><rect class="pd c" x="63" y="7" width="51" height="34" rx="1.5"/>' +
      `<g clip-path="url(#ca-svg-l)"><circle class="sn" cx="${sx}" cy="16" r="4.2"/>${P('sr', ray)}${mt('ml', L)}${P('il', `M${L - 25} 34H${L + 25}`)}</g>` +
      `<g clip-path="url(#ca-svg-r)">${star(D - 18, 12, 0)}${star(D - 8, 9, 2.1, 0.7)}${star(D - 13, 20, 4, 0.7)}${star(D + 3, 10, 1)}${star(D + 21, 24, 3, 0.7)}` +
      `${moon}${mt('md', D)}${P('ih', `M${D - 25} 34H${D + 25}`)}</g>`
    );
  },
  /* チューナー: 針のメータ（±50 セント、合格の帯、純正律の ▼）。3 秒ごとに弾き直し、低めから振れて 0 に落ち着く */
  tu(t) {
    const R = 46,
      pt = (r: number, a: number): string =>
        `${r1(60 + r * Math.sin((a * Math.PI) / 180))} ${r1(59 - r * Math.cos((a * Math.PI) / 180))}`;
    let tk = '';
    for (let c = -50; c <= 50; c += 10) tk += `M${pt(c ? R - 4 : R - 7, c)}L${pt(R, c)}`;
    const tri = (a: number): string => `M${pt(R + 5, a - 3)}L${pt(R + 5, a + 3)}L${pt(R + 1.5, a)}Z`,
      u = mod(t, 3),
      c = -20 * Math.exp(-u / 0.6) * Math.cos(TAU * 0.9 * u);
    return (
      P('c', `M${pt(R, -50)}A${R} ${R} 0 0 1 ${pt(R, 50)}`) +
      P('c t', tk) +
      P('b', `M${pt(R - 2, -3)}A${R - 2} ${R - 2} 0 0 1 ${pt(R - 2, 3)}`) +
      P('fc', tri(-13.7) + tri(15.6)) +
      P('a', `M${pt(14, c)}L${pt(R + 2, c)}`)
    );
  },
  /* ウェーブレット変換: 2 進の区切り（低いほど横長の箱）の上を、1 つの箱とその波形が段を替えながら滑る */
  wv(t) {
    /* 段ごとの [上端, 下端, 箱の幅]（上が高い周波数） */
    const B: [number, number, number][] = [
        [4, 24, 7],
        [24, 34, 14],
        [34, 40, 28],
        [40, 44, 56],
      ],
      j = Math.floor(mod(t, 6) / 1.5),
      [y0, y1, w] = B[(j + 1) % 4],
      x0 = 4 + mod(28 + (112 * mod(t, 1.5)) / 1.5, 112 - w + 0.001),
      xc = x0 + w / 2,
      /* 箱の幅に 2 周期ほど入る Morlet の実部 */
      g = (x: number) => 24 - 15 * Math.exp(-0.5 * ((x - xc) / (w / 5)) ** 2) * Math.cos((TAU * 2.2 * (x - xc)) / w);
    let grid = '';
    for (const [a, b, d] of B) {
      grid += `M4 ${b}H116`;
      for (let x = 4 + d; x < 116; x += d) grid += `M${x} ${a}V${b}`;
    }
    return (
      P('c t g', grid) +
      P('fa g', `M${r1(x0)} ${y0}H${r1(x0 + w)}V${y1}H${r1(x0)}Z`) +
      P('a', fx(g, Math.max(4, xc - w), Math.min(116, xc + w), 60))
    );
  },
  /* PCM: 波を決まった位置で測って丸めた階段。波が流れると階段の高さが変わる */
  pcm(t) {
    const w = (x: number) => Math.sin(TAU * (x / 56 - t / 3)),
      y = (v: number) => r1(24 - 18 * v);
    let st = '';
    for (let k = 0; k <= 16; k++) {
      const x = 4 + 7 * k,
        Y = y(Math.round(w(x) * 4) / 4);
      st += k ? `H${x}V${Y}` : `M${x} ${Y}`;
    }
    return (
      P(
        'b t',
        fx((x) => y(w(x)), 4, 116, 56),
      ) + P('a', st)
    );
  },
  /*
   * ADPCM: 左から 1 標本ずつ進み、小さい音が急に大きくなると段階の束が一気に広がる。
   * 止まっているときは描き終えた絵で、動かすと 1 コマで描き直す。描き終えると 1 秒止まって次の周へ進む。
   * 周の頭の 1 コマまで描き終えた絵なので、止まる 1 秒はそのコマを含む。1 周は 26 コマ（8 コマ/秒）
   */
  adp(t) {
    const y = (v: number) => r1(24 - 19 * v),
      last = ADP.x.length - 1,
      f = mod(Math.floor(t * 8), 26),
      u = f ? Math.min(last, f - 1) : last;
    let wave = '',
      tick = '',
      st = '';
    for (let k = 0; k <= last; k++) {
      const x = 4 + 6 * k;
      wave += `${k ? 'L' : 'M'}${x} ${y(ADP.x[k])}`;
      if (k > u) continue;
      for (let m = -2; m <= 2; m++) tick += `M${r1(x - 2.25)} ${y(ADP.p[k] + m * ADP.g[k])}H${r1(x + 2.25)}`;
      st += k ? `H${x}V${y(ADP.y[k])}` : `M${x} ${y(ADP.y[k])}`;
    }
    return P('b t', wave) + P('c t', tick) + P('a', st);
  },
  /*
   * VVVF: 基本波とキャリアを比べて、出力のオン・オフを左から順に作る。止まっているときは 1 周期を描き終えた絵。
   * 図柄が小さいので倍率は 9 倍に固定し、速度で変えない。1 周は 4 秒で、36 コマで描く（12 コマ/秒）
   */
  shp(t) {
    /* スペクトログラムの線: 根音は ch1、ほかの音は ch2。上がり続け、山の外に近い上下の端は細い線で描く */
    const X0 = 4,
      X1 = 116,
      Y0 = 4,
      Y1 = 44,
      k = 0.3,
      S = 15,
      sh = mod(Math.floor(t * 12 + 1e-9) / 12, 3) / 3,
      line = (c: number, cls: string): string => {
        const part = (ya: number, yb: number, cl: string): string => {
          const a = Math.max(X0, X0 + (c - ya) / k),
            b = Math.min(X1, X0 + (c - yb) / k);
          return b > a ? P(cl, `M${r1(a)} ${r1(c - k * (a - X0))}L${r1(b)} ${r1(c - k * (b - X0))}`) : '';
        };
        return part(Y1, 36, `${cls} t`) + part(36, 12, cls) + part(12, Y0, `${cls} t`);
      };
    let s = '';
    for (let o = -1; o < 6; o++)
      for (const [f, cls] of [
        [0, 'a'],
        [4 / 12, 'b'],
        [7 / 12, 'b'],
      ] as const)
        s += line(14 + (o - sh - f + 1) * S, cls);
    return s;
  },
  vv(t) {
    const w = mod(t, 4),
      end = w < 0.6 ? 1 : Math.min(1, Math.floor((w - 0.6) * 12) / 36),
      tr = (x: number): number => {
        const q = x - Math.floor(x);
        return q < 0.25 ? 4 * q : q < 0.75 ? 2 - 4 * q : 4 * q - 4;
      },
      y = (v: number): number => 15 - 11 * v,
      X0 = 4,
      W = 112;
    let out = '',
      prev: boolean | null = null;
    const lim = Math.floor(480 * end);
    for (let k = 0; k <= lim; k++) {
      const u = k / 480,
        on = 0.8 * Math.sin(TAU * u) >= -tr(9 * u),
        x = r1(X0 + W * u),
        yy = on ? 31 : 44;
      if (prev === null) out += `M${x} ${yy}`;
      else if (on !== prev) out += `H${x}V${yy}`;
      prev = on;
    }
    if (lim > 0) out += `H${r1(X0 + (W * lim) / 480)}`;
    return (
      P(
        'c t',
        fx((x) => y(-tr((9 * (x - X0)) / W)), X0, X0 + W, 144),
      ) +
      P(
        'b',
        fx((x) => y(0.8 * Math.sin((TAU * (x - X0)) / W)), X0, X0 + W, 48),
      ) +
      P('a', out)
    );
  },
  /*
   * 天体衝突: 丸い天体の縁へ衝突体が落ち、穴が 4 段で開く。破片は遠くへ去る筋と、地表へ落ちる粒に分かれる。
   * 止まっているときは落下の途中で、地表はまだ変わっていない。1 周は 53 コマ（12 コマ/秒）
   */
  imp(t) {
    const u = mod(Math.floor(t * 12) + 5, 53) / 53,
      hit = 0.2,
      g = clamp(Math.ceil((u - hit) / 0.06) / 4, 0, 1),
      R = 22 * g,
      dep = 9 * g,
      rim = 3 * g,
      arc = (r: number, x: number): number => 124 - Math.sqrt(r * r - (x - 60) ** 2),
      gy = (x: number): number => {
        const a = Math.abs(x - 60);
        return (
          arc(96, x) - rim * Math.exp(-(((a - R) / 4.5) ** 2)) + (a < R ? dep * (1 - (a / Math.max(R, 1)) ** 2) : 0)
        );
      };
    let s =
      P(
        'c t g',
        fx((x) => arc(88, x), 4, 116, 40),
      ) +
      P(
        'c t g',
        fx((x) => arc(81, x), 4, 116, 40),
      ) +
      P('a', fx(gy, 4, 116, 56));
    if (u < hit) {
      const k = 1 - u / hit,
        x = 60 + 34 * k,
        y = 24 - 18 * k;
      s +=
        P('a', `M${r1(x + 5)} ${r1(y - 3.3)}L${r1(x + 13)} ${r1(y - 8.5)}`) +
        `<circle class="fa" cx="${r1(x)}" cy="${r1(y)}" r="3.6"/>`;
    } else if (u < hit + 0.06) {
      /* 当たった瞬間の放射の線 */
      let d = '';
      for (let i = 0; i < 7; i++) {
        const a = Math.PI * (1 + (i + 0.5) / 7),
          c = Math.cos(a),
          e = Math.sin(a);
        d += `M${r1(60 + 6 * c)} ${r1(28 + 6 * e)}L${r1(60 + 17 * c)} ${r1(28 + 17 * e)}`;
      }
      s += P('a', d);
    }
    let far = '';
    for (let i = 0; i < 18; i++) {
      const out = i % 3 === 0,
        side = i % 2 ? 1 : -1,
        tau = u - hit - hn(i + 3) * 0.1;
      if (tau <= 0) continue;
      const ang = (((out ? 22 : 38) + hn(i + 11) * (out ? 26 : 28)) * Math.PI) / 180,
        sp = out ? 105 + hn(i + 31) * 45 : 70 + hn(i + 21) * 70,
        vx = sp * Math.cos(ang) * side,
        vy = sp * Math.sin(ang),
        x = 60 + side * 4 + vx * tau,
        y = 28 - vy * tau + (out ? 0 : 200) * tau * tau;
      if (x < 3 || x > 117 || y < 1) continue;
      if (out) far += `M${r1(x)} ${r1(y)}L${r1(x - vx * 0.05)} ${r1(y + vy * 0.05)}`;
      else if (y <= gy(clamp(x, 4, 116))) s += `<circle class="fa" cx="${r1(x)}" cy="${r1(y)}" r="1.3"/>`;
    }
    return far ? s + P('b', far) : s;
  },
  /* MP3: 周波数の棒をローパスが右から削る。捨てた高音は細い線になり、残りの棒が伸びる */
  mp3(t) {
    const xc = 66 + 34 * Math.sin((TAU * t) / 4);
    let keep = '',
      gone = '';
    for (let i = 0; i < 28; i++) {
      const x = 6 + i * 4,
        h = 34 * Math.exp(-i / 14) * (0.55 + 0.45 * hn(i + 90)) + 3,
        gain = 1 + (0.35 * (100 - xc)) / 34;
      if (x < xc) keep += `M${x} 45V${r1(45 - Math.min(40, h * gain))}`;
      else gone += `M${x} 45V${r1(45 - h)}`;
    }
    return P('c t g', gone) + P('a', keep) + P('b t', `M${r1(xc)} 4V46`);
  },
  /* 雑音除去と圧縮: 走査線の左は雑音の消えた波形、右は雑音入り。下の係数は閾値の帯より小さいものが左から消える */
  wd(t) {
    /* 止まっているときは走査線が真ん中 */
    const xs = 4 + 112 * mod(t / 4 + 0.5, 1),
      s = (x: number) =>
        Math.exp(-(((x - 38) / 9) ** 2)) * Math.sin(x * 1.3) +
        0.6 * Math.exp(-(((x - 84) / 14) ** 2)) * Math.sin(x * 0.55),
      wave = (x0: number, x1: number, nz: number) =>
        x1 - x0 < 1
          ? ''
          : fx((x) => 15 - 10 * (s(x) + nz * (hn(Math.round(x * 2)) - 0.5)), x0, x1, Math.ceil((x1 - x0) * 2));
    let keep = '',
      drop = '';
    for (let i = 0; i < 28; i++) {
      const x = 6 + i * 4,
        /* 大きい係数は波の山の所だけ */
        v = 13 * Math.abs(s(x)) + 3 * hn(i + 50),
        seg = `M${x} 45V${r1(45 - v)}`;
      if (v > 5.5) keep += seg;
      else if (x > xs) drop += seg;
    }
    return (
      P('fc', `M4 ${45 - 5.5}H116V45H4Z`) +
      P('c t', 'M4 45H116') +
      (drop ? P('c g', drop) : '') +
      P('a', keep) +
      P('c g', wave(xs, 116, 0.9)) +
      P('a', wave(4, xs, 0)) +
      P('c d', `M${r1(xs)} 3V47`)
    );
  },
  /* 音律とうなり: 2 つの近い部分音の和。包絡（破線）の山と谷が流れる */
  /* 畳み込み: 反転した核が矩形の入力の上を滑り、重なりの面積（塗り）が上の出力の曲線を描いていく */
  cv(t) {
    const c = 24 + mod(28 + (76 * t) / 3, 76),
      tau = 8,
      a = 30,
      b = 60,
      /* y(c) = ∫ rect(x)·e^(−(c − x)/τ)/τ dx */
      y = (u: number) => (u <= a ? 0 : Math.exp(-(u - Math.min(u, b)) / tau) - Math.exp(-(u - a) / tau)),
      h = (x: number) => (x > c + 1e-6 ? 44 : 44 - 14 * Math.exp(-Math.max(0, c - x) / tau)),
      lo = a,
      hi = Math.min(b, c);
    let fill = '';
    if (hi > lo) fill = P('fa g', `${fx(h, lo, hi, 24)}L${r1(hi)} 44L${r1(lo)} 44Z`);
    return (
      P('c t', 'M4 22H116M4 44H116') +
      P(
        'a g',
        fx((u) => 22 - 15 * y(u), 4, 116, 112),
      ) +
      P(
        'a',
        fx((u) => 22 - 15 * y(u), 4, c, Math.max(2, Math.round(c - 4))),
      ) +
      fill +
      P('b', `M4 44H${a}V30H${b}V44H116`) +
      P('c', `${fx(h, 4, c, 60)}L${r1(c)} 44`) +
      P('c d t', `M${r1(c)} 4V46`)
    );
  },
  tm(t) {
    const e = (x: number): number => Math.abs(Math.cos(TAU * 0.0125 * (x - 4) - 1.2 * t));
    return (
      P('c t', 'M4 24H116') +
      P(
        'c d',
        fx((x) => 24 - 17 * e(x), 4, 116, 112),
      ) +
      P(
        'c d',
        fx((x) => 24 + 17 * e(x), 4, 116, 112),
      ) +
      P(
        'a',
        fx((x) => 24 - 17 * e(x) * Math.sin((TAU * (x - 4)) / 5), 4, 116, 336),
      )
    );
  },
  /* 分岐図: ロジスティック写像の枝分かれ（周期 1〜8 は線、その先のカオスは点）。r の縦線が左から右へ動き、その r の軌道の点を光らせる */
  bf(t) {
    /* r は丸めた位置から決める（カオスの軌道は r のわずかな差で変わるので、1 周後も同じ絵にするため） */
    const X = r1(4 + 112 * mod(t / LOOP.bf + 0.55, 1)),
      r = 2.9 + (1.1 * (X - 4)) / 112;
    let x = 0.3,
      d = '';
    for (let i = 0; i < 400; i++) x = r * x * (1 - x);
    for (let i = 0; i < 24; i++) {
      x = r * x * (1 - x);
      d += `<circle class="fa" cx="${X}" cy="${r1(44 - 40 * x)}" r="1.4"/>`;
    }
    return BF() + P('a t', `M${X} 4V44`) + d;
  },
  /* 残響: 上から見た部屋で、音源と 1 回反射の鏡像から波面が広がる。右はインパルス応答が届いた所まで */
  rv(t) {
    const X0 = 4,
      Y0 = 6,
      W = 48,
      H = 36,
      sx = 16,
      sy = 19,
      u = mod(t, 2.4) / 2.4,
      R = 3 + 64 * u,
      inside = (x: number, y: number): boolean => x >= X0 && x <= X0 + W && y >= Y0 && y <= Y0 + H,
      /* 円のうち部屋の中の弧だけを折れ線にする */
      arc = (cx: number, cy: number): string => {
        let d = '',
          on = false;
        for (let k = 0; k <= 96; k++) {
          const a = (TAU * k) / 96,
            x = cx + R * Math.cos(a),
            y = cy + R * Math.sin(a);
          if (inside(x, y)) {
            d += `${on ? 'L' : 'M'}${r1(x)} ${r1(y)}`;
            on = true;
          } else on = false;
        }
        return d;
      },
      imgs: [number, number][] = [
        [2 * X0 - sx, sy],
        [2 * (X0 + W) - sx, sy],
        [sx, 2 * Y0 - sy],
        [sx, 2 * (Y0 + H) - sy],
      ];
    /* インパルス応答: 直接音・1 回反射・密になる残響。今の時刻まで描く */
    const ir: [number, number][] = [],
      T0 = 64,
      T1 = 116,
      now = T0 + (T1 - T0) * u;
    for (let k = 0; k < 44; k++) {
      const x = T0 + 2 + (k < 5 ? [0, 5, 8, 12, 15][k] : 15 + (k - 4) * 0.9),
        h = k === 0 ? 30 : 30 * Math.exp(-(x - T0) / 14) * (0.5 + 0.5 * hn(k));
      if (x <= now) ir.push([x, h]);
    }
    return (
      P('c', `M${X0} ${Y0}h${W}v${H}h${-W}Z`) +
      P('a', arc(sx, sy)) +
      P('b', imgs.map(([x, y]) => arc(x, y)).join('')) +
      P('fc', `M${sx - 1.6} ${sy}a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0`) +
      P('c t', `M${T0} 42H${T1}`) +
      P('a', ir.map(([x, h]) => `M${r1(x)} 42V${r1(42 - h)}`).join('')) +
      P('c d', `M${r1(now)} 6V42`)
    );
  },
  /* 雷鳴（仮）: ジグザグの放電路の折れ目から波面が広がり、右の波形は届いた所まで。最初の鋭い山のあとにゴロゴロが続く */
  th(t) {
    const u = mod(t + 1.6, 3) / 3,
      R = 2 + 62 * u,
      bolt: [number, number][] = [];
    for (let k = 0; k <= 8; k++) bolt.push([16 + 9 * (hn(k + 40) - 0.5) + (k % 2 ? 3 : -3), 4 + 4.75 * k]);
    /* 円のうち地面より上で、左右の枠の中の弧だけ */
    const arc = ([cx, cy]: [number, number]): string => {
      let d = '',
        on = false;
      for (let k = 0; k <= 72; k++) {
        const a = (TAU * k) / 72,
          x = cx + R * Math.cos(a),
          y = cy + R * Math.sin(a);
        if (x >= 4 && x <= 60 && y >= 2 && y <= 43) {
          d += `${on ? 'L' : 'M'}${r1(x)} ${r1(y)}`;
          on = true;
        } else on = false;
      }
      return d;
    };
    const X0 = 66,
      X1 = 116,
      now = X0 + (X1 - X0) * u,
      wave: [number, number][] = [];
    for (let x = X0; x <= now; x += 0.5) {
      const s = x - X0,
        clap = s < 3 ? 14 * (1 - (2 * s) / 3) : 0,
        rumble = s >= 3 ? 9 * Math.exp(-(s - 3) / 22) * (hn(Math.floor(s * 1.3)) - 0.5) * 2 * Math.sin(s * 2.1) : 0;
      wave.push([x, 24 - clap - rumble]);
    }
    return (
      P('c t', 'M4 43H60') +
      P('a', pl(bolt)) +
      P('b', [bolt[2], bolt[5], bolt[8]].map(arc).join('')) +
      P('fc', 'M56.4 41a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0') +
      P('c t', `M${X0} 24H${X1}`) +
      (wave.length > 1 ? P('a', pl(wave)) : '')
    );
  },
  /* FFT: 8 点のバタフライ図。段ごとに線を光が流れ、通った段は青で残る */
  ff(t) {
    const X = [8, 45, 82, 112],
      Y = (r: number): number => 6 + r * 5.2,
      ph = mod(t + 2.6, 3),
      k = Math.floor(ph),
      u = ph - k;
    let base = '',
      past = '',
      cur = '',
      nd = '';
    for (let s = 0; s < 3; s++) {
      const h = 1 << s,
        x0 = X[s],
        x1 = X[s + 1];
      for (let r = 0; r < 8; r++) {
        const q = r & h ? r - h : r + h;
        for (const v of [r, q]) {
          const seg = `M${x0} ${r1(Y(r))}L${x1} ${r1(Y(v))}`;
          base += seg;
          if (s < k) past += seg;
          else if (s === k) cur += `M${x0} ${r1(Y(r))}L${r1(x0 + (x1 - x0) * u)} ${r1(Y(r) + (Y(v) - Y(r)) * u)}`;
        }
      }
    }
    for (const x of X)
      for (let r = 0; r < 8; r++) nd += `M${x - 1.6} ${r1(Y(r))}a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0`;
    return P('c t g', base) + P('b t', past) + P('a', cur) + P('fc', nd);
  },
  /* マクスウェルの悪魔: 扉の上の悪魔が、扉を通った分子の来た側を見る。速い分子は右、遅い分子は左にたまる */
  mxd(t) {
    const { x0, x1, y0, y1, gap, r, L, fps } = MX,
      k = Math.floor(mod(t, L) * fps + 1e-9),
      f = MX_FRAMES[k],
      mid = (x0 + x1) / 2,
      yc = (y0 + y1) / 2,
      gt = yc - gap / 2,
      gb = yc + gap / 2;
    let look = 0;
    for (let j = k; j > k - 4 && j >= 0; j--)
      if (MX_FRAMES[j].open) {
        look = -MX_FRAMES[j].open;
        break;
      }
    const door = f.open
        ? `M${mid} ${r1(gt)}L${r1(mid + f.open * gap * 0.7)} ${r1(gt - gap * 0.45)}`
        : `M${mid} ${r1(gt)}V${r1(gb)}`,
      cx = 60,
      cy = 8.6,
      e = look * 1.6;
    let a = '',
      b = '';
    for (const [x, y, fast] of f.p) {
      if (fast) a += mxDot(x, y, r);
      else b += mxDot(x, y, r);
    }
    return (
      P('c', `M${x0} ${y0}H${x1}V${y1}H${x0}Z`) +
      P('c w', `M${mid} ${y0}V${r1(gt)}M${mid} ${r1(gb)}V${y1}`) +
      P('c t', door) +
      P('fa', a) +
      P('fb', b) +
      P(
        'c',
        `M${cx - 4.6} ${cy - 2.6}L${cx - 6.6} ${cy - 7.6}L${cx - 2.2} ${cy - 4.6}M${cx + 4.6} ${cy - 2.6}L${cx + 6.6} ${cy - 7.6}L${cx + 2.2} ${cy - 4.6}`,
      ) +
      P('c', mxDot(cx, cy, 5.4)) +
      P('fc', mxDot(cx - 2 + e, cy - 0.4, 1.1) + mxDot(cx + 2 + e, cy - 0.4, 1.1))
    );
  },
  /* I2C: 上に流れる SCL と SDA、下に 2 本の線と 4 台の機器。右端（今）で SDA を下げている機器を塗る */
  i2c(t) {
    const i0 = Math.floor(t * I2C_QPS + 1e-9) + 2,
      now = I2C.who[mod(i0 + I2C_N - 1, I2C.who.length)];
    let s =
      P('a', i2cLine(I2C.scl, i0, 3, 10)) +
      P('b', i2cLine(I2C.sda, i0, 13, 20)) +
      P('b t', 'M4 26H116') +
      P('a t', 'M4 29H116');
    [4, 34, 64, 94].forEach((x, j) => {
      s += P('c t', `M${x + 7} 26V34M${x + 15} 29V34`);
      const fill = (j === 0 && now === 0) || (j === 1 && now === 2);
      s += fill
        ? `<rect class="${j ? 'fa' : 'fc'}" x="${x}" y="34" width="22" height="11"/>`
        : P('c', `M${x} 34h22v11h-22z`);
    });
    return s;
  },
};

/**
 * 図柄の 1 周 [s]。t > 0 で、t と t + 1 周は同じ絵になる。離したときは 1 周で割った余りから戻す（scripts/card-motion.ts）。
 * JJY（14 s）とノイズ（25.4 s）は長いので 2 s で区切る。どちらも絵がとびとびに変わるので、余りへ移ったときの飛びは目立たない
 */
export const LOOP: Record<string, number> = {
  sq: 36 / 30,
  rr: 7 / 14,
  pid: TAU / 1.6,
  ip: TAU / 2.4,
  kf: TAU / 1.4,
  bq: TAU / 1.3,
  iir: TAU / 1.5,
  jjy: 2,
  jjyd: (11 * 14) / 21,
  qr: TAU / 0.45,
  fir: TAU / 1.8,
  pz: TAU / 0.7,
  cc: 2,
  os: 48 / 17,
  sp: 2,
  fm: TAU / 1.5,
  nz: 2,
  dp: 1.2,
  gt: 3,
  pn: 0.32 * 7 + 1.2,
  pa: 3,
  vn: 3.2,
  tp: 4.8,
  pc: 16 / 30,
  jp: 3,
  rz: 3,
  png: 3.4,
  gif: 3,
  crp: 3,
  og: 3,
  en: 720 / 400,
  ln: TAU / 1.4,
  hl: TAU / 0.8,
  fk: TAU / 2.1,
  se: 1 / 0.12,
  mn: TAU / 0.9,
  jv: 12.8,
  st: 12.8,
  svg: TAU / 2.4,
  tu: 3,
  tm: Math.PI / 1.2,
  wv: 6,
  bf: 4,
  rv: 2.4,
  cv: 3,
  icv: 3,
  dm: 3,
  rs: 3,
  rt: 3,
  sh: 3,
  th: 3,
  ff: 3,
  wd: 4,
  so: 3,
  gm: 3.6,
  ls: 3,
  hp: 50 / HP_FPS,
  bt: 52 / BT_FPS,
  ep: EP_FRAMES.length / EP_FPS,
  pcm: 3,
  adp: 26 / 8,
  mp3: 4,
  imp: 53 / 12,
  vv: 4,
  shp: 3,
  mxd: MX.L,
  i2c: I2C.scl.length / I2C_QPS,
};

/** 止まっているときの図柄（ビルド時に HTML へ出す） */
export const artAt = (key: string): string => ART[key]?.(0) ?? '';
