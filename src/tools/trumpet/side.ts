import { arc, f1, join, lerpT, mpIn, normals, OUT, P, type Pt, RIM, rect, ribbon, seg } from './shapes';

/**
 * 横から見たトランペットの図の形（DOM に依存しない。図の座標、約 1.73 px/mm）。
 * 奏者の右側から見た図。各部の位置・太さ・形は、Wikimedia Commons の写真「Yamaha Trumpet YTR-8335LA.tif」
 * （Yamaha Corporation、CC BY-SA 4.0）をベルの縁の直径 123 mm で図の縮尺にそろえて測った（写真の傾きは直し、
 * リードパイプ・下の段の管を水平にした。ベル管は写真どおりベルへ向かって少し上がる）。弁のケースの口の位置は写真
 * 「Trompette - corps.JPG」（Wikimedia Commons、Eusebius、CC BY 3.0。抜差しを外した本体）で確かめた。管の通り道:
 * マウスピース → リードパイプ → 主管抜差し → 下の管 → 第 3 弁 → 弁の間の管 → 第 2 弁 → 弁の間の管 → 第 1 弁 →
 * ベル管の下の管（第 1 抜差しの奥）→ ベルの曲がり → ベル管（弁のケースの奥）→ ベル。第 3 抜差しの下の管は主管抜差しの
 * 下の管の奥に隠れる。弁のケースの中の通り道は外から見えないので、ケースの奥に置く（見えるのはケースの間の管だけ）。
 * 写真は少し上・少し前から写っているので、縦の円柱（ケース・キャップ・ボタン）の上下の縁は手前の弧、手前へ出る
 * 第 2 抜差しの輪は斜めの楕円で描く。ベルは少し奥を向くので開口の中は見えず、縁は楕円に見える（手前の半分はすべて、
 * 奥の半分は胴に隠れるまで）。縁の内側は、ほかの管と同じく気柱を透かして描く。金属には左上からの光の明るい筋と
 * 暗い帯を重ねる（style.css の t-hl・t-sh・t-gl）
 */
export const SIDE_VIEW = '-10 -42 985 362';
const PXM = 1.73;
/** 弁の中心の x と、ケースの胴の半幅（気柱の通り道の目安） */
export const VX = [362, 403, 444] as const;
const CW = 17.5;
/** 中心線の高さ: リードパイプ（とマウスピース）、下の段（主管抜差しの下の管・弁の間の管・ベル管の下の管） */
const Y_LP = 142.5,
  Y_LOW = 240;
/** 円筒部の管の外の半幅と、気柱の半幅（内径 11.65 mm から管の壁の分を引いた見た目の値） */
const HW = 10.6,
  AIR = 9;
/** ベル管の中心線の高さ（x）。写真の上下の縁の中点 */
const BELL_Y: readonly (readonly [number, number])[] = [
  [195.5, 114.2],
  [330, 113.5],
  [462, 112.1],
  [540, 111.2],
  [600, 110.7],
  [700, 109.7],
  [840, 108.75],
  [926, 108.5],
];
const bellY = (x: number) => lerpT(BELL_Y, x);
/** ベルの曲がり（中心と半径） */
const BOW = { x: 195.5, y: (BELL_Y[0][1] + Y_LOW) / 2, r: (Y_LOW - BELL_Y[0][1]) / 2 };
/**
 * ベル管の外の半幅（x）。写真の上の縁から測った。弁のケースの奥（x 345〜466）はケースの間で測った。
 * 縁の近く（x 905 より右）は、写真の外形が縁の楕円の奥の半分なので、ベルの胴の輪郭は 107 − 6.73 d^0.58（d は縁の面までの距離）で補った
 */
const BELL: readonly (readonly [number, number])[] = [
  [195.5, 11.5],
  [220, 12],
  [260, 12.5],
  [300, 13.15],
  [345, 14.1],
  [420, 15.3],
  [466, 16],
  [540, 17.65],
  [580, 18.5],
  [640, 19.8],
  [700, 22.4],
  [740, 24.6],
  [780, 27.3],
  [820, 32.1],
  [840, 35.2],
  [860, 40.2],
  [880, 48.4],
  [890, 54.2],
  [900, 62.4],
  ...Array.from({ length: 22 }, (_, i): [number, number] => [905 + i, Math.min(106.5, 107 - 6.73 * (21 - i) ** 0.58)]),
];
/**
 * ベルの縁: 縁の面の中心の x・高さ、楕円の横と縦の半径。ベルは少し奥を向くので、開口の中は見えない。縁の楕円の手前の半分
 * （右へふくらむ弧）はすべて見え、奥の半分は上と下の頂点から胴の輪郭に重なるところまで見えて、その先は胴に隠れる。縁の巻きの太さ
 */
const MOUTH = { x: 926, y: 108.5, rx: 25, ry: 107, w: 3.6 };
/** ベルの曲がりとベル管の外の半幅（曲がりは下の 10.6 から上の 11.5 へ太る） */
const bellHw = (p: Pt) =>
  p[0] < BOW.x - 0.01 || p[1] > bellY(p[0]) + 0.5 ? HW + (0.9 * (Y_LOW - p[1])) / (2 * BOW.r) : lerpT(BELL, p[0]);
const bellPts = () => {
  const out = arc(BOW.x, BOW.y, BOW.r, 90, 270, 4);
  for (let x = BOW.x + 4; x < MOUTH.x; x += x < 896 ? 4 : 1) out.push([x, bellY(x)]);
  out.push([MOUTH.x, bellY(MOUTH.x)]);
  return out;
};

/** 主管抜差しの曲がり: 縦の管の中心 x、上の角と下の角の半径（写真では下の角が大きく丸い） */
const MC = { x: 737.75, rt: 35, rb: 41 };
/** 曲がりの中心線（上の管の x0 → 角 → 縦 → 角 → 下の管の x1。x1 が下の角の中なら角の途中で止める） */
const crookPts = (x0: number, x1: number) => {
  const xb = MC.x - MC.rb,
    end = x1 >= xb ? (Math.acos(Math.min(1, (x1 - xb) / MC.rb)) * 180) / Math.PI : 90;
  return join(
    seg(x0, Y_LP, MC.x - MC.rt, Y_LP),
    arc(MC.x - MC.rt, Y_LP + MC.rt, MC.rt, -90, 0, 3),
    seg(MC.x, Y_LP + MC.rt, MC.x, Y_LOW - MC.rb),
    arc(xb, Y_LOW - MC.rb, MC.rb, 0, end, 3),
    x1 < xb ? seg(xb, Y_LOW, x1, Y_LOW) : [],
  );
};
/** 第 1 抜差し: 上下の管の高さ、曲がりの中心 x、ケースへ曲がる端の x */
const S1 = { yu: 219, yl: 255, x: 251, xe: 352 };
const s1Bend = () => arc(S1.x, (S1.yu + S1.yl) / 2, (S1.yl - S1.yu) / 2, 270, 90, 3);
/** 第 3 抜差し: 上の管の高さ（下の管は Y_LOW）、曲がりの中心 x、ケースの口の x */
const S3 = { yu: 208.5, x: 650, xe: VX[2] + CW };
const s3Bend = () => arc(S3.x, (S3.yu + Y_LOW) / 2, (Y_LOW - S3.yu) / 2, -90, 90, 3);

/** 3 次の Bézier を n 区切りの点にする */
const bez = (a: Pt, b: Pt, c: Pt, d: Pt, n: number): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n,
      u = 1 - t;
    return [
      u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
      u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
    ];
  });
/** 点の列をなめらかにつなぐ（Catmull-Rom を n 区切りずつ） */
const smooth = (q: readonly Pt[], n = 6): Pt[] => {
  const out: Pt[] = [q[0]];
  for (let i = 0; i + 1 < q.length; i++) {
    const p0 = q[Math.max(0, i - 1)],
      p1 = q[i],
      p2 = q[i + 1],
      p3 = q[Math.min(q.length - 1, i + 2)];
    out.push(
      ...bez(
        p1,
        [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
        [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
        p2,
        n,
      ).slice(1),
    );
  }
  return out;
};
const at = (p: Pt, d: Pt, t: number): Pt => [p[0] + t * d[0], p[1] + t * d[1]];

/**
 * 第 2 抜差し: 第 2 弁のケースの手前の 2 つの口 u0・l0 から、左下の手前へ出る U 字の管。管の面が手前へ傾くので、
 * 曲がりは縦に長い丸みになり、手前の曲がりほど太く写る。上下の管の曲がりの側の端 u1・l1 と、曲がりの中心線の点
 */
const S2 = (() => {
  const unit = (a: Pt, b: Pt): Pt => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const u0: Pt = [404, 219.3],
    u1: Pt = [384.5, 227.4],
    l0: Pt = [404, 250.3],
    l1: Pt = [389.5, 256.9];
  const bend: Pt[] = [
    [378.4, 230.6],
    [375, 236.5],
    [373.9, 244],
    [375.4, 251.5],
    [379.6, 257],
    [385, 258.6],
  ];
  return { u0, u1, l0, l1, du: unit(u0, u1), dl: unit(l0, l1), bend };
})();
const s2Pts = () =>
  smooth([S2.u0, at(S2.u0, S2.du, 7), at(S2.u0, S2.du, 14), S2.u1, ...S2.bend, S2.l1, at(S2.l0, S2.dl, 8), S2.l0], 4);
/** 第 2 抜差しの管の外の半幅（手前の曲がりほど太く写る） */
const s2Hw = (p: Pt) => 10.3 + 1.7 * Math.min(1, Math.max(0, (395 - p[0]) / 20));
/** 帯（ribbon と同じ）の両端を、半幅 × b の楕円の半分で閉じる（斜めに手前へ出る管の口） */
const ribbonE = (pts: Pt[], hw: (p: Pt) => number, b: number) => {
  const nm = normals(pts),
    w = pts.map(hw),
    L = pts.map((p, i): Pt => [p[0] + nm[i][0] * w[i], p[1] + nm[i][1] * w[i]]),
    R = pts.map((p, i): Pt => [p[0] - nm[i][0] * w[i], p[1] - nm[i][1] * w[i]]);
  const cap = (i: number, a0: number): Pt[] => {
    const [nx, ny] = nm[i],
      out: Pt[] = [];
    for (let k = 1; k < 12; k++) {
      const f = a0 + (Math.PI * k) / 12;
      out.push([
        pts[i][0] + w[i] * Math.cos(f) * nx + b * Math.sin(f) * ny,
        pts[i][1] + w[i] * Math.cos(f) * ny - b * Math.sin(f) * nx,
      ]);
    }
    return out;
  };
  return `M${[...L, ...cap(pts.length - 1, 0), ...R.reverse(), ...cap(0, Math.PI)].map((p) => P(p[0], p[1])).join('L')}Z`;
};

/** 光の向き（左上）。陰影の明るい筋は光に向いた側、暗い帯は反対側に付ける */
const LIGHT: Pt = [-0.32, -0.95];
/** 中心線に沿った帯（法線の向きに a〜b）。null を返した点と、帯が中心線の反対の側へ移る点で帯を切る */
function strip(pts: readonly Pt[], ab: (p: Pt, n: Pt) => readonly [number, number] | null): string {
  const nm = normals(pts as Pt[]);
  let d = '',
    run: [Pt, Pt][] = [],
    sgn = 0;
  const flush = () => {
    if (run.length > 1)
      d += `M${run.map(([a]) => P(a[0], a[1])).join('L')}L${run
        .map(([, b]) => P(b[0], b[1]))
        .reverse()
        .join('L')}Z`;
    run = [];
  };
  pts.forEach((p, i) => {
    const r = ab(p, nm[i]);
    if (!r) {
      flush();
      return;
    }
    const s = Math.sign(r[0] + r[1]);
    if (s !== sgn) flush();
    sgn = s;
    const n = nm[i];
    run.push([
      [p[0] + n[0] * r[0], p[1] + n[1] * r[0]],
      [p[0] + n[0] * r[1], p[1] + n[1] * r[1]],
    ]);
  });
  flush();
  return d;
}
type Width = number | ((p: Pt) => number);
const W = (w: Width, p: Pt) => (typeof w === 'number' ? w : w(p));
/**
 * 管の陰影（hl 明るい筋、sh 暗い帯）。inner が 0 なら中まで金属の管（押していない抜差しなど）で、光の側の
 * 半幅の 4 割の高さに筋と縁の細い光、反対の縁に帯を付ける。inner があれば気柱の外の壁（inner〜hw）だけに付ける。
 * 管が光の向きに沿う所では帯を細くして切り、反対の側から付け直す
 */
function shade(pts: readonly Pt[], hw: Width, inner: Width = 0): { hl: string; sh: string } {
  const side = (n: Pt) => n[0] * LIGHT[0] + n[1] * LIGHT[1],
    fade = (n: Pt) => Math.min(1, Math.abs(3 * side(n))),
    sg = (n: Pt) => (side(n) >= 0 ? 1 : -1);
  const solid = (p: Pt) => W(inner, p) <= 0;
  const hl =
    strip(pts, (p, n) => {
      const h = W(hw, p),
        a = W(inner, p),
        f = fade(n),
        s = sg(n);
      if (f < 0.15) return null;
      if (!solid(p)) {
        const w = h - a;
        return [s * (a + 0.25 * w), s * (a + (0.25 + 0.5 * f) * w)];
      }
      return [s * (0.42 - 0.12 * f) * h, s * (0.42 + 0.12 * f) * h];
    }) +
    strip(pts, (p, n) => {
      const h = W(hw, p),
        f = fade(n),
        s = sg(n);
      return solid(p) && f >= 0.2 ? [s * 0.84 * h, s * (0.84 + 0.1 * f) * h] : null;
    });
  const sh = strip(pts, (p, n) => {
    const h = W(hw, p),
      a = W(inner, p),
      f = fade(n),
      s = -sg(n);
    if (f < 0.15) return null;
    if (!solid(p)) {
      const w = h - a;
      return [s * (h - 0.1 * w - 0.7 * f * w), s * (h - 0.1 * w)];
    }
    return [s * (0.97 - 0.36 * f) * h, s * 0.97 * h];
  });
  return { hl, sh };
}
/**
 * 縦の円柱（弁のケース・キャップ）の側面の縦の帯: 上の中心 c0・半幅 rx0、下の中心 c1・半幅 rx1。帯の上下は手前の弧
 * y0 + ry0·√(1−u²)、y1 + ry1·√(1−u²)（u は左の縁 −1 から右の縁 1 の位置）。us は帯ごとの u の範囲
 */
function cyl(
  c0: number,
  c1: number,
  rx0: number,
  rx1: number,
  y0: number,
  y1: number,
  ry0: number,
  ry1: number,
  us: readonly (readonly [number, number])[],
): string {
  return us
    .map(([u0, u1]) => {
      const top: Pt[] = [],
        bot: Pt[] = [];
      for (let k = 0; k <= 6; k++) {
        const u = u0 + ((u1 - u0) * k) / 6,
          c = Math.sqrt(Math.max(0, 1 - u * u));
        top.push([c0 + rx0 * u, y0 + ry0 * c]);
        bot.push([c1 + rx1 * u, y1 + ry1 * c]);
      }
      return `M${top.map((p) => P(p[0], p[1])).join('L')}L${bot
        .reverse()
        .map((p) => P(p[0], p[1]))
        .join('L')}Z`;
    })
    .join('');
}
const spline = (c: readonly Pt[], n = 6): Pt[] => {
  const out: Pt[] = [c[0]];
  for (let i = 0; i + 1 < c.length; i++) {
    const p0 = c[Math.max(0, i - 1)],
      p1 = c[i],
      p2 = c[i + 1],
      p3 = c[Math.min(c.length - 1, i + 2)];
    for (let k = 1; k <= n; k++) {
      const t = k / n,
        t2 = t * t,
        t3 = t2 * t;
      out.push([
        0.5 *
          (2 * p1[0] +
            (-p0[0] + p2[0]) * t +
            (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
            (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 *
          (2 * p1[1] +
            (-p0[1] + p2[1]) * t +
            (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
            (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  return out;
};
/** 中心線と、点ごとの半幅（端から端へ線形に補う）で帯を作る */
const taper = (c: readonly Pt[], w: readonly number[], caps: readonly [boolean, boolean] = [false, false]) => {
  const pts = spline(c),
    m = new Map<Pt, number>(),
    L: number[] = [0];
  for (let i = 1; i < pts.length; i++)
    L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  pts.forEach((p, i) => {
    const s = (L[i] / L[L.length - 1]) * (w.length - 1),
      k = Math.min(w.length - 2, Math.floor(s));
    m.set(p, w[k] + (w[k + 1] - w[k]) * (s - k));
  });
  return ribbon(pts, (p) => m.get(p) ?? w[0], caps);
};
/** 楕円（cx, cy、半径 rx・ry）。rev で向きを逆にする（穴にする） */
const ell = (cx: number, cy: number, rx: number, ry: number, rev = false) =>
  `M${P(cx, cy - ry)}A${f1(rx)} ${f1(ry)} 0 0 ${rev ? 0 : 1} ${P(cx, cy + ry)}A${f1(rx)} ${f1(ry)} 0 0 ${rev ? 0 : 1} ${P(cx, cy - ry)}Z`;
/** 縦の円柱の手前の弧（中心 cx、高さ y の楕円の下の半分、左から右へ） */
const front = (cx: number, y: number, rx: number, ry: number) =>
  `M${P(cx - rx, y)}A${f1(rx)} ${f1(ry)} 0 0 0 ${P(cx + rx, y)}`;
/** 縦の円柱のローレット: 上下の手前の弧（中心の高さ y0・y1）の間の縦線。円柱の面に沿って端ほど詰まる */
const knurlLines = (cx: number, rx: number, y0: number, y1: number, ry0: number, ry1: number, step: number) => {
  let s = '';
  for (let a = -84; a <= 84; a += step) {
    const r = (a * Math.PI) / 180,
      x = cx + rx * Math.sin(r);
    s += `M${P(x, y0 + ry0 * Math.cos(r))}V${f1(y1 + ry1 * Math.cos(r))}`;
  }
  return s;
};

/** 弁のケースの胴: 上（y 116）と下（y 280.6）の半幅（写真では下ほど遠く、少し細く写る）、ケースごとの中心のずれ */
const CASE = { y0: 116, y1: 280.6, hw0: 18.2, hw1: 16.7, ry1: 5.6 };
const LEAN = [
  [0.2, 0.4],
  [-0.5, -0.8],
  [-1, -2.1],
] as const;
/** ケース i の高さ y での中心 x */
const cx = (i: number, y: number) => VX[i] + LEAN[i][0] + ((LEAN[i][1] - LEAN[i][0]) * (y - CASE.y0)) / (299 - CASE.y0);
const caseHw = (y: number) => CASE.hw0 + ((CASE.hw1 - CASE.hw0) * (y - CASE.y0)) / (CASE.y1 - CASE.y0);
/** 上のキャップ: 上の面の楕円の中心の高さ・半径、側面の下の弧の中心の高さ、ローレットの下の弧の中心の高さ */
const CAP = { y: 105.2, rx: 19.4, ry: 6.3, yb: 113.9, yk: 111 };
/** 下のキャップ: 上の弧・下の弧の中心の高さと縦の半径、ローレットの上下 */
const CAPL = { y0: 280.6, ry0: 6.2, y1: 291.4, ry1: 7.6, rx: 18.3, k0: 285.2, k1: 290.8, rk: 7.3 };

/** 動かない管・弁のケース・小物 */
const S = (() => {
  const band = (x0: number, x1: number, y: number, hw: number, r = 1) => rect(x0, y - hw, x1, y + hw, r);
  const circ = (x: number, y: number, r: number) => ell(x, y, r, r);
  /* 弁のケースの間（高さ y でのケースの胴の縁から縁） */
  const gapsAt = (y: number) => [0, 1].map((i): [number, number] => [cx(i, y) + caseHw(y), cx(i + 1, y) - caseHw(y)]);
  /*
   * 斜めに手前へ出る管の輪: 口 p から向き d に t0〜t1、管の半幅 hw より e だけ太い帯。輪の縁は管の断面の楕円の
   * 手前の半分（ケースの側へ半径の 0.55 倍膨らむ）。t0 の端は輪の外の縁、t1 の端は管が出てくる縁（輪の端の面の段）
   */
  const obRing = (p: Pt, d: Pt, t0: number, t1: number, hw: number, e: number) => {
    const n: Pt = [-d[1], d[0]],
      end = (t: number, r: number) => {
        const c = at(p, d, t),
          out: Pt[] = [];
        for (let i = 0; i <= 10; i++) {
          const a = (Math.PI * i) / 10,
            cn = Math.cos(a) * r,
            cd = -Math.sin(a) * 0.55 * r;
          out.push([c[0] + n[0] * cn + d[0] * cd, c[1] + n[1] * cn + d[1] * cd]);
        }
        return out;
      },
      c1 = at(p, d, t1),
      R = hw + e;
    return `M${[
      ...end(t0, R),
      [c1[0] - n[0] * R, c1[1] - n[1] * R] as Pt,
      ...end(t1, hw).reverse(),
      [c1[0] + n[0] * R, c1[1] + n[1] * R] as Pt,
    ]
      .map((q) => P(q[0], q[1]))
      .join('L')}Z`;
  };
  const s2r = (p: Pt, d: Pt, ts: readonly (readonly [number, number])[]) =>
    ts.map(([t0, t1]) => obRing(p, d, t0, t1, s2Hw(at(p, d, t1)), 0.8)).join('');
  /* 管の陰影（まっすぐな管は両端の 2 点で足りる） */
  const lpHw = (p: Pt) => 8.6 + (1.6 * (p[0] - 183)) / 334,
    lpAir = (p: Pt) => 7 + (AIR - 7) * Math.min(1, Math.max(0, (p[0] - 184) / 333)),
    mHw = (p: Pt) => lerpT(RIM.slice(2).concat(OUT), p[0] / PXM) * PXM,
    mAir = (p: Pt) => Math.max(0.8, mpIn(p[0] / PXM) * PXM - 0.6),
    line = (x0: number, y0: number, x1: number, y1: number) => seg(x0, y0, x1, y1, 1e4);
  const sh = {
    bell: shade(
      join(
        line(VX[0], Y_LOW, BOW.x, Y_LOW),
        bellPts().filter((p, i) => p[0] < BOW.x + 1 || p[0] > 840 || i % 3 === 0),
      ),
      bellHw,
      (p) => bellHw(p) - 1.6,
    ),
    third: [
      shade(s3Bend(), HW),
      shade(line(S3.x + 1, Y_LOW, S3.xe, Y_LOW), HW),
      shade(line(S3.xe, S3.yu, S3.x + 1, S3.yu), 11),
    ],
    first: [
      shade(s1Bend(), 10),
      shade(line(S1.xe, S1.yu, S1.x - 1, S1.yu), 10),
      shade(line(S1.x - 1, S1.yl, S1.xe, S1.yl), 10),
    ],
    second: shade(s2Pts(), s2Hw),
    main: [shade(line(701, Y_LOW, VX[2] + 3, Y_LOW), 10.9, AIR), shade(crookPts(674, 700.2), 11, AIR)],
    lead: [
      shade(seg(106, Y_LP, 184, Y_LP, 13), 11.5, mAir),
      shade(line(184, Y_LP, 515, Y_LP), lpHw, lpAir),
      shade(line(515, Y_LP, 674, Y_LP), 11.4, AIR),
    ],
    mouth: shade(seg(0.5, Y_LP, 106, Y_LP, 2.5), mHw, mAir),
  };
  const all = (xs: { hl: string; sh: string }[], k: 'hl' | 'sh') => xs.map((x) => x[k]).join('');
  /* 弁のケース */
  const caseBody = (i: number) => {
    const xs = (y: number, s: 1 | -1) => cx(i, y) + s * caseHw(y);
    return `M${P(xs(CASE.y0, -1), CASE.y0)}L${P(xs(CASE.y1, -1), CASE.y1)}A${f1(caseHw(CASE.y1))} ${CASE.ry1} 0 0 0 ${P(xs(CASE.y1, 1), CASE.y1)}L${P(xs(CASE.y0, 1), CASE.y0)}Z`;
  };
  const caseStrips = (us: readonly (readonly [number, number])[]) =>
    VX.map((_, i) => cyl(cx(i, CASE.y0), cx(i, CASE.y1), CASE.hw0, CASE.hw1, CASE.y0, CASE.y1, 0, CASE.ry1, us)).join(
      '',
    );
  const capTop = (i: number) => {
    const c = cx(i, CAP.y);
    return `M${P(c - CAP.rx, CAP.y)}A${CAP.rx} ${CAP.ry} 0 0 1 ${P(c + CAP.rx, CAP.y)}L${P(c + CAP.rx, CAP.yb)}A${CAP.rx} ${CAP.ry} 0 0 1 ${P(c - CAP.rx, CAP.yb)}Z`;
  };
  const capLow = (i: number) => {
    const c = cx(i, 290),
      { rx, y0, ry0, y1, ry1 } = CAPL;
    return `M${P(c - rx, y0)}A${rx} ${ry0} 0 0 1 ${P(c + rx, y0)}L${P(c + rx, y1)}A${rx} ${ry1} 0 0 1 ${P(c - rx, y1)}Z`;
  };
  const capStrips = (us: readonly (readonly [number, number])[]) =>
    VX.map((_, i) => {
      const c = cx(i, CAP.y),
        d = cx(i, 290);
      return (
        cyl(c, c, CAP.rx, CAP.rx, CAP.y, CAP.yb, CAP.ry, CAP.ry, us) +
        cyl(d, d, CAPL.rx, CAPL.rx, CAPL.y0, CAPL.y1, CAPL.ry0, CAPL.ry1, us)
      );
    }).join('');
  /* 弁のケースの帯（ふくらんだ輪）: 上下の手前の弧の中心の高さ、縦の半径 */
  const BAND = { y0: 171.8, y1: 176.5, ry: 6.4 };
  const bandAt = (i: number) => {
    const c = cx(i, 174),
      rx = caseHw(174) + 0.8;
    return `M${P(c - rx, BAND.y0)}A${f1(rx)} ${BAND.ry} 0 0 0 ${P(c + rx, BAND.y0)}L${P(c + rx, BAND.y1)}A${f1(rx)} ${BAND.ry} 0 0 1 ${P(c - rx, BAND.y1)}Z`;
  };
  return {
    /* 奥: ベル管の下の管（第 1 弁から曲がりまで）・ベルの曲がり・ベル管を 1 本の帯で（継ぎ目の線を出さない） */
    bell: (() => {
      /* 縁の面で縦の線を出さないよう、終わりは縁の楕円の手前の半分の弧でつなぐ */
      const pts = join(seg(VX[0], Y_LOW, BOW.x, Y_LOW, 4), bellPts()),
        nm = normals(pts),
        w = pts.map(bellHw),
        L = pts.map((p, i) => P(p[0] + nm[i][0] * w[i], p[1] + nm[i][1] * w[i])),
        R = pts.map((p, i) => P(p[0] - nm[i][0] * w[i], p[1] - nm[i][1] * w[i]));
      return `M${L.join('L')}A${f1(MOUTH.rx)} ${f1(w[w.length - 1])} 0 0 0 ${R.reverse().join('L')}Z`;
    })(),
    bellHl: sh.bell.hl,
    bellSh: sh.bell.sh,
    /* 胴の奥に見える縁の楕円全体（奥の半分の外の面）と縁の巻きの輪。胴より先に描き、まん中は胴に隠れる */
    bellBack: ell(MOUTH.x, MOUTH.y, MOUTH.rx, MOUTH.ry),
    bellBackRim:
      ell(MOUTH.x, MOUTH.y, MOUTH.rx + 0.6, MOUTH.ry + 0.6) +
      ell(MOUTH.x, MOUTH.y, MOUTH.rx - MOUTH.w, MOUTH.ry - 1.2, true),
    /* 縁の巻き（縁の手前の半分に沿う三日月）。その内側は、ほかの管と同じく気柱を透かして描く（airQuads） */
    bellRim:
      `M${P(MOUTH.x, MOUTH.y - MOUTH.ry - 0.6)}A${f1(MOUTH.rx + 0.6)} ${f1(MOUTH.ry + 0.6)} 0 0 1 ${P(MOUTH.x, MOUTH.y + MOUTH.ry + 0.6)}` +
      `A${f1(MOUTH.rx - MOUTH.w)} ${f1(MOUTH.ry - 1.2)} 0 0 0 ${P(MOUTH.x, MOUTH.y - MOUTH.ry - 0.6)}Z`,
    /* ベル管の下の管の金具（第 1 抜差しの上下の管の間に見える） */
    bellFit: 'M273.6 230.4H287.6L289.6 242.4H271.8Z',
    /* 弁のケースの間: 空気が通る管（下の段）と、ケースをつなぐ支え */
    knuck: gapsAt(240.1)
      .map(([a, b]) => band(a - 3, b + 3, 240.1, 10.4))
      .join(''),
    spacers: [
      [187.9, 202.5],
      [260.8, 274.8],
    ]
      .flatMap(([y0, y1]) => gapsAt((y0 + y1) / 2).map(([a, b]) => rect(a - 3, y0, b + 3, y1, 3)))
      .join(''),
    spacerLines: [195.4, 268.5].flatMap((y) => gapsAt(y).map(([a, b]) => `M${P(a - 3, y)}H${f1(b + 3)}`)).join(''),
    /* 下のキャップ（胴より先に描き、胴の下の弧がキャップの上の面に重なる）と、そのローレット */
    capsLow: VX.map((_, i) => capLow(i)).join(''),
    knurlLow: VX.map((_, i) => {
      const c = cx(i, 290),
        { rx, k0, k1, rk } = CAPL;
      return front(c, k0, rx, rk) + front(c, k1, rx, rk) + knurlLines(c, rx, k0, k1, rk, rk, 6);
    }).join(''),
    /* 弁のケース: 胴（下ほど細い）、光の縦の帯、帯（ふくらんだ輪）、上のキャップ（上の面・ローレット）、フェルト、軸の受け */
    casings: VX.map((_, i) => caseBody(i)).join(''),
    casingsHl: caseStrips([
      [-0.66, -0.4],
      [0.46, 0.56],
    ]),
    casingsSh: caseStrips([
      [-0.99, -0.84],
      [0.68, 0.99],
    ]),
    bands: VX.map((_, i) => bandAt(i)).join(''),
    bandsHl: VX.map((_, i) => {
      const c = cx(i, 174),
        rx = caseHw(174) + 0.8;
      return `${front(c, BAND.y0 + 1.6, rx - 0.6, BAND.ry)}`;
    }).join(''),
    caps: VX.map((_, i) => capTop(i)).join(''),
    capsHl: capStrips([[-0.62, -0.4]]),
    capsSh: capStrips([
      [-0.99, -0.88],
      [0.7, 0.99],
    ]),
    knurl: VX.map((_, i) => {
      const c = cx(i, CAP.y);
      return (
        front(c, CAP.y, CAP.rx, CAP.ry) +
        front(c, CAP.yk, CAP.rx, CAP.ry) +
        knurlLines(c, CAP.rx, CAP.y, CAP.yk, CAP.ry, CAP.ry, 5)
      );
    }).join(''),
    felts: VX.map((_, i) => ell(cx(i, CAP.y), CAP.y + 0.1, 15.9, 5.2)).join(''),
    guides: VX.map((_, i) => ell(cx(i, CAP.y), CAP.y + 0.6, 7.6, 2.4)).join(''),
    /* 第 3 抜差し（主管抜差しの下の管より奥）: 上の管・曲がり・下の管、ケースの口の輪、継ぎ目の輪、止め */
    third:
      ribbon(s3Bend(), HW) +
      ribbon(seg(S3.x + 1, Y_LOW, S3.xe, Y_LOW, 6), HW) +
      ribbon(seg(S3.xe, S3.yu, S3.x + 1, S3.yu, 6), 11),
    thirdHl: all(sh.third, 'hl'),
    thirdSh: all(sh.third, 'sh'),
    thirdRings:
      band(S3.xe - 0.5, S3.xe + 4.5, S3.yu, 12.5, 1.2) +
      band(477.5, 481.5, S3.yu, 12.2) +
      band(S3.x - 3, S3.x + 1, S3.yu, 11.8),
    stops:
      [599.5, 624.5].map((x) => rect(x - 6, 219, x + 6, 222.5, 1) + rect(x - 4, 222.5, x + 4, 229.5, 1.2)).join('') +
      rect(558.5, 219.5, 561.5, 229.5, 0.6),
    /* 手前: 第 1 抜差し（曲がり、上下の管とケースへ曲がる端、継ぎ目の輪、引き手） */
    first:
      ribbon(s1Bend(), 10) +
      ribbon(seg(S1.xe, S1.yu, S1.x - 1, S1.yu, 6), 10, [true, false]) +
      ribbon(seg(S1.x - 1, S1.yl, S1.xe, S1.yl, 6), 10, [false, true]),
    firstHl: all(sh.first, 'hl'),
    firstSh: all(sh.first, 'sh'),
    firstRings:
      band(S1.x - 1.5, S1.x + 2, S1.yu, 11) +
      band(S1.x - 1.5, S1.x + 2, S1.yl, 11) +
      band(340.5, 344, S1.yu, 11) +
      band(340.5, 344, S1.yl, 11),
    firstKnob: circ(232.3, 236.4, 5),
    /* 第 2 抜差し（第 2 弁のケースの手前）: U 字の管、斜めの輪（ケースの口・継ぎ目・曲がりの継ぎ目）、引き手 */
    second: ribbonE(s2Pts(), s2Hw, 5.6),
    secondHl: sh.second.hl,
    secondSh: sh.second.sh,
    secondRings:
      s2r(S2.u0, S2.du, [
        [-1.5, 3],
        [9, 12.5],
        [16, 19.5],
      ]) +
      s2r(S2.l0, S2.dl, [
        [-1.5, 3],
        [9, 12.5],
      ]),
    /* 引き手（曲がりの手前に付いた短い円柱。右の端の面が見える） */
    secondKnob: `M${P(377.6, 249.6)}L${P(386.4, 250.6)}A2.6 5 0 0 1 ${P(386.4, 260.6)}L${P(377.6, 259.6)}A2.6 5 0 0 1 ${P(377.6, 249.6)}Z`,
    knobFaces: ell(386.4, 255.6, 2.6, 5) + ell(386.6, 255.6, 1.3, 2.6) + ell(232.3, 236.4, 2.7, 2.7),
    /* 手前: 主管抜差し（下の管とケースへ曲がる端、曲がり、継ぎ目の輪） */
    mainLow: ribbon(seg(701, Y_LOW, VX[2] + 3, Y_LOW, 6), 10.9, [false, true]),
    crook: ribbon(crookPts(674, 700.2), 11),
    mainHl: all(sh.main, 'hl'),
    mainSh: all(sh.main, 'sh'),
    mainRings:
      band(698, 702.5, Y_LP, 11.6) +
      band(698, 702.5, Y_LOW, 11.6) +
      band(670, 675, Y_LP, 12.4) +
      band(660, 669, Y_LOW, 11.9),
    /* リードパイプ: 受け口、管（入口の 8.6 から 10.2 へ太る）、主管抜差しの外管 */
    recv: band(106, 184, Y_LP, 11.5, 1.5) + band(105.5, 109, Y_LP, 12.3) + band(180.5, 184.5, Y_LP, 12.3),
    lead: ribbon(seg(183, Y_LP, 517, Y_LP, 8), lpHw),
    outer: band(515, 674, Y_LP, 11.4),
    leadHl: all(sh.lead, 'hl'),
    leadSh: all(sh.lead, 'sh'),
    mouth: ribbon(seg(0, Y_LP, 106, Y_LP, 0.4), mHw),
    mouthHl: sh.mouth.hl,
    mouthSh: sh.mouth.sh,
    /* マウスピースの段と溝（縁とカップの境、カップの段、スロートの輪の両端、シャンクの溝） */
    mouthLines: [15.3, 19.8, 40.5, 50.6, 58.4, 64.5, 68.3]
      .map((x) => `M${P(x, Y_LP - mHw([x, 0]) + 0.6)}V${f1(Y_LP + mHw([x, 0]) - 0.6)}`)
      .join(''),
    /* 支え: ベル管とリードパイプ（左）、ベル管と主管抜差しの外管（右）。ベル管の下に付いた葉の形の板と、斜めの脚 */
    braces:
      'M186.5 133L200 124.5C205 120 212 116.6 220 114.7C230 112.3 242 110.2 250 109.7C252 109.6 253.6 110 255 111L267.8 119.1C264 121.5 258 123.8 252.2 124.7C243 125.6 232 125.5 224.4 125.2C218 125 214 124.8 210.5 126.5L199 134.2Z' +
      'M638.8 130.6L650.5 118.8C655.5 115 663 113.4 672 112.1C684 110.3 696 108.3 705.6 107.8C711 110.5 716.5 115 722.2 120C716.5 123.6 710.5 126.4 703.3 127.2C690 127 676 126.2 666 125.6L655.6 124.6L645.8 130.8Z',
    braceHl: 'M216 117.6C228 114.6 241 112.6 251 112.4M668 114.6C682 112.4 695 110.6 705 110.4',
    /* 小指掛け（リードパイプの上の台と、上へ曲がった太い線材）、第 1 抜差しの親指掛け、第 3 抜差しの指輪 */
    hookBase:
      'M468 133.4C469.5 129.5 473 128 480 128.2L500 129.2C506 129.6 510 130.4 512.6 131.5C509 133.6 504 135 498 135.2L475 135.2C471.5 135 469 134.4 468 133.4Z',
    hook: ribbon(
      smooth([
        [472.6, 131.5],
        [469.8, 121.5],
        [468.9, 111],
        [470.8, 102.8],
        [476.4, 97.4],
        [485.6, 93],
        [492.6, 90.6],
      ]),
      2.3,
      [false, true],
    ),
    hookHl: `M${smooth([
      [471.2, 128],
      [468.6, 118],
      [468.4, 109],
      [470.6, 101.2],
      [476, 96],
      [485.4, 91.6],
    ])
      .map((p) => P(p[0], p[1]))
      .join('L')}`,
    saddle: ribbon(
      smooth([
        [302.2, 163.4],
        [301.9, 176],
        [302.2, 187],
        [304.6, 194.8],
        [310.8, 200.6],
        [320.3, 203.6],
        [329.8, 200.6],
        [336, 194.8],
        [338.4, 187],
        [338.7, 176],
        [338.5, 163.4],
      ]),
      (p) => 1.6 + 1.1 * Math.min(1, Math.max(0, (196 - p[1]) / 14)),
      [true, true],
    ),
    saddleFoot: 'M314.2 208.8L316.6 203.8H326.4L328.8 208.8Z',
    saddleHl: `M${P(300.7, 166)}L${P(300.6, 186)}Q${P(302, 197)} ${P(312, 201.6)}`,
    /* 指輪: 少し傾いた幅のある輪（外の縁と穴、手前の縁の線）と、管の上の葉の形の台 */
    ring: ell(519, 177.3, 20.9, 20.4) + ell(519.2, 177.7, 17, 15.4, true),
    ringBase: 'M497.8 197.4H538.6C533 201.2 526 206.4 519.2 207.2C512.4 206.4 505.4 201.2 497.8 197.4Z',
    ringNeck: rect(513.2, 194.6, 525.2, 199.4, 1.2),
    ringEdge: ell(518.1, 176.2, 19.2, 18.6),
    /* 第 3 抜差しの止めの棒（主管抜差しの外管から下の管へ。下の端に V 字の止め） */
    rod: `${rect(678.2, 150, 688.8, 163, 1.5)}M${P(679.7, 163)}L${P(685.5, 163)}L${P(683.5, 221)}L${P(677.4, 221)}Z${rect(676, 221.6, 684.4, 227.2, 1)}${rect(675, 227, 685.5, 231.4, 1)}M${P(672.4, 231.2)}L${P(686.4, 231.2)}L${P(686.4, 236)}L${P(679.4, 244)}L${P(672.4, 236)}Z`,
    rodHl: `M${P(681.4, 165)}L${P(679.4, 219)}`,
    /* ウォーターキー: 主管抜差しの曲がりの下（受け・コルク・軸の台・ばね・レバー）と、第 3 抜差し（レバーと受け） */
    wkCup:
      'M714.4 250.6Q715 245 719 244.2L727.6 243.4Q730.4 244.6 730.4 247.6V254.6Q727 258.6 722 258.6Q716.4 258.4 714.6 254.4Z',
    wkCork: ell(722, 251.6, 7.6, 3.2),
    /* 軸の台（曲がりにろう付けした板）と、ローレットを切った軸の頭 */
    wkPost: `M731.4 238.2L737.6 231L741.2 224.6L744.6 226.8L743.6 229.8L752.2 237.5L743.2 244Z${circ(748.4, 240.4, 4.8)}`,
    wkKnurl: 'M744.6 237.4V243.4M746 236.2V244.6M747.4 235.7V245.1M748.8 235.6V245.2',
    wkSpring: 'M743.4 229.2L751.2 220.6Q753.4 219.8 754.6 222.8L747.6 231',
    wkLever:
      taper(
        [
          [769.4, 197.2],
          [769.4, 202],
          [768.5, 208],
          [767.2, 213],
          [765.2, 218],
          [762.6, 224],
          [760, 230],
          [756, 235.4],
          [752, 240.6],
          [747.4, 244.8],
          [741, 248.4],
          [735, 249.8],
          [730.6, 250.4],
        ],
        [1.8, 2.2, 2.6, 2.8, 3, 3, 3, 3, 3, 3, 3.3, 3.6, 4],
        [true, false],
      ) +
      /* 親指で押す板と、ばねが押すレバーの尾 */
      taper(
        [
          [753.2, 237],
          [756.8, 229.6],
          [760.4, 222.2],
          [761.6, 220.8],
        ],
        [1.5, 1.5, 1.5, 1.4],
      ) +
      'M744.4 229.8L746 234.6L752 236.6L756.6 231.4L749.6 229Z' +
      /* 第 3 抜差しのウォーターキーのレバー */
      'M692.4 201.2Q693.8 198.4 695.4 200.6Q697.4 206 697.7 213V226.5Q697.2 229.4 694 229.6H692.4Q691.2 229 691.3 226L691.6 215Q693.4 212.6 693.6 209.6Q693.4 205 692.4 201.2Z',
    wkCup3: 'M660 250.6H673V254.4Q666.5 257.8 660 254.4Z',
    /* 主管抜差しの下の管の下のねじ（ローレット） */
    screw: `${rect(555, 252.4, 568.6, 256.6, 1)}M557 252.6V256.4M559 252.6V256.4M561 252.6V256.4M563 252.6V256.4M565 252.6V256.4M567 252.6V256.4`,
  };
})();

/** 図の描く順: 形（class・d・部品の名前）か、気柱の層（9 段の色の path を置く）。弁のボタンと文字はこの後 */
export type SideItem = { cls: string; d: string; name: string } | { air: AirLayer };
/** 部品の名前（図の上で指したときの説明）。陰影の帯は、その部品の名前にする */
const NAMES: Record<keyof typeof S, string> = {
  bell: 'ベル管（下の管・ベルの曲がり・ベル）',
  bellHl: 'ベル管',
  bellSh: 'ベル管',
  bellBack: 'ベル（縁の奥の半分の外の面）',
  bellBackRim: 'ベルの縁',
  bellRim: 'ベルの縁',
  bellFit: 'ベル管の下の管の金具',
  knuck: '弁の間の管',
  spacers: '弁のケースの間の支え',
  spacerLines: '弁のケースの間の支えの継ぎ目',
  capsLow: '弁のケースの下のキャップ',
  knurlLow: 'キャップのローレット',
  casings: '弁のケース',
  casingsHl: '弁のケース',
  casingsSh: '弁のケース',
  bands: '弁のケースの帯',
  bandsHl: '弁のケースの帯',
  caps: '弁のケースのキャップ',
  capsHl: '弁のケースのキャップ',
  capsSh: '弁のケースのキャップ',
  knurl: 'キャップのローレット',
  felts: 'フェルト',
  guides: 'ピストンの軸の受け',
  third: '第 3 抜差し',
  thirdHl: '第 3 抜差し',
  thirdSh: '第 3 抜差し',
  thirdRings: '第 3 抜差しの輪',
  stops: '第 3 抜差しの止め',
  first: '第 1 抜差し',
  firstHl: '第 1 抜差し',
  firstSh: '第 1 抜差し',
  firstRings: '第 1 抜差しの輪',
  firstKnob: '第 1 抜差しの引き手',
  second: '第 2 抜差し',
  secondHl: '第 2 抜差し',
  secondSh: '第 2 抜差し',
  secondRings: '第 2 抜差しの輪',
  secondKnob: '第 2 抜差しの引き手',
  knobFaces: '抜差しの引き手',
  mainLow: '主管抜差しの下の管',
  crook: '主管抜差しの曲がり',
  mainHl: '主管抜差し',
  mainSh: '主管抜差し',
  mainRings: '主管抜差しの輪',
  recv: '受け口',
  lead: 'リードパイプ',
  outer: '主管抜差しの外管',
  leadHl: 'リードパイプ',
  leadSh: 'リードパイプ',
  mouth: 'マウスピース',
  mouthHl: 'マウスピース',
  mouthSh: 'マウスピース',
  mouthLines: 'マウスピース',
  braces: '支え',
  braceHl: '支え',
  hookBase: '小指掛けの台',
  hook: '小指掛け',
  hookHl: '小指掛け',
  saddle: '第 1 抜差しの親指掛け',
  saddleFoot: '第 1 抜差しの親指掛け',
  saddleHl: '第 1 抜差しの親指掛け',
  ring: '第 3 抜差しの指輪',
  ringBase: '第 3 抜差しの指輪',
  ringNeck: '第 3 抜差しの指輪',
  ringEdge: '第 3 抜差しの指輪',
  rod: '第 3 抜差しの止めの棒',
  rodHl: '第 3 抜差しの止めの棒',
  wkCup: 'ウォーターキーの受け',
  wkCork: 'ウォーターキーのコルク',
  wkPost: 'ウォーターキーの軸の台',
  wkKnurl: 'ウォーターキーの軸',
  wkSpring: 'ウォーターキーのばね',
  wkLever: 'ウォーターキーのレバー',
  wkCup3: '第 3 抜差しのウォーターキーの受け',
  screw: '下の管のねじ',
};
const it = (cls: string, ...ks: (keyof typeof S)[]): SideItem[] => ks.map((k) => ({ cls, d: S[k], name: NAMES[k] }));
export const SIDE_ITEMS: SideItem[] = [
  ...it('t-tube', 'bellBack'),
  ...it('t-tube2', 'bellBackRim'),
  ...it('t-tube', 'bell'),
  ...it('t-hl', 'bellHl'),
  ...it('t-sh', 'bellSh'),
  { air: 'b' },
  ...it('t-tube2', 'bellRim'),
  ...it('t-tube2', 'bellFit'),
  ...it('t-tube', 'knuck'),
  { air: 'v' },
  ...it('t-tube2', 'spacers'),
  ...it('t-thin', 'spacerLines'),
  ...it('t-tube2', 'capsLow'),
  ...it('t-thin', 'knurlLow'),
  ...it('t-tube', 'casings'),
  ...it('t-hl', 'casingsHl'),
  ...it('t-sh', 'casingsSh'),
  ...it('t-tube2', 'bands'),
  ...it('t-gl', 'bandsHl'),
  ...it('t-tube2', 'caps'),
  ...it('t-hl', 'capsHl'),
  ...it('t-sh', 'capsSh'),
  ...it('t-thin', 'knurl'),
  ...it('t-hole', 'felts'),
  ...it('t-silver', 'guides'),
  ...it('t-tube', 'third'),
  ...it('t-hl', 'thirdHl'),
  ...it('t-sh', 'thirdSh'),
  ...it('t-tube2', 'thirdRings', 'stops'),
  { air: 'm' },
  ...it('t-silver', 'wkCup3'),
  ...it('t-tube', 'first'),
  ...it('t-hl', 'firstHl'),
  ...it('t-sh', 'firstSh'),
  ...it('t-tube2', 'firstRings'),
  ...it('t-tube', 'second'),
  ...it('t-hl', 'secondHl'),
  ...it('t-sh', 'secondSh'),
  ...it('t-tube2', 'secondRings'),
  ...it('t-tube', 'mainLow', 'crook'),
  ...it('t-hl', 'mainHl'),
  ...it('t-sh', 'mainSh'),
  ...it('t-tube2', 'mainRings'),
  ...it('t-tube', 'recv', 'lead', 'outer'),
  ...it('t-hl', 'leadHl'),
  ...it('t-sh', 'leadSh'),
  ...it('t-silver', 'mouth'),
  ...it('t-hl', 'mouthHl'),
  ...it('t-sh', 'mouthSh'),
  ...it('t-thin', 'mouthLines'),
  { air: 'f' },
  ...it('t-tube2', 'firstKnob', 'secondKnob'),
  ...it('t-thin', 'knobFaces'),
  ...it('t-tube2', 'braces'),
  ...it('t-gl', 'braceHl'),
  ...it('t-silver', 'hookBase', 'hook'),
  ...it('t-gl', 'hookHl'),
  ...it('t-silver', 'saddleFoot', 'saddle'),
  ...it('t-gl', 'saddleHl'),
  ...it('t-tube2', 'ringBase', 'ringNeck', 'ring'),
  ...it('t-thin', 'ringEdge'),
  ...it('t-silver', 'rod'),
  ...it('t-gl', 'rodHl'),
  ...it('t-silver', 'wkCup'),
  ...it('t-cork', 'wkCork'),
  ...it('t-tube2', 'wkPost'),
  ...it('t-thin', 'wkKnurl'),
  ...it('t-silver', 'wkLever'),
  ...it('t-wire', 'wkSpring'),
  ...it('t-wire-i', 'wkSpring'),
  ...it('t-silver', 'screw'),
];

/** 図の文字: 位置、寄せ、文字、class（既定 lbs）、id（client が書き換える） */
export interface SideText {
  x: number;
  y: number;
  t: string;
  a?: 'start' | 'middle' | 'end';
  cls?: string;
  id?: string;
}
export const SIDE_TEXT: SideText[] = [
  ...VX.map((x, i): SideText => ({ x, y: 162, t: String(i + 1), a: 'middle', cls: 'lbb' })),
  { x: 46, y: 181, t: 'マウスピース', a: 'middle' },
  { x: 235, y: 168, t: 'リードパイプ', a: 'middle' },
  { x: 757, y: 168, t: '主管抜差し' },
  { x: 742, y: 276, t: 'ウォーターキー', a: 'middle' },
  { x: 600, y: 190, t: '第 3 抜差し', a: 'middle' },
  { x: 268, y: 282, t: '第 1 抜差し', a: 'middle' },
  { x: 338, y: 300, t: '第 2 抜差し', a: 'end' },
  { x: 880, y: 235, t: 'ベル', a: 'middle' },
  { x: 700, y: 300, t: '', a: 'middle', id: 'f-len' },
];

/**
 * 弁のボタン（押し具合 0〜1 で 19 px 下がる）: 軸・ボタン・真珠・押した印。ボタンは少し上から見た円盤で、
 * 上の面の奥の弧・側面・手前の下の弧と、上の面の手前の縁の線。軸の下の端はフェルトの中の受けへ手前の弧で入る
 */
export function keyShapes(press: readonly number[]): {
  stems: string;
  caps: string[];
  pearls: string[];
  marks: string[];
} {
  const caps: string[] = [],
    pearls: string[] = [],
    marks: string[] = [];
  let stems = '';
  VX.forEach((_, i) => {
    const c = cx(i, 90),
      y = 67.6 + 19 * press[i],
      yt = y + 5.9,
      yb = yt + 3.6,
      g = CAP.y + 0.6;
    stems += `M${P(c - 4.9, y + 12)}H${f1(c + 4.9)}V${f1(g)}A4.9 1.6 0 0 1 ${P(c - 4.9, g)}Z`;
    caps.push(
      `M${P(c - 14.5, yt)}A14.5 5.9 0 0 1 ${P(c + 14.5, yt)}L${P(c + 14.5, yb)}A14.5 5.9 0 0 1 ${P(c - 14.5, yb)}Z${front(c, yt, 14.5, 5.9)}`,
    );
    pearls.push(ell(c, y + 4.6, 11.8, 4.1));
    marks.push(press[i] > 0.5 ? rect(c - 17.5, y - 3.5, c + 17.5, y + 19, 6) : 'M0 0');
  });
  return { stems, caps, pearls, marks };
}

/**
 * 気柱の層: b はベル管とその下の管（弁のケースと第 1 抜差しの奥）、v は弁のケースの中と弁の間の管（ケースの奥。見えるのはケースの間だけ）、
 * m は第 3 抜差し（主管抜差しの下の管の奥）、f は手前の管（マウスピース・リードパイプ・主管抜差し・第 1・第 2 抜差し）
 */
export const AIR_LAYERS = ['b', 'v', 'm', 'f'] as const;
export type AirLayer = (typeof AIR_LAYERS)[number];

/**
 * 気柱の区間: 中心線、内側の半幅、層、管の模型の要素と位置（Bore.pressureAt の el と s の範囲）。
 * 弁の組ごとに通り道が変わる（押した弁は抜差しを回る）
 */
interface AirPiece {
  pts: Pt[];
  hw: (p: Pt) => number;
  layer: AirLayer;
  el: number;
  s0: number;
  s1: number;
}
/** 気柱の 1 つの四角（帯の 1 区切り）: 形、層、要素と位置 */
export interface AirQuad {
  d: string;
  layer: AirLayer;
  el: number;
  s: number;
}

/** 押した弁の組（第 1・第 2・第 3）の気柱の四角の列 */
export function airQuads(v: readonly boolean[]): AirQuad[] {
  const pieces: AirPiece[] = [];
  type Part = [Pt[], number | ((p: Pt) => number), AirLayer];
  /** 要素 el の s0〜s1 を、続いた区間の長さで分ける */
  const chain = (el: number, parts: Part[], s0 = 0, s1 = 1) => {
    const lens = parts.map(([pts]) => {
      let l = 0;
      for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      return l;
    });
    const L = lens.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    parts.forEach(([pts, hw, layer], i) => {
      const a = s0 + ((s1 - s0) * acc) / L;
      acc += lens[i];
      pieces.push({
        pts,
        hw: typeof hw === 'number' ? () => hw : hw,
        layer,
        el,
        s0: a,
        s1: s0 + ((s1 - s0) * acc) / L,
      });
    });
  };
  /* 弁のケースの中の通り道（ケースの口と口を結ぶ。ケースに隠れる） */
  const IN = 4.5;
  const inside = (x0: number, y0: number, x1: number, y1: number): Part => [seg(x0, y0, x1, y1, 3), IN, 'v'];
  const c1 = VX[0],
    c2 = VX[1],
    c3 = VX[2];
  /* マウスピース（88 mm）とリードパイプ: 要素 0 の 0〜0.261 と 0.261〜1 */
  chain(0, [[seg(0.9, Y_LP, 152, Y_LP, 1.2), (p) => Math.max(0.8, mpIn(p[0] / PXM) * PXM - 0.6), 'f']], 0, 0.261);
  chain(
    0,
    [[seg(152, Y_LP, 700, Y_LP, 5), (p) => 7 + (AIR - 7) * Math.min(1, Math.max(0, (p[0] - 184) / 333)), 'f']],
    0.261,
    1,
  );
  /* 主管抜差し: 曲がりから下の管を通って第 3 弁のケースの中ほどまで */
  chain(1, [[crookPts(700, c3), AIR, 'f']]);
  /* 第 3 弁: 押すと上の管から第 3 抜差しを回り、下の管からケースへ戻る */
  if (v[2])
    chain(2, [
      inside(c3, Y_LOW, S3.xe, S3.yu),
      [join(seg(S3.xe, S3.yu, S3.x, S3.yu, 5), s3Bend(), seg(S3.x, Y_LOW, S3.xe, Y_LOW, 5)), AIR, 'm'],
      inside(S3.xe, Y_LOW, c3 - CW, Y_LOW),
    ]);
  else chain(2, [inside(c3, Y_LOW, c3 - CW, Y_LOW)]);
  chain(3, [[seg(c3 - CW, Y_LOW, c2 + CW, Y_LOW, 1.5), AIR, 'v']]);
  /* 第 2 弁: 押すとケースの手前の口から第 2 抜差しを回る */
  if (v[1])
    chain(4, [
      inside(c2 + CW, Y_LOW, S2.u0[0], S2.u0[1]),
      [s2Pts(), (p) => s2Hw(p) - 1.6, 'f'],
      inside(S2.l0[0], S2.l0[1], c2 - CW, Y_LOW),
    ]);
  else chain(4, [inside(c2 + CW, Y_LOW, c2 - CW, Y_LOW)]);
  chain(5, [[seg(c2 - CW, Y_LOW, c1 + CW, Y_LOW, 1.5), AIR, 'v']]);
  /* 第 1 弁: 押すと上の管から第 1 抜差しを回り、下の管からケースへ戻る。出口はベル管の下の管 */
  if (v[0])
    chain(6, [
      inside(c1 + CW, Y_LOW, S1.xe + 4, S1.yu),
      [join(seg(S1.xe + 4, S1.yu, S1.x, S1.yu, 5), s1Bend(), seg(S1.x, S1.yl, S1.xe + 4, S1.yl, 5)), 8.5, 'f'],
      inside(S1.xe + 4, S1.yl, c1 - CW, Y_LOW),
    ]);
  else chain(6, [inside(c1 + CW, Y_LOW, c1 - CW, Y_LOW)]);
  chain(7, [[seg(c1 - CW, Y_LOW, BOW.x, Y_LOW, 4), AIR, 'b']]);
  chain(8, [[bellPts(), (p) => Math.max(AIR, bellHw(p) - 1.6), 'b']]);
  const out: AirQuad[] = [
    /*
     * ベルの縁の手前の半分の内側（縁の面より右へふくらむ半楕円）。気柱の終わり（要素 8 の端）の色で塗る。
     * 同じ色の四角と 1 本の path にまとめるので、重なりが打ち消されないよう四角と同じ回り（画面で左回り）にする
     */
    {
      d: `M${P(MOUTH.x - 0.5, MOUTH.y - MOUTH.ry + 1.2)}L${P(MOUTH.x - 0.5, MOUTH.y + MOUTH.ry - 1.2)}A${f1(MOUTH.rx - MOUTH.w)} ${f1(MOUTH.ry - 1.2)} 0 0 0 ${P(MOUTH.x - 0.5, MOUTH.y - MOUTH.ry + 1.2)}Z`,
      layer: 'b',
      el: 8,
      s: 0.995,
    },
  ];
  for (const pc of pieces) {
    const nm = normals(pc.pts),
      w = pc.pts.map((p) => pc.hw(p)),
      len: number[] = [0];
    for (let i = 1; i < pc.pts.length; i++)
      len.push(len[i - 1] + Math.hypot(pc.pts[i][0] - pc.pts[i - 1][0], pc.pts[i][1] - pc.pts[i - 1][1]));
    const L = len[len.length - 1] || 1;
    for (let i = 0; i + 1 < pc.pts.length; i++) {
      /* 隣の四角と色が違うと継ぎ目に地が透けるので、先の端を 0.6 だけ伸ばして重ねる */
      const a = pc.pts[i],
        q = pc.pts[i + 1],
        sl = Math.hypot(q[0] - a[0], q[1] - a[1]) || 1,
        b: Pt = [q[0] + ((q[0] - a[0]) / sl) * 0.6, q[1] + ((q[1] - a[1]) / sl) * 0.6],
        u = (len[i] + len[i + 1]) / 2 / L;
      out.push({
        d: `M${P(a[0] + nm[i][0] * w[i], a[1] + nm[i][1] * w[i])}L${P(b[0] + nm[i + 1][0] * w[i + 1], b[1] + nm[i + 1][1] * w[i + 1])}L${P(b[0] - nm[i + 1][0] * w[i + 1], b[1] - nm[i + 1][1] * w[i + 1])}L${P(a[0] - nm[i][0] * w[i], a[1] - nm[i][1] * w[i])}Z`,
        layer: pc.layer,
        el: pc.el,
        s: pc.s0 + (pc.s1 - pc.s0) * u,
      });
    }
  }
  return out;
}

/** 管の中の圧力を読む点（要素ごとの数）。図の四角は、はさむ 2 つの点の値を線形に補って使う */
export const AIR_N = [80, 24, 12, 3, 8, 3, 12, 10, 80] as const;
/** 読む点の列（要素, 位置）の対 */
export function airPoints(): Float32Array {
  const out: number[] = [];
  AIR_N.forEach((n, el) => {
    for (let i = 0; i < n; i++) out.push(el, (i + 0.5) / n);
  });
  return Float32Array.from(out);
}
/** 要素 el の位置 s をはさむ 2 つの読む点の番号と、その間の割合（同じ要素の中で線形に補う） */
export function airSpan(el: number, s: number): [number, number, number] {
  let k = 0;
  for (let i = 0; i < el; i++) k += AIR_N[i];
  const n = AIR_N[el],
    x = Math.min(n - 1, Math.max(0, s * n - 0.5)),
    i0 = Math.floor(x);
  return [k + i0, k + Math.min(n - 1, i0 + 1), x - i0];
}
/** 気柱の色の段の数（負と正のそれぞれ）と、段ごとの塗り（負は CH2 の青、正は朱。0 は図の地） */
export const AIR_STEPS = 32;
export const AIR_FILLS: string[] = Array.from({ length: 2 * AIR_STEPS + 1 }, (_, i) => {
  const j = i - AIR_STEPS,
    pct = ((100 * Math.abs(j)) / AIR_STEPS).toFixed(1);
  return j === 0 ? 'var(--t-air0)' : `color-mix(in srgb,var(${j < 0 ? '--ch2' : '--accent'}) ${pct}%,var(--t-air0))`;
});
