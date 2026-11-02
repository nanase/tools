/**
 * 雷鳴のページの放電路（DOM に依存しない）: 乱数で曲がりくねった折れ線を作る。
 * 雲の中の放電路の複数の所から樹状に垂れ下がる先駆放電を競争させ、最初に地面へ届いた経路を本流に、残りを止まった枝にする（growTree）。
 * 本流は分かれた所から雲の中を横へ続く。雲の中へ進む向きの数（0 もある）は種ごとの乱数で決める（shape）。
 * 雲の中の放電路と地面に届く枝は、断面の図で見たとおりに聞こえるよう、x 軸に沿う面（聞き手の通る面）の近くに寄せる。
 * 1 回の雷で同じ放電路に何回も電流が流れる（多重雷）。2 回目からは枝を通らず、雲の中で分かれて新しい所まで伸びる。
 * 座標は落雷点を原点、z を上。聞き手は x 軸の上（右が +x）
 */
import { mulberry, normal } from '../kalman/kf';

export type V3 = [number, number, number];

/** 折れ線 1 本 */
export interface Branch {
  /** 頂点 x, y, z [m] を 3 つずつ */
  p: Float64Array;
  /** 単位長さあたりのエネルギー [J/m] */
  e: number;
  /** 電流が流れる放電路（本流・雲の中・地面に届く枝）は 0、下へ伸びて止まった枝は 1 */
  k: 0 | 1;
  /** 電流が流れる時刻 [s]（最初の放電が 0） */
  t: number;
}

export interface ChannelSet {
  /** 乱数の種 */
  seed: number;
  /** 雲の底の高さ [m]。本流はここまで上へ進む */
  base: number;
  /** 雲の中を横へ進む長さの目安 [m]（向きごとに 0.6〜1.2 倍） */
  cloud: number;
  /** 区間の長さの下限と上限 [m]（この間で一様） */
  lmin: number;
  lmax: number;
  /** 隣り合う区間の向きの変化の平均 [度] */
  turn: number;
  /** 本流の単位長さあたりのエネルギー [J/m] */
  e: number;
  /** 止まった枝のエネルギーの合計を、本流の長さに直した値 [m]。枝の形によらず合計をそろえる */
  eTree: number;
  /** 放電の回数（多重雷） */
  strokes: number;
  /** 放電の間隔の幾何平均 [s]（対数正規分布） */
  gap: number;
  /** 2 回目からの放電のエネルギーの、最初の放電に対する比 */
  eSub: number;
  /** 2 回目から 1 回ごとに、雲の中で新しく分かれて伸びる長さ [m] */
  grow: number;
}

/** 放電の回数の上限 */
export const STROKES_MAX = 8;
/** 放電の間隔の対数の標準偏差と、間隔の下限・上限 [s] */
const GAP_SD = 0.8,
  GAP_MIN = 0.01,
  GAP_MAX = 0.5;

/**
 * 既定: 区間の平均 8 m（LeVine・Gilson 1984、Lacroix ほか 2019）・向きの変化の平均 16°（Hill 1968）・
 * E = 10⁶ J/m（Few 1969）・放電の間隔の幾何平均 61 ms（Saba ほか 2006）・放電の回数 4（多くは 3〜5 回）。
 * 雲の高さ・雲の中の長さ・枝のエネルギー・長さの幅・2 回目からのエネルギーと伸びは仮。
 * 雲の中は 5 km 前後進め、3 km 先で雷鳴が 10 秒ほど続くようにした。
 * 2 回目からは雲の中の電荷を、ほぼ同じ高さで最初より遠い所から引く（Krehbiel ほか 1979 は最大 8 km）ので、雲の中で分かれて 3 km 伸ばす
 */
export const CH0: ChannelSet = {
  seed: 1,
  base: 2000,
  cloud: 5000,
  lmin: 4,
  lmax: 12,
  turn: 16,
  e: 1e6,
  eTree: 900,
  strokes: 4,
  gap: 0.061,
  eSub: 0.3,
  grow: 3000,
};

/** 雲の中へ進む向きの数が 0・1・2・3 になる確かさ（仮） */
export const LEGS_P = [0.15, 0.45, 0.3, 0.1];
/** 地面に届く枝のエネルギーの、本流に対する比（仮） */
const FORK_E = 0.5;

/** 雲の中の向きと、地面に届く枝の向きの、x 軸からのずれの上限 [度]（図の面に寄せる） */
export const PLANE_DEV = 10;
/** 雲の中の放電路が目指す、軸の上の先の点までの距離 [m]。軸から横へ離れるほど、軸へ戻る向きを目指す */
const LOOK = 120;

/** 1 回の雷の放電路の形（種で決まる） */
export interface Shape {
  /** 雲の底から横へ進む向き [度]（+x から反時計回り）と長さ [m]。0 本もある */
  legs: { az: number; len: number }[];
}

/** 放電路の形を決める。折れ線とは別の乱数を使う */
export function shape(s: ChannelSet): Shape {
  const r = mulberry(s.seed * 6151 + 101),
    u = r();
  let n = 0;
  for (let acc = LEGS_P[0]; n < LEGS_P.length - 1 && u >= acc; acc += LEGS_P[++n]);
  /* 右（0°）と左（180°）へ交互に、x 軸から ±PLANE_DEV° */
  const s0 = r() < 0.5 ? 0 : 180,
    dev = () => (r() - 0.5) * 2 * PLANE_DEV,
    legs = Array.from({ length: n }, (_, k) => ({
      az: s0 + (k % 2) * 180 + dev(),
      len: s.cloud * (0.6 + 0.6 * r()),
    }));
  return { legs };
}

/** 向きがこれより目標から離れたら、曲がる向きを目標の側へ折り返す [度] */
const WANDER = 35;
/**
 * 雲の中の放電路は、水平の向きがこれより目標から離れたら折り返す [度]（高さの向きは WANDER のまま）。
 * 大きく蛇行させて、聞き手に横を向く所を増やす（仮。WANDER のままだと雲の中の音が端の向きでなまり、雷鳴がすぐ消える）
 */
const CLOUD_WANDER = 80;
/** 雲の中の放電路の仰角の上限 [度]（ほぼ同じ高さを進む）と、雲の底から入る深さ [m] */
const CLOUD_ELEV = 10,
  CLOUD_IN = 300;

const norm = (v: V3): V3 => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const angle = (a: V3, b: V3) => Math.acos(Math.min(1, Math.max(-1, dot(a, b))));
/** 水平の向きの間の角 [度] と、向きの仰角の大きさ [度] */
const hAngle = (a: V3, b: V3) =>
  (Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1])) * 180) / Math.PI;
const elev = (a: V3) => (Math.abs(Math.asin(Math.min(1, Math.max(-1, a[2])))) * 180) / Math.PI;

/** d を、d に垂直な向き（方位 φ）へ θ だけ傾ける */
function tilt(d: V3, th: number, ph: number): V3 {
  const ref: V3 = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0],
    u = norm(cross(d, ref)),
    w = cross(d, u),
    s = Math.sin(th),
    c = Math.cos(th),
    cp = Math.cos(ph),
    sp = Math.sin(ph);
  return norm([
    c * d[0] + s * (cp * u[0] + sp * w[0]),
    c * d[1] + s * (cp * u[1] + sp * w[1]),
    c * d[2] + s * (cp * u[2] + sp * w[2]),
  ]);
}

/**
 * 乱歩で折れ線を作る。区間ごとに向きを、平均 turn の半正規分布の角度だけ乱数の方位へ傾ける。
 * 目標の向き g から WANDER より離れていて、さらに離れる向きなら方位を反対にする（角度の分布は変えない）。
 * flat を与えると雲の中の歩き方: 水平の向きは g から flat 度まで、仰角は CLOUD_ELEV 度まで離れてよく、雲の底の近くより下へは潜っていかない。
 * 雲の中では g を、from から g0 の向きへ引いた軸の上の LOOK 先の点への水平の向きにする（軸から離れすぎない）。
 * done(点, 進んだ長さ) が真になったら止める
 */
function walk(
  r: () => number,
  s: ChannelSet,
  from: V3,
  d0: V3,
  g0: V3,
  done: (p: V3, len: number) => boolean,
  flat?: number,
): number[] {
  const u = norm([g0[0], g0[1], 0]);
  /* 半正規分布の平均は σ√(2/π) */
  const sig = ((s.turn * Math.PI) / 180) * Math.sqrt(Math.PI / 2),
    out = [...from];
  let p = from,
    d = norm(d0),
    len = 0;
  for (let n = 0; n < 100000 && !done(p, len); n++) {
    let g = g0;
    if (flat != null) {
      /* 軸からの横のずれ e を打ち消しながら、軸に沿って LOOK 先を目指す */
      const ex = p[0] - from[0],
        ey = p[1] - from[1],
        t = ex * u[0] + ey * u[1];
      g = norm([LOOK * u[0] - (ex - t * u[0]), LOOK * u[1] - (ey - t * u[1]), 0]);
    }
    const th = Math.abs(normal(r)) * sig;
    let ph = 2 * Math.PI * r(),
      nd = tilt(d, th, ph);
    const away = (a: V3, b: V3) =>
      flat == null
        ? angle(a, g) * (180 / Math.PI) > WANDER && angle(b, g) > angle(a, g)
        : (hAngle(a, g) > flat && hAngle(b, g) > hAngle(a, g)) ||
          (elev(a) > CLOUD_ELEV && elev(b) > elev(a)) ||
          /* 雲の底から CLOUD_IN より下では下へ向かわない */
          (p[2] < s.base + CLOUD_IN && a[2] < 0 && b[2] < a[2]);
    if (away(d, nd)) {
      ph += Math.PI;
      nd = tilt(d, th, ph);
    }
    d = nd;
    const l = s.lmin + (s.lmax - s.lmin) * r();
    p = [p[0] + l * d[0], p[1] + l * d[1], p[2] + l * d[2]];
    /* 地面より下へは行かない */
    if (p[2] < 0) p[2] = 0;
    out.push(...p);
    len += l;
  }
  return out;
}

/* 先駆放電の樹の値はどれも仮。枝の数と総延長が写真に近く、地面に届く枝が測定の割合になるように選んだ */
/** 雲の中の向きの数ごとの、1 つの向きから垂れ下がる経路の数 */
const TREE_ROOTS = [0, 4, 3, 2];
/** 垂れ下がる所の、雲の中の放電路に沿った範囲 [m] と、向きの長さに対する上限 */
const ROOT_SPAN = 2000,
  ROOT_SPAN_MAX = 0.6;
/** 雲の中へ進まない雷の、経路の数・分かれる高さの雲の底からの差 [m]・傾き [度] */
const LONE_ROOTS = 3,
  LONE_RISE = 500,
  LONE_TILT = 20;
/** 枝の段ごとの、次の枝を出すまでの平均の長さ [m]。これより先の段は枝を出さない */
const TREE_SPAWN = [400, 500];
/** 枝の段ごとの、伸びが止まるまでの平均の長さ [m]。最初の経路だけは止めないので、必ずどれかが地面に届く */
const TREE_LIFE = [1500, 600, 250];
/** 垂れ下がる経路が止まらずに伸びる長さの下限 [m] */
const ROOT_LIFE_MIN = 900;
/** 枝ごとの速さの対数の標準偏差と、親に対する速さの比 */
const TREE_SPEED_SD = 0.4,
  TREE_SPEED_CHILD = 0.85;
/** 枝が親の向きから開く角度の下限と幅、鉛直からの傾きの上限 [度]、垂れ下がる経路の傾きの上限 [度] */
const TREE_FORK = 20,
  TREE_FORK_W = 30,
  TREE_TILT = 60,
  TREE_ROOT_TILT = 15;
/** 頂点の数の上限。超えたら新しい枝を出さない */
const TREE_VERTS = 6000;
/** 本流が接地したとき、これより低い先端は電位の変化が届く前に地面に届く [m] */
const FORK_REACH = 25;
/** 別の落雷点とみなす、本流の接地点からの水平距離の下限 [m] と、地面に届く枝の数の上限 */
const FORK_SEP = 100,
  FORK_MAX = 2;
/** 止まった枝の単位長さあたりのエネルギーの、本流に対する上限と下限 */
const DEAD_E_MAX = 0.3,
  DEAD_E_MIN = 0.01;

/** 伸びている途中の枝 */
interface Arm {
  /** 頂点 x, y, z。先頭は親の頂点と同じ点 */
  q: number[];
  /** 親の番号（垂れ下がる経路は −1）と、分かれた親の頂点の番号 */
  parent: number;
  at: number;
  /** 枝の段（垂れ下がる経路が 0） */
  order: number;
  /** 速さの比 */
  v: number;
  /** 鉛直からの傾き [度]。正は +x の側 */
  lean: number;
  /** 目指す向きと、今の向き */
  g: V3;
  d: V3;
  /** 次の頂点と、そこに着く時刻 */
  pend: V3;
  when: number;
  /** 止まるまでと、次の枝を出すまでの残りの長さ [m] */
  life: number;
  spawn: number;
  stopped: boolean;
}

/** 折れ線の頂点の順を逆にする */
function flip(q: readonly number[]): number[] {
  const o: number[] = [];
  for (let i = q.length - 3; i >= 0; i -= 3) o.push(q[i], q[i + 1], q[i + 2]);
  return o;
}

/** 平均 mean の指数分布 */
const expo = (r: () => number, mean: number) =>
  Number.isFinite(mean) ? -mean * Math.log(1 - r()) : Number.POSITIVE_INFINITY;

/** 傾き lean [度] で x 軸に沿う面の近くを下りる向き */
function downward(r: () => number, lean: number): V3 {
  const th = (lean * Math.PI) / 180,
    az = ((r() - 0.5) * 2 * PLANE_DEV * Math.PI) / 180;
  return norm([Math.sin(th) * Math.cos(az), Math.sin(th) * Math.sin(az), -Math.cos(th)]);
}

/** 垂れ下がる経路の根元 */
interface Seed {
  p: V3;
  /** 鉛直からの傾き [度] */
  lean: number;
  /** 雲の中の向きの番号と頂点の番号（雲の中へ進まない雷は −1） */
  leg: number;
  i: number;
}

/**
 * 垂れ下がる経路の根元を決める。雲の中の向きごとに範囲を等分して、分けた区間から 1 つずつ選ぶ。
 * 根元に近い順に並べる（最初の経路だけは止めない）
 */
function rootSeeds(r: () => number, legs: readonly number[][], top: V3): Seed[] {
  if (!legs.length)
    return Array.from({ length: LONE_ROOTS }, (_, k) => ({
      p: top,
      lean: ((k * 2) / (LONE_ROOTS - 1) - 1) * LONE_TILT,
      leg: -1,
      i: 0,
    }));
  const out: (Seed & { d: number })[] = [];
  legs.forEach((q, leg) => {
    const n = TREE_ROOTS[legs.length],
      span = Math.min(ROOT_SPAN, ROOT_SPAN_MAX * branchLength(Float64Array.from(q)));
    let i = 0,
      len = 0;
    for (let k = 0; k < n; k++) {
      const d = (span * (k + r())) / n;
      for (; i < q.length / 3 - 1 && len < d; i++)
        len += Math.hypot(q[3 * i + 3] - q[3 * i], q[3 * i + 4] - q[3 * i + 1], q[3 * i + 5] - q[3 * i + 2]);
      out.push({
        p: [q[3 * i], q[3 * i + 1], q[3 * i + 2]],
        lean: (r() - 0.5) * 2 * TREE_ROOT_TILT,
        leg,
        i,
        d,
      });
    }
  });
  return out.sort((a, b) => a.d - b.d);
}

/** 先駆放電の樹。座標は接地した点を原点にそろえたもの */
interface Tree {
  /** 接地した点から根元までの本流 */
  trunk: number[];
  /** 接地した点の、原点へ移す前の座標と、本流の根元の番号 */
  zero: number[];
  root: number;
  /** 止まった枝 */
  dead: { q: number[]; e: number }[];
  /** 本流のほかに地面に届いた枝（分かれた点から地面まで） */
  forks: number[][];
}

/**
 * 止まった枝のエネルギーを配る。枝にためた電荷は接地のあと本流へ抜けるので、その先の枝まで含めて長い枝ほど大きくする。
 * 比例の形は仮で、合計は eTree にそろえる（上限と下限で切った分だけずれる）
 */
function deadBranches(arms: readonly Arm[], used: readonly number[], s: ChannelSet): Tree['dead'] {
  const lens = arms.map((a, k) => branchLength(Float64Array.from(a.q.slice(3 * used[k])))),
    sub = [...lens];
  /* 子は親より後ろに並ぶので、後ろから足す。電流の道に使った所より手前で分かれた子は、親の枝の先ではない */
  for (let k = arms.length - 1; k >= 0; k--) {
    const a = arms[k];
    if (a.parent >= 0 && a.at > used[a.parent]) sub[a.parent] += sub[k];
  }
  let sum = 0;
  for (let k = 0; k < arms.length; k++) sum += sub[k] * lens[k];
  const c = sum > 0 ? s.eTree / sum : 0,
    out: Tree['dead'] = [];
  arms.forEach((a, k) => {
    if (lens[k] > 0)
      out.push({ q: a.q.slice(3 * used[k]), e: s.e * Math.min(DEAD_E_MAX, Math.max(DEAD_E_MIN, c * sub[k])) });
  });
  return out;
}

/**
 * 根元から先端を伸ばす。枝ごとに速さが違い、途中で枝を出し、止まる枝もある。
 * 時刻の順に頂点を足し、最初に地面へ届いた先端で全体を止める。そこから根元へたどった道が本流になる。
 * 接地の電位の変化が届く前に地面へ届くほど低い先端は、そのまま地面まで伸ばす（Guo・Krider 1982）
 */
function growTree(r: () => number, s: ChannelSet, seeds: readonly Seed[]): Tree {
  const sig = ((s.turn * Math.PI) / 180) * Math.sqrt(Math.PI / 2),
    arms: Arm[] = [];
  /** 先端 p から次の頂点を決める */
  const plan = (a: Arm, t: number, p: V3) => {
    const th = Math.abs(normal(r)) * sig;
    let nd = tilt(a.d, th, 2 * Math.PI * r());
    if (angle(a.d, a.g) * (180 / Math.PI) > WANDER && angle(nd, a.g) > angle(a.d, a.g))
      nd = [2 * a.d[0] * dot(a.d, nd) - nd[0], 2 * a.d[1] * dot(a.d, nd) - nd[1], 2 * a.d[2] * dot(a.d, nd) - nd[2]];
    a.d = nd;
    const l = s.lmin + (s.lmax - s.lmin) * r();
    a.pend = [p[0] + l * nd[0], p[1] + l * nd[1], Math.max(0, p[2] + l * nd[2])];
    a.when = t + l / a.v;
    a.life -= l;
    a.spawn -= l;
  };
  const sprout = (parent: number, at: number, from: V3, order: number, v: number, lean: number, t: number) => {
    const g = downward(r, lean),
      a: Arm = {
        q: [...from],
        parent,
        at,
        order,
        v,
        lean,
        g,
        d: g,
        pend: from,
        when: t,
        life: expo(r, TREE_LIFE[order]),
        spawn: order < TREE_SPAWN.length ? expo(r, TREE_SPAWN[order]) : Number.POSITIVE_INFINITY,
        stopped: false,
      };
    arms.push(a);
    plan(a, t, from);
  };
  for (const f of seeds) sprout(-1, 0, f.p, 0, Math.exp(TREE_SPEED_SD * normal(r)), f.lean, 0);
  /* どの経路も雲の下までは伸ばす */
  for (const a of arms) a.life += ROOT_LIFE_MIN;
  arms[0].life = Number.POSITIVE_INFINITY;
  /* 時刻のいちばん早い先端を 1 区間ずつ進める */
  let won = -1,
    verts = 0;
  while (won < 0) {
    let i = -1;
    for (let k = 0; k < arms.length; k++) if (!arms[k].stopped && (i < 0 || arms[k].when < arms[i].when)) i = k;
    const a = arms[i],
      p = a.pend,
      t = a.when;
    a.q.push(...p);
    verts++;
    if (p[2] <= 0) {
      won = i;
    } else if (a.life <= 0) {
      a.stopped = true;
    } else {
      if (a.spawn <= 0) {
        a.spawn = expo(r, TREE_SPAWN[a.order]);
        if (verts < TREE_VERTS)
          sprout(
            i,
            a.q.length / 3 - 1,
            p,
            a.order + 1,
            a.v * TREE_SPEED_CHILD * Math.exp(TREE_SPEED_SD * normal(r)),
            Math.max(-TREE_TILT, Math.min(TREE_TILT, a.lean + (r() < 0.5 ? -1 : 1) * (TREE_FORK + TREE_FORK_W * r()))),
            t,
          );
      }
      plan(a, t, p);
    }
  }
  const zero = arms[won].q.slice(-3);
  /* 地面の近くまで来ていた先端は、そのまま地面まで伸ばす */
  const near = arms
    .map((a, k) => ({ k, a, n: a.q.length }))
    .filter(
      ({ k, a, n }) =>
        k !== won &&
        !a.stopped &&
        n > 3 &&
        a.q[n - 1] <= FORK_REACH &&
        Math.hypot(a.q[n - 3] - zero[0], a.q[n - 2] - zero[1]) >= FORK_SEP,
    )
    .sort((x, y) => x.a.q[x.n - 1] - y.a.q[y.n - 1])
    .slice(0, FORK_MAX);
  for (const { a } of near) a.q.push(...walk(r, s, a.q.slice(-3) as V3, a.d, a.g, (q) => q[2] <= 0).slice(3));
  /* 接地した点を原点へ */
  for (const a of arms)
    for (let i = 0; i < a.q.length; i += 3) {
      a.q[i] -= zero[0];
      a.q[i + 1] -= zero[1];
    }
  /* 枝ごとの、電流の道に使った頂点の番号。先端から根元へたどり、使った道か根元に着くまでを返す */
  const used = arms.map(() => 0),
    vertex = (a: Arm, i: number) => [a.q[3 * i], a.q[3 * i + 1], a.q[3 * i + 2]],
    chain = (tip: number): number[] => {
      const out: number[] = [];
      let k = tip,
        end = arms[tip].q.length / 3 - 1;
      for (;;) {
        const a = arms[k],
          from = used[k];
        if (end <= from) {
          out.push(...vertex(a, end));
          return out;
        }
        for (let i = end; i > from; i--) out.push(...vertex(a, i));
        used[k] = end;
        if (from > 0 || a.parent < 0) {
          out.push(...vertex(a, from));
          return out;
        }
        end = a.at;
        k = a.parent;
      }
    };
  /* 本流は接地した点から根元へ、地面に届いた枝は分かれた点から地面へ */
  const trunk = chain(won),
    forks = near.map(({ k }) => flip(chain(k)));
  let root = won;
  while (arms[root].parent >= 0) root = arms[root].parent;
  return { trunk, zero, root, dead: deadBranches(arms, used, s), forks };
}

/**
 * 放電路を作る。同じ設定と種なら同じ形。
 * 並びは最初の放電の本流・雲の中のほかの道・止まった枝・地面に届く枝、2 回目からの放電の本流。
 * 本流は接地した点から根元へ上がり、根元のある雲の中の向きの先へ続く。その向きの手前と、ほかの向きが雲の中のほかの道になる。
 * 2 回目からの本流は、前の放電の雲の中の放電路の途中から分かれ、外へ向かう新しい向きに grow だけ進む
 */
export function makeChannel(s: ChannelSet): Branch[] {
  const r = mulberry(s.seed * 7919 + 13),
    sh = shape(s),
    mk = (q: number[], e: number, k: 0 | 1, t: number): Branch => ({ p: Float64Array.from(q), e, k, t }),
    /* 雲の中へ進まない雷は、雲の中の 1 点で分かれてから雲の底を抜ける */
    top: V3 = [0, 0, s.base + (sh.legs.length ? 0 : LONE_RISE)],
    legs = sh.legs.map(({ az, len }) => {
      const a = (az * Math.PI) / 180,
        side: V3 = [Math.cos(a), Math.sin(a), 0];
      return walk(r, s, top, norm([side[0], side[1], 0.3]), side, (_, l) => l >= len, CLOUD_WANDER);
    }),
    seeds = rootSeeds(r, legs, top),
    tree = growTree(r, s, seeds),
    { trunk, zero } = tree,
    seed = seeds[tree.root];
  for (const q of legs)
    for (let i = 0; i < q.length; i += 3) {
      q[i] -= zero[0];
      q[i + 1] -= zero[1];
    }
  /* 本流は根元のある向きの先へ続く。その向きの手前とほかの向きは、雲の中のほかの道 */
  const home = seed.leg >= 0 ? legs[seed.leg] : [],
    main = [...trunk, ...home.slice(3 * (seed.i + 1))],
    back = flip(home.slice(0, 3 * (seed.i + 1))),
    cloud = [...(back.length > 3 ? [back] : []), ...legs.filter((_, k) => k !== seed.leg)],
    out: Branch[] = [mk(main, s.e, 0, 0), ...cloud.map((q) => mk(q, s.e, 0, 0))],
    nt = trunk.length / 3;
  for (const d of tree.dead) out.push(mk(d.q, d.e, 1, 0));
  for (const f of tree.forks) out.push(mk(f, s.e * FORK_E, 0, 0));
  /* 2 回目からの放電: 形と間隔は回ごとの乱数で決め、回数を変えても前の回の形と時刻が変わらない。
     雲の中へ進まない雷は、2 回目からも落雷点から雲の底までを通る */
  let prev = main,
    t = 0;
  for (let k = 1; k < Math.min(s.strokes, STROKES_MAX); k++) {
    const rk = mulberry(s.seed * 104729 + k * 31 + 7);
    t += Math.min(GAP_MAX, Math.max(GAP_MIN, s.gap * Math.exp(GAP_SD * normal(rk))));
    if (!legs.length) {
      out.push(mk(trunk, s.e * s.eSub, 0, t));
      continue;
    }
    /* 前の回の雲の中（雲の底から先）の、後ろ 7 割のどこかで分かれる */
    const n = prev.length / 3,
      i = Math.min(n - 1, Math.floor(nt + (n - nt) * (0.3 + 0.7 * rk()))),
      o: V3 = [prev[3 * i], prev[3 * i + 1], prev[3 * i + 2]],
      /* 落雷点から見て外へ（右なら右、左なら左）、x 軸から ±PLANE_DEV° */
      th = ((o[0] >= 0 ? 0 : 180) + (rk() - 0.5) * 2 * PLANE_DEV) * (Math.PI / 180),
      g: V3 = [Math.cos(th), Math.sin(th), 0],
      q = walk(rk, s, o, g, g, (_, len) => len >= s.grow, CLOUD_WANDER).slice(3),
      p = [...prev.slice(0, 3 * (i + 1)), ...q];
    out.push(mk(p, s.e * s.eSub, 0, t));
    prev = p;
  }
  return out;
}

/** 最初の放電で地面に届いた所の数 */
export const strikeCount = (bs: readonly Branch[]): number =>
  1 + bs.filter((b) => b.k === 0 && b.t === 0 && b.p[b.p.length - 1] <= 0).length;

/** 放電の時刻 [s] の一覧（最初が 0） */
export const strokeTimes = (bs: readonly Branch[]): number[] => [
  ...new Set(bs.filter((b) => b.k === 0).map((b) => b.t)),
];

/** 折れ線の長さ [m] */
export function branchLength(p: Float64Array): number {
  let L = 0;
  for (let i = 3; i < p.length; i += 3) L += Math.hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2], p[i + 2] - p[i - 1]);
  return L;
}

/** 隣り合う区間の向きの変化 [度] の一覧 */
export function turnAngles(p: Float64Array): number[] {
  const out: number[] = [];
  for (let i = 6; i < p.length; i += 3) {
    const a = norm([p[i - 3] - p[i - 6], p[i - 2] - p[i - 5], p[i - 1] - p[i - 4]]),
      b = norm([p[i] - p[i - 3], p[i + 1] - p[i - 2], p[i + 2] - p[i - 1]]);
    if (Number.isFinite(a[0]) && Number.isFinite(b[0])) out.push((angle(a, b) * 180) / Math.PI);
  }
  return out;
}
