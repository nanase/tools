/**
 * 鏡筒の口（開口）とマスクの形（DOM に依存しない）。座標は開口の半径を 1 とし、x は右、y は上。
 * 透過率は 0〜1 で、標本 1 つの広さで縁をぼかす（格子は矩形波の区間平均、円と直線は縁からの距離）
 */

export type MaskKind = 'none' | 'bahtinov' | 'tri' | 'carey' | 'hartmann' | 'scheiner' | 'jwst' | 'image';

/** 画像のマスク: 1 辺 n の正方形の透過率（0〜1、行は上から）。key は中身が変わったら変わる名前 */
export interface MaskImage {
  n: number;
  a: Float32Array;
  key: string;
}

export interface Scope {
  /** 中央遮蔽の径の比（副鏡の径 ÷ 口径） */
  obs: number;
  /** スパイダーの本数（0・3・4） */
  vanes: number;
  /** スパイダーの幅（口径の半径に対する比） */
  vw: number;
}

export interface Mask {
  kind: MaskKind;
  /** 格子の周期（半径に対する比） */
  p: number;
  /** 斜めの格子の角度（rad）。バーティノフは平行な格子と斜めの格子のなす角、キャリーは左の 2 区画の開き */
  th: number;
  /** キャリーの右の 2 区画の開き（rad。省略時は th の 10/12） */
  th2?: number;
  /** バーティノフ・トライ・バーティノフの斜めのスリットを逆向きに傾ける（2005 年の原図の逆） */
  flip?: boolean;
  /** 開いている割合 */
  duty: number;
  /** 区画の間の桟の幅（半径に対する比） */
  bar: number;
  /** マスクの回転（rad） */
  rot: number;
  /** ハルトマンの穴の数・穴の径・穴の中心の半径（比） */
  holes: number;
  hd: number;
  hr: number;
  /** 画像のマスク（kind が image のとき） */
  img?: MaskImage;
  /** 画像を開口全体として使う（円の開口・中央遮蔽・スパイダーを掛けない） */
  whole?: boolean;
}

/** 値の JSON（画像は中身の代わりに key を書く。描き直すかを決める比較に使う） */
export const keyOf = (v: unknown): string =>
  JSON.stringify(v, (k, x) => (k === 'img' ? ((x as MaskImage | undefined)?.key ?? null) : x));

/** 矩形波（周期 1、[0, d) で 1）の 0〜u の積分 */
const sqInt = (u: number, d: number): number => {
  const f = Math.floor(u);
  return f * d + Math.min(u - f, d);
};
/** 矩形波の区間 [s − w/2, s + w/2] の平均（w は周期を 1 とした幅） */
const sqBox = (s: number, w: number, d: number): number =>
  w < 1e-9 ? (s - Math.floor(s) < d ? 1 : 0) : (sqInt(s + w / 2, d) - sqInt(s - w / 2, d)) / w;
/** 縁からの符号付きの距離 e（内側が正）を、幅 px の標本の覆う割合に */
const edge = (e: number, px: number): number => {
  const v = e / px + 0.5;
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
};

/** 格子 1 区画: 法線 (nx, ny) の向きに周期 p、開きの割合 d */
const grating = (x: number, y: number, nx: number, ny: number, m: Mask, px: number): number =>
  sqBox((x * nx + y * ny) / m.p, (px * (Math.abs(nx) + Math.abs(ny))) / m.p, m.duty);

/**
 * バーティノフマスクの模様（マスクの座標）。下半分は縦の格子（横に伸びる光条）、
 * 上半分の左右は ±θ だけ傾けた格子（X 字の光条）。区画の境に幅 bar の桟
 */
function bahtinov(x: number, y: number, m: Mask, px: number): number {
  const b = m.bar / 2;
  if (y < 0) return grating(x, y, 1, 0, m, px) * edge(-y - b, px);
  const c = Math.cos(m.th),
    s = Math.sin(m.th) * (m.flip ? -1 : 1);
  const k = edge(y - b, px) * edge(Math.abs(x) - b, px);
  return k * (x < 0 ? grating(x, y, c, s, m, px) : grating(x, y, c, -s, m, px));
}

/*
 * JWST の主鏡: 対辺 1.32 m の六角形のセグメントを 7 mm の隙間で 2 重に並べ、中央の 1 枚を除いた 18 枚。
 * 副鏡の支柱は幅 0.1 m の 3 本（上・左下・右下）。セグメントは上下の辺が水平（6 本の光条のうち 2 本が縦）。
 * 外接円の半径を 1 にする
 */
const JW_SEG = 1.32,
  JW_GAP = 0.007,
  JW_STRUT = 0.1,
  /** セグメントの中心の間隔（対辺の向き）と、六角形の外接円の半径 */
  JW_PITCH = JW_SEG + JW_GAP,
  JW_A = JW_PITCH / Math.sqrt(3);
/** 中心の位置（m）: 軸座標 (q, r) の上下の辺が水平な六角形の格子 */
const jwCenter = (q: number, r: number): [number, number] => [1.5 * JW_A * q, Math.sqrt(3) * JW_A * (r + q / 2)];
/** 外接円の半径（m）: いちばん外のセグメントの頂点まで */
const JW_R = (() => {
  let mx = 0;
  for (let q = -2; q <= 2; q++)
    for (let r = -2; r <= 2; r++) {
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) > 2) continue;
      const [cx, cy] = jwCenter(q, r);
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3;
        mx = Math.max(
          mx,
          Math.hypot(cx + (JW_SEG / Math.sqrt(3)) * Math.cos(a), cy + (JW_SEG / Math.sqrt(3)) * Math.sin(a)),
        );
      }
    }
  return mx;
})();
/** JWST の開口の透過率（マスクの座標、外接円の半径を 1） */
function jwst(u: number, v: number, px: number): number {
  const x = u * JW_R,
    y = v * JW_R,
    p = px * JW_R;
  /* 最寄りのセグメント（立方体座標の丸め） */
  const qf = x / (1.5 * JW_A),
    rf = y / (Math.sqrt(3) * JW_A) - qf / 2;
  let q = Math.round(qf),
    r = Math.round(rf);
  const s = Math.round(-qf - rf),
    dq = Math.abs(q - qf),
    dr = Math.abs(r - rf),
    ds = Math.abs(s - (-qf - rf));
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  if ((q === 0 && r === 0) || Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) > 2) return 0;
  const [cx, cy] = jwCenter(q, r),
    dx = x - cx,
    dy = y - cy,
    /* 六角形の辺までの距離: 法線は 90°・30°・150° */
    h = JW_SEG / 2,
    c30 = Math.sqrt(3) / 2,
    e = h - Math.max(Math.abs(dy), Math.abs(c30 * dx + 0.5 * dy), Math.abs(-c30 * dx + 0.5 * dy));
  let t = edge(e, p);
  if (t <= 0) return 0;
  /* 支柱: 上（90°）・右下（−60°）・左下（−120°） */
  for (const a of [Math.PI / 2, -Math.PI / 3, (-2 * Math.PI) / 3]) {
    const ca = Math.cos(a),
      sa = Math.sin(a);
    if (x * ca + y * sa > 0) t *= edge(Math.abs(-x * sa + y * ca) - JW_STRUT / 2, p);
  }
  return t;
}

/** 画像のマスクの透過率（マスクの座標。画像の正方形を [−1, 1]² に置き、双一次で引く） */
function image(u: number, v: number, img: MaskImage | undefined): number {
  if (!img) return 1;
  const n = img.n,
    fx = ((u + 1) / 2) * n - 0.5,
    fy = ((1 - v) / 2) * n - 0.5;
  if (fx < -0.5 || fy < -0.5 || fx > n - 0.5 || fy > n - 0.5) return 0;
  const x0 = Math.max(0, Math.min(n - 2, Math.floor(fx))),
    y0 = Math.max(0, Math.min(n - 2, Math.floor(fy))),
    tx = Math.max(0, Math.min(1, fx - x0)),
    ty = Math.max(0, Math.min(1, fy - y0)),
    o = y0 * n + x0,
    a = img.a;
  return (1 - ty) * ((1 - tx) * a[o] + tx * a[o + 1]) + ty * ((1 - tx) * a[o + n] + tx * a[o + n + 1]);
}

/** 開口の中の透過率（スコープとマスクを合わせる）。(x, y) は開口の座標、px は標本の幅 */
export function transmit(x: number, y: number, sc: Scope, m: Mask, px: number): number {
  /* JWST と、開口全体として使う画像は、鏡筒の口・中央遮蔽・スパイダーを掛けない */
  if (m.kind === 'jwst' || (m.kind === 'image' && m.whole)) {
    const cr = Math.cos(m.rot),
      sr = Math.sin(m.rot),
      u = x * cr + y * sr,
      v = -x * sr + y * cr;
    return m.kind === 'jwst' ? jwst(u, v, px) : image(u, v, m.img);
  }
  const r = Math.hypot(x, y);
  let t = edge(1 - r, px);
  if (t <= 0) return 0;
  if (sc.obs > 0) t *= edge(r - sc.obs, px);
  if (sc.vanes > 0 && t > 0) {
    const hw = sc.vw / 2;
    for (let i = 0; i < sc.vanes; i++) {
      const a = Math.PI / 2 + (2 * Math.PI * i) / sc.vanes,
        ca = Math.cos(a),
        sa = Math.sin(a);
      if (x * ca + y * sa > -hw) t *= edge(Math.abs(-x * sa + y * ca) - hw, px);
    }
  }
  if (t <= 0 || m.kind === 'none') return t;
  /* マスクの座標へ回す */
  const cr = Math.cos(m.rot),
    sr = Math.sin(m.rot),
    u = x * cr + y * sr,
    v = -x * sr + y * cr;
  switch (m.kind) {
    case 'bahtinov':
      return t * bahtinov(u, v, m, px);
    case 'tri': {
      /*
       * トライ・バーティノフ（C. Y. Tan、2016）: 120° の扇 3 つのそれぞれに、扇の中心線を境にした
       * バーティノフの模様を置く。半分は扇の中心線に直交するスリット（法線が動径）、残りの半分は
       * 外周寄りと中心寄りに分け、±θ だけ傾けたスリット
       */
      const a = Math.atan2(v, u),
        k = Math.round((a - Math.PI / 2) / ((2 * Math.PI) / 3)),
        c0 = Math.PI / 2 + (k * 2 * Math.PI) / 3,
        /* 扇の中心線を上（vv）に向けた座標 */
        cc = Math.cos(Math.PI / 2 - c0),
        ss = Math.sin(Math.PI / 2 - c0),
        uu = u * cc - v * ss,
        vv = u * ss + v * cc,
        /* 扇の境（±60° の動径）からの距離 */
        dEdge = Math.min(
          Math.abs(uu * Math.cos(Math.PI / 3) - vv * Math.sin(Math.PI / 3)),
          Math.abs(uu * Math.cos(Math.PI / 3) + vv * Math.sin(Math.PI / 3)),
        ),
        rmid = Math.max(0.55, (1 + sc.obs) / 2);
      return t * edge(dEdge - m.bar / 2, px) * bahtinov(vv - rmid, uu, m, px);
    }
    case 'carey': {
      /*
       * キャリー・マスク（G. Carey、2009）: 4 つの四分円に、縦から傾けた格子。左の 2 つは互いに th、
       * 右の 2 つは互いに th2 開く。角度の違う 2 つの X ができ、ピントが合うと重なる
       */
      const h = (u < 0 ? m.th : (m.th2 ?? (m.th * 10) / 12)) / 2,
        c = Math.cos(h),
        s = Math.sin(h) * (v < 0 ? -1 : 1);
      return t * edge(Math.abs(u) - m.bar / 2, px) * edge(Math.abs(v) - m.bar / 2, px) * grating(u, v, c, s, m, px);
    }
    case 'image':
      return t * image(u, v, m.img);
    case 'hartmann':
    case 'scheiner': {
      const n = m.kind === 'scheiner' ? 2 : m.holes;
      let o = 0;
      for (let i = 0; i < n; i++) {
        const a = Math.PI / 2 + (2 * Math.PI * i) / n;
        o = Math.max(o, edge(m.hd / 2 - Math.hypot(u - m.hr * Math.cos(a), v - m.hr * Math.sin(a)), px));
      }
      return t * o;
    }
  }
}

/**
 * 開口を n×n の格子に描く（中心が格子の中央、1 標本の幅 2/n）。表示用の透過率の画像
 */
export function rasterize(n: number, sc: Scope, m: Mask): Float32Array {
  const a = new Float32Array(n * n),
    px = 2 / n;
  for (let j = 0; j < n; j++) {
    const y = 1 - (j + 0.5) * px;
    for (let i = 0; i < n; i++) a[j * n + i] = transmit(-1 + (i + 0.5) * px, y, sc, m, px);
  }
  return a;
}
