/**
 * ハンマーと弦の衝突（DOM に依存しない）。フェルトの力は圧縮 δ の累乗にヒステリシスを足した
 * F = K (δ^p + α d(δ^p)/dt)（Stulov の模型の近似。Hunt–Crossley の形と同じく、押すときより戻るときの力が小さい）。弦はモードの和で表し、各モードを指数関数で正確に進める。
 * ハンマーが離れたあとのモードの変位と速度を返す（以後は弦と響板の結合したモードで自由に振動する）。
 * 衝突の間に駒にかかる力は、標本ごとに記録して返す（響板へそのまま入れる）
 */

export interface HammerSpec {
  /** 質量 [kg]（弦 1 本あたりではなく、ハンマー全体） */
  m: number;
  /** フェルトの硬さ K [N/m^p] と指数 p、ヒステリシスの時定数 α [s] */
  K: number;
  p: number;
  alpha: number;
  /** 弦に当たる幅 [m] */
  w: number;
  /** 打つ速さ [m/s] */
  v: number;
}

/** ハンマーが打つ弦（ユニゾンの 1 本ぶん。ns 本を同時に打つ） */
export interface StruckString {
  /** 振動する長さ [m]・線密度 [kg/m]・張力 [N]・本数 */
  L: number;
  mu: number;
  T: number;
  ns: number;
  /** 打つ点（端からの距離） [m] */
  x0: number;
  /** モードの角周波数 [rad/s] と減衰率 [1/s]（弦だけ） */
  w: Float64Array;
  s: Float64Array;
}

export interface Contact {
  /** ハンマーが離れたあと（標本 n1 の時刻）のモードの変位 [m] と速度 [m/s] */
  q: Float64Array;
  dq: Float64Array;
  /** 解析の終わりの標本（この時刻から自由振動として回す） */
  n1: number;
  /** 衝突の間の駒の力 [N]（弦 1 本ぶん、標本 0〜n1−1） */
  fb: Float64Array;
  /** 接触していた時間 [s]・最大の力 [N]（弦 1 本ぶん）・最大の圧縮 [m]・離れたときのハンマーの速さ [m/s] */
  tc: number;
  fmax: number;
  dmax: number;
  vOut: number;
  /** 力の時間変化（表示用、OS 倍の細かさ。弦 1 本ぶん） [N] */
  force: Float64Array;
  /** force の 1 点の時間 [s] */
  dtF: number;
}

/** 1 標本を何回に分けて解くか */
const OS = 8;
/** 離れたあと、再び当たらないかを見続ける時間 [s] */
const WATCH = 2.5e-3;
/** 解析の上限 [s] */
const T_MAX = 0.012;

/** 打つ点 x0 で、幅 w の平らなハンマーが当たるときのモードの重み sin(nπx0/L)·sinc(nπw/2L) */
export function strikeWeights(s: StruckString, w: number): Float64Array {
  const n = s.w.length,
    out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = ((i + 1) * Math.PI) / s.L,
      u = (k * w) / 2;
    out[i] = Math.sin(k * s.x0) * (u < 1e-9 ? 1 : Math.sin(u) / u);
  }
  return out;
}

/**
 * ハンマーで弦を打つ。fs はサンプリング周波数。弦のモード q_n は
 * q̈ + 2σ q̇ + ω² q = (2 / μL) φ_n F で、各段で力を一定として正確に進める
 */
export function strike(s: StruckString, h: HammerSpec, fs: number): Contact {
  const N = s.w.length,
    dt = 1 / (fs * OS),
    phi = strikeWeights(s, h.w),
    gm = 2 / (s.mu * s.L),
    /* 弦 1 本が受け持つハンマーの質量 */
    mh = h.m / s.ns,
    /* 駒の力 F_b = Σ T (nπ/L) (−1)^{n+1} q_n */
    cb = new Float64Array(N);
  for (let i = 0; i < N; i++) cb[i] = ((s.T * (i + 1) * Math.PI) / s.L) * (i % 2 ? -1 : 1);
  /* 状態遷移: 減衰振動の [q, q̇] を dt 進める行列と、一定の力に対する応答 */
  const a11 = new Float64Array(N),
    a12 = new Float64Array(N),
    a21 = new Float64Array(N),
    a22 = new Float64Array(N),
    g1 = new Float64Array(N),
    g2 = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const sg = s.s[i],
      w0 = s.w[i],
      wd = Math.sqrt(Math.max(1e-9, w0 * w0 - sg * sg)),
      e = Math.exp(-sg * dt),
      c = Math.cos(wd * dt),
      sn = Math.sin(wd * dt);
    a11[i] = e * (c + (sg / wd) * sn);
    a12[i] = (e * sn) / wd;
    a21[i] = (-e * (w0 * w0) * sn) / wd;
    a22[i] = e * (c - (sg / wd) * sn);
    /* 単位の力（加速度 1）を dt 一定に加えたときの応答 */
    g1[i] = (1 - a11[i]) / (w0 * w0);
    g2[i] = a12[i];
  }
  const q = new Float64Array(N),
    dq = new Float64Array(N),
    nMax = Math.ceil(T_MAX * fs),
    fb = new Float64Array(nMax),
    force: number[] = [];
  let xh = 0,
    vh = h.v,
    tc = 0,
    fmax = 0,
    dmax = 0,
    lastOn = -1,
    n1 = nMax,
    prevDp = 0;
  for (let n = 0; n < nMax; n++) {
    for (let k = 0; k < OS; k++) {
      let y = 0;
      for (let i = 0; i < N; i++) y += phi[i] * q[i];
      const d = xh - y,
        dp = d > 0 ? d ** h.p : 0,
        ddp = (dp - prevDp) / dt;
      prevDp = dp;
      let F = 0;
      if (d > 0) {
        F = Math.max(0, h.K * (dp + h.alpha * ddp));
        tc += dt;
        lastOn = n * OS + k;
        if (d > dmax) dmax = d;
      }
      if (F > fmax) fmax = F;
      force.push(F);
      /* ハンマー（半陰的オイラー） */
      vh -= (F / mh) * dt;
      xh += vh * dt;
      for (let i = 0; i < N; i++) {
        const u = gm * phi[i] * F,
          q0 = q[i],
          v0 = dq[i];
        q[i] = a11[i] * q0 + a12[i] * v0 + g1[i] * u;
        dq[i] = a21[i] * q0 + a22[i] * v0 + g2[i] * u;
      }
    }
    let f = 0;
    for (let i = 0; i < N; i++) f += cb[i] * q[i];
    fb[n] = f;
    /* 離れてからしばらく当たらなければ終わり */
    if (lastOn >= 0 && (n * OS - lastOn) * dt > WATCH) {
      n1 = n + 1;
      break;
    }
  }
  /* 表示用の力は、最後に離れた少しあとまで */
  const nf = Math.min(force.length, lastOn + Math.ceil(2e-4 / dt));
  return {
    q,
    dq,
    n1,
    fb: fb.slice(0, n1),
    tc,
    fmax,
    dmax,
    vOut: vh,
    force: Float64Array.from(force.slice(0, Math.max(1, nf))),
    dtF: dt,
  };
}
