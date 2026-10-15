/**
 * 鏡筒の口（開口）とマスクの形（DOM に依存しない）。座標は開口の半径を 1 とし、x は右、y は上。
 * 透過率は 0〜1 で、標本 1 つの広さで縁をぼかす（格子は矩形波の区間平均、円と直線は縁からの距離）
 */

export type MaskKind = 'none' | 'bahtinov' | 'tri' | 'carey' | 'hartmann' | 'scheiner';

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
  /** 斜めの格子の角度（rad）。バーティノフは平行な格子と斜めの格子のなす角 */
  th: number;
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
}

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
    s = Math.sin(m.th);
  const k = edge(y - b, px) * edge(Math.abs(x) - b, px);
  return k * (x < 0 ? grating(x, y, c, s, m, px) : grating(x, y, c, -s, m, px));
}

/** 開口の中の透過率（スコープとマスクを合わせる）。(x, y) は開口の座標、px は標本の幅 */
export function transmit(x: number, y: number, sc: Scope, m: Mask, px: number): number {
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
      /* 120° ずつの 3 区画に、口の中心から外へ向けたバーティノフの模様を置く */
      const a = Math.atan2(v, u),
        k = Math.round((a - Math.PI / 2) / ((2 * Math.PI) / 3)),
        c0 = Math.PI / 2 + (k * 2 * Math.PI) / 3,
        /* 区画の中心線を上に向けた座標 */
        cc = Math.cos(Math.PI / 2 - c0),
        ss = Math.sin(Math.PI / 2 - c0),
        uu = u * cc - v * ss,
        vv = u * ss + v * cc,
        /* 区画の境（±60°）からの距離 */
        da = Math.abs(Math.atan2(uu, vv)),
        dEdge = Math.hypot(uu, vv) * Math.sin(Math.PI / 3 - da);
      return t * edge(dEdge - m.bar / 2, px) * bahtinov(uu, vv - 0.5, m, px);
    }
    case 'carey': {
      /* 左右の半分に、縦から ±θ/2 傾けた格子 */
      const h = m.th / 2,
        c = Math.cos(h),
        s = Math.sin(h);
      return t * edge(Math.abs(u) - m.bar / 2, px) * (u < 0 ? grating(u, v, c, s, m, px) : grating(u, v, c, -s, m, px));
    }
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
  return t;
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
