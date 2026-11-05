/** 見本の画像。式と決まった種の乱数で描き、毎回同じ画素になる。文字だけキャンバスで描く */
import { type Img, mkImg, type Px } from './resample';

type Col = readonly [number, number, number];

function vnoise(seed: number): (x: number, y: number) => number {
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
/** ss × ss の副画素を平均して描く */
function paint(w: number, h: number, f: (x: number, y: number) => Col, ss = 1): Img {
  const d: Px = new Uint8ClampedArray(w * h * 4),
    k = 255 / (ss * ss);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0,
        g = 0,
        b = 0;
      for (let j = 0; j < ss; j++)
        for (let i = 0; i < ss; i++) {
          const c = f(x + (i + 0.5) / ss, y + (j + 0.5) / ss);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      const p = (y * w + x) * 4;
      d[p] = r * k;
      d[p + 1] = g * k;
      d[p + 2] = b * k;
      d[p + 3] = 255;
    }
  return mkImg(w, h, d);
}
const mix = (a: Col, b: Col, t: number): Col => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** 風景: 山・湖・家・柵・電線。細い線と細かい模様を入れる */
export function genScene(): Img {
  const nz = vnoise(3),
    cl = vnoise(9),
    gr = vnoise(21),
    hz = 300;
  const ridge = (x: number, f: number, a: number, base: number): number =>
    base - a * (nz(x / f, 0.5) * 0.7 + nz(x / (f / 3), 4.5) * 0.3);
  return paint(
    768,
    512,
    (x, y) => {
      const refl = y > hz && x < 470,
        yy = refl ? 2 * hz - y : y,
        t = yy / hz;
      let c = mix([0.3, 0.5, 0.82], [0.93, 0.8, 0.66], t);
      const sd = Math.hypot(x - 560, yy - 150);
      if (sd < 24) c = [1, 0.95, 0.8];
      else c = mix(c, [1, 0.85, 0.6], Math.exp(-sd / 70) * 0.7);
      const k = cl(x / 90, yy / 26) * cl(x / 30, yy / 12 + 7);
      if (yy < 200 && k > 0.33) c = mix(c, [1, 0.97, 0.94], Math.min(1, (k - 0.33) * 6));
      if (yy > ridge(x, 260, 150, 290)) c = mix([0.42, 0.46, 0.6], [0.5, 0.56, 0.66], nz(x / 18, yy / 18));
      if (yy > ridge(x + 900, 150, 90, 300)) c = mix([0.18, 0.31, 0.24], [0.26, 0.42, 0.28], nz(x / 7, yy / 7));
      if (refl) {
        c = mix(c, [0.12, 0.22, 0.34], 0.38);
        c = mix(c, [0.8, 0.86, 0.9], Math.max(0, nz(x / 40, y * 1.1) - 0.72) * 2.4);
      }
      if (x >= 470 && y > hz - 8)
        c = mix([0.2, 0.38, 0.13], [0.42, 0.56, 0.2], gr(x / 3, y / 3) * 0.6 + gr(x / 9, y / 9) * 0.4);
      /* 家: 赤い屋根と黄色い壁。板張りの細い線と窓の格子 */
      if (x > 545 && x < 715) {
        const roof = 214 + Math.abs(x - 630) * 0.52;
        if (y > roof && y < 268) c = Math.floor(y / 4) % 2 ? [0.68, 0.13, 0.1] : [0.58, 0.1, 0.08];
        if (y >= 268 && y < 360) {
          c = Math.floor(y / 3) % 2 ? [0.94, 0.8, 0.44] : [0.84, 0.7, 0.36];
          if (x > 590 && x < 636 && y > 286 && y < 330) {
            c = [0.2, 0.3, 0.42];
            if (Math.abs(x - 613) < 1 || Math.abs(y - 308) < 1) c = [0.95, 0.95, 0.92];
          }
          if (x > 654 && x < 690 && y > 298) c = [0.32, 0.19, 0.12];
        }
      }
      /* 柵: 奥へ行くほど杭が詰まる */
      const top = 346 - (x - 470) * 0.02,
        bot = 410 - (767 - x) * 0.09;
      if (x >= 470 && y > top && y < bot) {
        const ph = (767 - x) / 15 + ((767 - x) * (767 - x)) / 1800;
        if (ph - Math.floor(ph) < 0.5) c = [0.96, 0.96, 0.93];
      }
      /* 電線: 1 画素の線 2 本 */
      const w1 = 90 + (x - 384) * (x - 384) * 0.00024 + x * 0.09;
      if (Math.min(Math.abs(y - w1), Math.abs(y - w1 - 11)) < 0.55) c = [0.08, 0.09, 0.1];
      return c;
    },
    2,
  );
}

/** 文字: 大きさを変えた日本語と英数字、罫線、斜線、丸 */
export function genText(): Img {
  const cv = document.createElement('canvas');
  cv.width = 768;
  cv.height = 512;
  const c = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  c.fillStyle = '#fff';
  c.fillRect(0, 0, 768, 512);
  c.fillStyle = '#111';
  c.textBaseline = 'top';
  const F = 'system-ui,"Segoe UI","Hiragino Sans","Noto Sans JP","Yu Gothic UI",Meiryo,sans-serif';
  let y = 14;
  for (const [sz, t] of [
    [52, '画像の拡大縮小'],
    [32, '小さな文字はどこまで読めるか'],
    [22, '縮小すると線が消え、拡大するとぼける'],
    [16, 'The quick brown fox jumps over the lazy dog. 0123456789'],
    [14, '最近傍・バイリニア・バイキュービック・Lanczos を比べます'],
    [12, '細い線が多い漢字ほど差が出ます。鬱・麟・鑑・襲・議・識・驚'],
    [10, 'The five boxing wizards jump quickly. ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
  ] as const) {
    c.font = `${sz}px ${F}`;
    c.fillText(t, 18, y);
    y += sz * 1.42;
  }
  c.strokeStyle = '#111';
  c.lineWidth = 1;
  c.beginPath();
  for (let i = 0; i < 6; i++) {
    c.moveTo(18, 338.5 + i * 22);
    c.lineTo(462, 338.5 + i * 22);
  }
  for (let i = 0; i < 5; i++) {
    c.moveTo(18.5 + i * 111, 338);
    c.lineTo(18.5 + i * 111, 449);
  }
  c.stroke();
  c.font = `13px ${F}`;
  const rows = [
    ['手法', '画素', '弱点', '速さ'],
    ['最近傍', '1', 'ジャギー', '速い'],
    ['バイリニア', '4', 'ぼけ', '速い'],
    ['Catmull-Rom', '16', 'リンギング', '中'],
    ['Lanczos3', '36', 'リンギング', '遅い'],
  ];
  rows.forEach((r, j) => {
    r.forEach((t, i) => {
      c.fillText(t, 26 + i * 111, 342 + j * 22);
    });
  });
  c.lineWidth = 1.2;
  c.beginPath();
  for (let i = 0; i < 12; i++) {
    c.moveTo(490 + i * 8, 340);
    c.lineTo(530 + i * 18, 450);
  }
  c.stroke();
  for (let i = 0; i < 5; i++) {
    c.beginPath();
    c.arc(620, 395, 8 + i * 9, 0, 6.283);
    c.stroke();
  }
  return mkImg(768, 512, c.getImageData(0, 0, 768, 512).data);
}

/** ドット絵: 64 × 48 の自作の絵 */
export function genPixel(): Img {
  const P: Record<string, Col> = {
    '.': [0x5c, 0x94, 0xfc],
    w: [0xf8, 0xf8, 0xf8],
    g: [0x30, 0xa0, 0x30],
    G: [0x20, 0x70, 0x28],
    b: [0x88, 0x50, 0x20],
    k: [0x18, 0x18, 0x20],
    r: [0xd8, 0x30, 0x28],
    y: [0xf8, 0xc8, 0x30],
    s: [0xf8, 0xc8, 0x98],
    u: [0x20, 0x50, 0xc8],
    o: [0xd0, 0x70, 0x20],
    n: [0x90, 0x98, 0xa8],
  };
  const W = 64,
    H = 48,
    a = Array.from({ length: H }, () => Array<string>(W).fill('.')),
    rect = (x: number, y: number, w: number, h: number, c: string): void => {
      for (let j = y; j < y + h; j++)
        for (let i = x; i < x + w; i++) if (j >= 0 && j < H && i >= 0 && i < W) a[j][i] = c;
    },
    spr = (x: number, y: number, rows: readonly string[]): void => {
      rows.forEach((r, j) => {
        [...r].forEach((c, i) => {
          if (c !== ' ') rect(x + i, y + j, 1, 1, c);
        });
      });
    };
  /* 地面 */
  rect(0, 38, W, 10, 'b');
  rect(0, 38, W, 2, 'g');
  for (let i = 0; i < W; i += 4) rect(i, 40, 2, 1, 'G');
  for (let i = 2; i < W; i += 7) rect(i, 43, 1, 1, 'k');
  /* 雲 */
  spr(6, 5, ['   wwww    ', '  wwwwwww  ', ' wwwwwwwwww', 'wwwwwwwwwww', ' wwwwwwwww ']);
  spr(44, 9, ['  www   ', ' wwwwww ', 'wwwwwwww', ' wwwwww ']);
  /* 山 */
  for (let j = 0; j < 12; j++) rect(40 - j, 26 + j, 2 * j + 2, 1, j % 3 === 0 ? 'G' : 'g');
  /* 家 */
  for (let j = 0; j < 7; j++) rect(14 - j, 20 + j, 2 * j + 2, 1, 'r');
  rect(9, 27, 11, 11, 'y');
  rect(12, 31, 3, 7, 'b');
  rect(16, 29, 3, 3, 'u');
  /* 人物 */
  spr(28, 26, [' rrrr ', 'rrrrrr', ' ssks ', ' ssss ', ' uuuu ', 'suuuus', ' uuuu ', ' k  k ', 'kk  kk']);
  /* コイン */
  for (const x of [30, 38, 46]) spr(x, 16, [' yy ', 'yooy', 'yooy', 'yooy', ' yy ']);
  /* 斜めの坂 */
  for (let j = 0; j < 10; j++) rect(52 + j, 37 - j, 12 - j, 1, 'n');
  const d: Px = new Uint8ClampedArray(W * H * 4);
  a.forEach((r, y) => {
    r.forEach((c, x) => {
      const col = P[c];
      d.set([col[0], col[1], col[2], 255], (y * W + x) * 4);
    });
  });
  return mkImg(W, H, d);
}

/** 試験図: ゾーンプレート・ジーメンススター・細い縞・色の違う斜めの縁 */
export function genChart(): Img {
  const EDGE: readonly Col[] = [
    [0.86, 0.13, 0.1],
    [0.12, 0.3, 0.86],
    [0.96, 0.8, 0.14],
    [0.08, 0.58, 0.26],
  ];
  return paint(
    768,
    512,
    (x, y) => {
      const left = x < 384,
        top = y < 256,
        u = left ? x : x - 384,
        v = top ? y : y - 256,
        a = u - 192,
        b = v - 128;
      if (top && left) {
        const g = 0.5 + 0.48 * Math.cos((Math.PI * (a * a + b * b)) / 256);
        return [g, g, g];
      }
      if (top) {
        if (Math.hypot(a, b) > 122) return [0.86, 0.86, 0.86];
        const g = Math.sin(24 * Math.atan2(b, a)) > 0 ? 0.06 : 0.94;
        return [g, g, g];
      }
      if (left) {
        const g = Math.floor(u / (1 + Math.floor(v / 64))) % 2 ? 0.94 : 0.06;
        return [g, g, g];
      }
      return EDGE[Math.floor((u + v * 0.6) / 48) % 4];
    },
    3,
  );
}

/** 市松: 遠近のある床と窓の並ぶ建物 */
export function genFloor(): Img {
  return paint(
    768,
    512,
    (x, y) => {
      if (y < 200) {
        const u = Math.floor(x / 9),
          v = Math.floor(y / 11);
        if (x % 9 > 2 && y % 11 > 3) return (u * 7 + v * 13) % 5 === 0 ? [0.96, 0.84, 0.46] : [0.17, 0.25, 0.36];
        return [0.76, 0.75, 0.72];
      }
      const z = 316 / (y - 196),
        k = (Math.floor(((x - 384) / 384) * z * 3) + Math.floor(z * 3)) & 1;
      return k ? [0.93, 0.92, 0.88] : [0.1, 0.11, 0.14];
    },
    4,
  );
}

/** 見本の画像の一覧。月面は client.ts が読み込む */
export const SAMPLES = [
  { id: 'scene', n: '風景' },
  { id: 'moon', n: '月面' },
  { id: 'text', n: '文字' },
  { id: 'pixel', n: 'ドット絵' },
  { id: 'chart', n: '試験図' },
  { id: 'floor', n: '市松' },
] as const;
