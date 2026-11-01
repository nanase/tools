/**
 * PNG のページの見本 4 枚。どれも画素ごとの式と決まった種の乱数で描き、毎回同じ画素になる。
 * - 試験図: 横 6 段の帯。段ごとに Sub・Up・Paeth・Average・None が効くように作り、最後の段は LZ77 の一致が効く繰り返し
 * - 写真風: 空・山・湖の滑らかな絵にわずかな雑音。PNG が苦手な画像
 * - 画面: 平らな色と同じ部品の繰り返し。色が少なくパレットにでき、一致が長くなる
 * - イラスト: 平らな塗りと透明・半透明の所。16 色で深度 4 のパレットにできる
 */

/** 決まった種から作る疑似乱数（xorshift、0〜1） */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 2 ** 32;
  };
}
const clamp8 = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
/** 2 次元の滑らかな雑音（格子点の乱数を smoothstep でつなぐ。0〜1） */
function valueNoise(seed: number): (x: number, y: number) => number {
  const h = (i: number, j: number): number => {
    let n = (i * 374761393 + j * 668265263 + seed * 1442695041) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 2 ** 32;
  };
  const sm = (t: number): number => t * t * (3 - 2 * t);
  return (x, y) => {
    const i = Math.floor(x),
      j = Math.floor(y),
      fx = sm(x - i),
      fy = sm(y - j),
      a = h(i, j) + (h(i + 1, j) - h(i, j)) * fx,
      b = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * fx;
    return a + (b - a) * fy;
  };
}

/* ---------- 試験図 ---------- */
export const CHART_W = 384;
export const CHART_H = 288;
/** 1 段の高さ */
export const CHART_BAND = 48;
/** 各段で最も小さくなるフィルタ（最後の段は一致を見せる段なので決めない） */
export const CHART_FILTERS = [1, 2, 4, 3, 0] as const;

/** 試験図: 段ごとに効くフィルタが違う 6 段の帯 */
export function chart(): Uint8ClampedArray {
  const W = CHART_W,
    B = CHART_BAND,
    d = new Uint8ClampedArray(W * CHART_H * 4),
    r = rng(7),
    set = (x: number, y: number, R: number, G: number, Bl: number): void =>
      d.set([clamp8(R), clamp8(G), clamp8(Bl), 255], (y * W + x) * 4);
  /*
   * 1 段目 Sub: 行ごとに傾きが一定のぎざぎざ（256 で折り返す）。緩い行と急な行を交互に置くので、
   * 上の行からの予測（Up・Average）は外れ、左からの予測が当たる。Paeth は左を選ぶことが多く、Sub に近い
   */
  for (let y = 0; y < B; y++) {
    const o = r() * 3,
      s = y % 2 ? [1.9, 1.3, 2.3] : [0.35, 0.25, 0.3];
    for (let x = 0; x < W; x++)
      d.set([(o + x * s[0]) & 255, (o + 4 + x * s[1]) & 255, (o + 2 + x * s[2]) & 255, 255], (y * W + x) * 4);
  }
  /* 2 段目 Up: 列ごとに色が跳ぶ縦縞。6 行ごとに全体が明るくなる */
  const col = Array.from({ length: W }, () => [r() * 190, r() * 190, r() * 190]);
  for (let y = B; y < 2 * B; y++)
    for (let x = 0; x < W; x++) {
      const k = Math.floor((y - B) / 6) * 8;
      set(x, y, col[x][0] + k, col[x][1] + k * 0.5, col[x][2] + 40 - k * 0.5);
    }
  /* 3 段目 Paeth: 縦にも横にも傾いた平面（a + b − c がほぼそのまま当たる） */
  for (let y = 2 * B; y < 3 * B; y++)
    for (let x = 0; x < W; x++) {
      const v = y - 2 * B;
      set(x, y, 20 + x * 0.55 + v * 1.6, 230 - x * 0.4 + v * 0.9, 60 + x * 0.25 + v * 2.4);
    }
  /* 4 段目 Average: 滑らかな起伏にわずかな雑音（左と上の平均で雑音がならされる） */
  for (let y = 3 * B; y < 4 * B; y++)
    for (let x = 0; x < W; x++) {
      const v = y - 3 * B,
        g = 120 + 90 * Math.sin(x / 40) * Math.cos(v / 30),
        n = (): number => (r() - 0.5) * 10;
      set(x, y, g + n(), g * 0.7 + 40 + n(), 255 - g + n());
    }
  /* 5 段目 None: 黒地にまばらな星（差をとると 1 つの星が 2 か所の差になる） */
  for (let y = 4 * B; y < 5 * B; y++)
    for (let x = 0; x < W; x++)
      if (r() < 0.04) set(x, y, 120 + r() * 135, 120 + r() * 135, 140 + r() * 115);
      else set(x, y, 0, 0, 0);
  /* 6 段目 LZ77: 24×24 の模様の繰り返し（同じ並びが 96 画素ごと・24 行ごとに出る） */
  const SH = [
    [230, 80, 70],
    [70, 150, 230],
    [240, 190, 50],
    [80, 190, 110],
  ];
  for (let y = 5 * B; y < CHART_H; y++)
    for (let x = 0; x < W; x++) {
      const v = y - 5 * B,
        k = (Math.floor(x / 24) + Math.floor(v / 24)) % 4,
        cx = (x % 24) - 11.5,
        cy = (v % 24) - 11.5,
        inS =
          k === 0
            ? Math.hypot(cx, cy) < 8
            : k === 1
              ? Math.abs(cx) < 7 && Math.abs(cy) < 7
              : k === 2
                ? Math.abs(cx) + Math.abs(cy) < 9
                : Math.abs(cx) < 2.5 || Math.abs(cy) < 2.5;
      if (inS) set(x, y, SH[k][0], SH[k][1], SH[k][2]);
      else set(x, y, 244, 242, 236);
    }
  return d;
}

/* ---------- 写真風 ---------- */
export const PHOTO_W = 384;
export const PHOTO_H = 256;

/** 写真風: 夕方の空・山・湖。撮った写真のように、わずかな雑音を足す */
export function photo(): Uint8ClampedArray {
  const W = PHOTO_W,
    H = PHOTO_H,
    d = new Uint8ClampedArray(W * H * 4),
    r = rng(11),
    nz = valueNoise(3),
    cl = valueNoise(9),
    horizon = 170,
    sunX = 270,
    sunY = 120;
  const ridge = (x: number, f: number, a: number, base: number): number =>
    base - a * (nz(x / f, 0.5) * 0.7 + nz(x / (f / 3), 4.5) * 0.3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      /* 湖は上下を返して暗くする */
      const refl = y > horizon,
        yy = refl ? 2 * horizon - y : y,
        t = yy / horizon,
        sd = Math.hypot(x - sunX, yy - sunY);
      let R = 70 + 170 * t + 120 * Math.exp(-sd / 40),
        G = 90 + 90 * t + 90 * Math.exp(-sd / 30),
        B = 170 - 60 * t + 20 * Math.exp(-sd / 60);
      if (sd < 14) [R, G, B] = [255, 238, 200];
      /* 雲 */
      const c = cl(x / 60, yy / 18) * cl(x / 23, yy / 9 + 7);
      if (yy < 120 && c > 0.35) {
        const k = Math.min(1, (c - 0.35) * 4) * (1 - yy / 140);
        R += (250 - R) * k;
        G += (210 - G) * k;
        B += (220 - B) * k;
      }
      /* 山 2 列（遠い山は青く、近い山は暗い）。稜線は画素にかかる割合で混ぜる */
      const mix = (k: number, c: number[]): void => {
        R += (c[0] - R) * k;
        G += (c[1] - G) * k;
        B += (c[2] - B) * k;
      };
      const k1 = Math.min(1, Math.max(0, yy - ridge(x, 90, 70, horizon - 10) + 0.5)),
        s1 = 0.75 + 0.25 * nz(x / 12, yy / 12);
      if (k1 > 0) mix(k1, [90 * s1 + 20, 100 * s1 + 25, 140 * s1 + 30]);
      const k2 = Math.min(1, Math.max(0, yy - ridge(x + 500, 60, 50, horizon + 2) + 0.5)),
        s2 = 0.6 + 0.4 * nz(x / 8, yy / 8 + 30);
      if (k2 > 0) mix(k2, [50 * s2 + 10, 65 * s2 + 15, 60 * s2 + 20]);
      if (refl) {
        const w = 0.7 + 0.08 * Math.sin(y * 1.3 + nz(x / 20, y / 3) * 6);
        R *= w;
        G *= w;
        B = B * w + 12;
      }
      const n = (): number => (r() - 0.5) * 5;
      d.set([clamp8(R + n()), clamp8(G + n()), clamp8(B + n()), 255], (y * W + x) * 4);
    }
  return d;
}

/* ---------- 画面 ---------- */
export const SCREEN_W = 384;
export const SCREEN_H = 256;

/** 画面: 左に並ぶ項目、上の帯、カード、ボタン、表。文字は幅のばらばらな短い棒で表し、ぼかしがないので色は少ない */
export function screen(): Uint8ClampedArray {
  const W = SCREEN_W,
    H = SCREEN_H,
    d = new Uint8ClampedArray(W * H * 4);
  const fill = (x0: number, y0: number, w: number, h: number, c: readonly number[]): void => {
    for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++)
      for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) d.set([c[0], c[1], c[2], 255], (y * W + x) * 4);
  };
  const LINE = [210, 214, 222],
    TXT = [60, 66, 80],
    SUB = [140, 146, 158],
    ACC = [52, 120, 220],
    WHITE = [255, 255, 255],
    ICON = [
      [230, 90, 80],
      [70, 170, 110],
      [240, 180, 60],
      [130, 100, 210],
    ];
  /** 文字の代わり: 幅のばらばらな短い棒（1 語ずつ） */
  const words = (x0: number, y0: number, w: number, c: readonly number[], seed: number): void => {
    const q = rng(seed);
    for (let x = x0; ; ) {
      const n = 6 + Math.floor(q() * 22);
      if (x + n > x0 + w) break;
      fill(x, y0, n, 4, c);
      x += n + 4;
    }
  };
  const box = (x: number, y: number, w: number, h: number, bg: readonly number[]): void => {
    fill(x, y, w, h, bg);
    fill(x, y, w, 1, LINE);
    fill(x, y + h - 1, w, 1, LINE);
    fill(x, y, 1, h, LINE);
    fill(x + w - 1, y, 1, h, LINE);
  };
  fill(0, 0, W, H, [246, 247, 249]);
  fill(0, 0, W, 22, [38, 44, 56]);
  for (let i = 0; i < 3; i++) fill(8 + i * 10, 8, 6, 6, ICON[i]);
  words(60, 9, 120, [220, 224, 232], 1);
  /* 左の一覧: 同じ形の項目が 24 行ごとに並ぶ（選んだ 1 つだけ地の色が違う） */
  fill(0, 22, 112, H - 22, [232, 235, 240]);
  for (let i = 0; i < 9; i++) {
    const y = 30 + i * 24;
    if (i === 2) fill(4, y - 4, 104, 20, [210, 224, 246]);
    fill(10, y, 12, 12, ICON[i % 4]);
    words(30, y + 2, 70, TXT, 100 + (i % 3));
    words(30, y + 8, 50, SUB, 200 + (i % 2));
  }
  fill(112, 22, 1, H - 22, LINE);
  /* 本文: 見出し、段落、カード 3 枚、ボタン 2 つ、縞の表 */
  words(126, 34, 160, TXT, 7);
  fill(126, 40, 160, 2, TXT);
  for (let i = 0; i < 4; i++) words(126, 52 + i * 9, 240, SUB, 300 + i);
  for (let k = 0; k < 3; k++) {
    const x = 126 + k * 84;
    box(x, 96, 76, 70, WHITE);
    fill(x + 6, 102, 64, 30, ICON[k]);
    words(x + 6, 138, 60, TXT, 400 + k);
    words(x + 6, 146, 50, SUB, 500 + k);
    fill(x + 6, 154, 30, 7, ACC);
  }
  fill(126, 180, 70, 18, ACC);
  words(134, 187, 54, WHITE, 9);
  box(204, 180, 70, 18, WHITE);
  words(212, 187, 54, TXT, 10);
  for (let i = 0; i < 4; i++) {
    const y = 208 + i * 11;
    if (i % 2) fill(126, y, 246, 11, [238, 240, 244]);
    for (let c = 0; c < 4; c++) words(130 + c * 62, y + 4, 50, TXT, 600 + ((i * 4 + c) % 5));
  }
  return d;
}

/* ---------- イラスト ---------- */
export const ILLUST_W = 256;
export const ILLUST_H = 192;

type C = readonly [number, number, number, number];
const SKY: C = [0, 0, 0, 0];
const SUN: C = [255, 196, 46, 255];
const RAY: C = [255, 220, 120, 255];
const HILL1: C = [92, 170, 76, 255];
const HILL2: C = [58, 128, 64, 255];
const WALL: C = [236, 228, 210, 255];
const ROOF: C = [196, 64, 52, 255];
const DOOR: C = [110, 72, 40, 255];
const WIN: C = [120, 196, 236, 255];
const LINE: C = [32, 36, 40, 255];
const SHADOW: C = [0, 0, 0, 96];
const CLOUD: C = [255, 255, 255, 200];
const GLASS: C = [80, 140, 255, 128];

/** 画素 (x, y) の色 */
function pix(x: number, y: number): C {
  const cx = x + 0.5,
    cy = y + 0.5;
  /* 半透明の青い板（右上）: 透明度の段階 */
  if (cx > 196 && cx < 244 && cy > 12 && cy < 60) {
    const k = Math.floor((cx - 196) / 16);
    if ((Math.floor(cx) + Math.floor(cy)) % 2 === 0 || k > 1) return [GLASS[0], GLASS[1], GLASS[2], 64 + k * 80];
  }
  /* 太陽と光線 */
  const dx = cx - 52,
    dy = cy - 44,
    r = Math.hypot(dx, dy);
  if (r < 20) return r > 18 ? LINE : SUN;
  if (r > 24 && r < 34) {
    const a = Math.atan2(dy, dx) / (Math.PI / 6);
    if (Math.abs(a - Math.round(a)) < 0.16) return RAY;
  }
  /* 雲（半透明の白） */
  for (const [ox, oy, rr] of [
    [120, 36, 12],
    [134, 30, 15],
    [150, 38, 11],
  ])
    if (Math.hypot(cx - ox, cy - oy) < rr && cy < 44) return CLOUD;
  /* 家 */
  if (cx >= 150 && cx < 214 && cy >= 108 && cy < 160) {
    if (cx < 151 || cx >= 213 || cy >= 159) return LINE;
    if (cx >= 172 && cx < 190 && cy >= 128) return DOOR;
    if ((cx >= 156 && cx < 168 && cy >= 118 && cy < 130) || (cx >= 196 && cx < 208 && cy >= 118 && cy < 130))
      return Math.floor(cx) === 161 || Math.floor(cy) === 123 || Math.floor(cx) === 201 ? LINE : WIN;
    return WALL;
  }
  if (cy >= 80 && cy < 108 && Math.abs(cx - 182) < (cy - 80) * 1.3 + 2)
    return Math.abs(cx - 182) > (cy - 80) * 1.3 - 1 ? LINE : ROOF;
  /* 家の影（半透明の黒） */
  if (cx >= 214 && cx < 236 && cy >= 112 && cy < 160 && cx - 214 < (cy - 112) * 0.6) return SHADOW;
  /* 丘 2 つ */
  const h1 = 150 - 22 * Math.sin((cx / 256) * Math.PI * 1.3),
    h2 = 168 - 14 * Math.cos((cx / 256) * Math.PI * 2.2);
  if (cy > h2) return Math.floor(cx / 8 + cy / 8) % 2 ? HILL2 : [HILL2[0] + 8, HILL2[1] + 10, HILL2[2] + 6, 255];
  if (cy > h1) return HILL1;
  return SKY;
}

/** イラストの RGBA */
export function illust(): Uint8ClampedArray {
  const d = new Uint8ClampedArray(ILLUST_W * ILLUST_H * 4);
  for (let y = 0; y < ILLUST_H; y++) for (let x = 0; x < ILLUST_W; x++) d.set(pix(x, y), (y * ILLUST_W + x) * 4);
  return d;
}

/** 見本の一覧（入力の選択肢と同じ順） */
export interface Sample {
  id: string;
  w: number;
  h: number;
  draw: () => Uint8ClampedArray;
  /** 初めに選ぶ画素 [y, x] */
  at: [number, number];
}
export const SAMPLES: readonly Sample[] = [
  { id: 'chart', w: CHART_W, h: CHART_H, draw: chart, at: [100, 120] },
  { id: 'photo', w: PHOTO_W, h: PHOTO_H, draw: photo, at: [150, 230] },
  { id: 'screen', w: SCREEN_W, h: SCREEN_H, draw: screen, at: [80, 30] },
  { id: 'illust', w: ILLUST_W, h: ILLUST_H, draw: illust, at: [44, 30] },
];
