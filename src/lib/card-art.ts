/**
 * カードの図柄（ToolCard の svg の中身。viewBox は 0 0 120 48）。
 * 図柄は時刻 t [s] の関数で、t = 0 が止まっているときの絵である。ビルド時に t = 0 を HTML に出し、
 * マウスを乗せている間だけブラウザで t を進めて描き直す（scripts/card-motion.ts）。
 * 線の class は site.css の .ic にある: a = ch1、b = ch2、c = 画面の線、d = 破線、t = 細線、g = 残像、
 * w = 黒鍵の太線、fa・fb・fc = 塗り、pl・pd・il・ih・al・ad = SVG テーマの図柄の明るい地と暗い地
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
  /* SVG テーマスキーマチェッカー: 明るい地と暗い地に同じ SVG を並べる。暗い地では黒い線が見えにくい。
     2 枚が同じ倍率で拡大する */
  svg(t) {
    const z = r1(100 + 45 * (0.5 - 0.5 * Math.cos(t * 1.8))) / 100;
    const fig = (cx: number, ink: string, ac: string): string =>
      `<g${z !== 1 ? ` transform="translate(${cx} 24) scale(${z}) translate(${-cx} -24)"` : ''}>` +
      `<circle class="${ac}" cx="${cx - 8}" cy="21" r="6"/>${P(ink, `M${cx - 3} 33L${cx + 5} 16L${cx + 13} 33Z`)}${P(ac, `M${cx - 17} 33H${cx + 17}`)}</g>`;
    return (
      '<clipPath id="ca-svg-l"><rect x="6" y="7" width="51" height="34"/></clipPath><clipPath id="ca-svg-r"><rect x="63" y="7" width="51" height="34"/></clipPath>' +
      '<rect class="pl c" x="6" y="7" width="51" height="34" rx="1.5"/><rect class="pd c" x="63" y="7" width="51" height="34" rx="1.5"/>' +
      `<g clip-path="url(#ca-svg-l)">${fig(31.5, 'il', 'al')}</g><g clip-path="url(#ca-svg-r)">${fig(88.5, 'ih', 'ad')}</g>`
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
  /* 音律とうなり: 2 つの近い部分音の和。包絡（破線）の山と谷が流れる */
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
  gt: 3,
  pn: 0.32 * 7 + 1.2,
  pa: 3,
  vn: 3.2,
  tp: 4.8,
  pc: 16 / 30,
  jp: 3,
  og: 3,
  en: 720 / 400,
  ln: TAU / 1.4,
  hl: TAU / 0.8,
  fk: TAU / 2.1,
  se: 1 / 0.12,
  mn: TAU / 0.9,
  svg: TAU / 1.8,
  tu: 3,
  tm: Math.PI / 1.2,
};

/** 止まっているときの図柄（ビルド時に HTML へ出す） */
export const artAt = (key: string): string => ART[key]?.(0) ?? '';
