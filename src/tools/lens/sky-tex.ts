/**
 * 月・木星・土星の模様の地図と土星の環の表を読み込み、円盤の平均の明るさが幾何アルベドになる倍率を求める
 */
import { ALBEDO, limb, type MapId, mapUv, RING_K, TEX } from './scene';

/** 画素の並び（RGBA、sRGB の 8 ビット） */
export interface Raw {
  data: Uint8Array | Uint8ClampedArray;
  w: number;
  h: number;
}

/** シェーダに渡す地図と、月・木星・土星・環の明るさの倍率 */
export interface Sky {
  moon: TexImageSource | Raw;
  jupiter: TexImageSource | Raw;
  saturn: TexImageSource | Raw;
  ring: Raw;
  mars: TexImageSource | Raw;
  /** 月・木星・土星・環・火星 */
  k: [number, number, number, number, number];
}

const lin = (c: number): number => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};

/** 円盤の平均の輝度（線形、周縁減光を含む）。64×64 の点で地図を読む */
function meanLum(id: MapId, px: Raw): number {
  let s = 0,
    n = 0;
  for (let j = 0; j < 64; j++)
    for (let i = 0; i < 64; i++) {
      const m = mapUv(id, (i + 0.5) / 32 - 1, (j + 0.5) / 32 - 1);
      if (!m) continue;
      const u = m.u - Math.floor(m.u),
        k = Math.min(px.h - 1, Math.floor(m.v * px.h)) * px.w + Math.min(px.w - 1, Math.floor(u * px.w));
      const L = limb(id, m.mu),
        d = px.data;
      s += 0.2126 * lin(d[k * 4]) * L[0] + 0.7152 * lin(d[k * 4 + 1]) * L[1] + 0.0722 * lin(d[k * 4 + 2]) * L[2];
      n++;
    }
  return n && s > 0 ? s / n : 1;
}

const gains = (moon: Raw, jup: Raw, sat: Raw, mars: Raw): Sky['k'] => {
  const ks = ALBEDO.saturn / meanLum('saturn', sat);
  return [
    ALBEDO.moon / meanLum('moon', moon),
    ALBEDO.jupiter / meanLum('jupiter', jup),
    ks,
    ks * RING_K,
    ALBEDO.mars / meanLum('mars', mars),
  ];
};

const one = (r: number, g: number, b: number, a = 255): Raw => ({ data: new Uint8Array([r, g, b, a]), w: 1, h: 1 });

/** 読み込むまでの代わり（1 画素の平均的な色） */
export function placeholder(): Sky {
  const moon = one(150, 148, 142),
    jupiter = one(205, 185, 160),
    saturn = one(210, 190, 145),
    mars = one(200, 120, 75);
  return { moon, jupiter, saturn, mars, ring: one(190, 170, 140, 200), k: gains(moon, jupiter, saturn, mars) };
}

/** 画像を縮めて画素を読む（明るさの平均を求めるだけなので粗くてよい） */
function pixels(img: HTMLImageElement, w: number, h: number): Raw {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  if (!x) throw new Error('2d');
  x.drawImage(img, 0, 0, w, h);
  return { data: x.getImageData(0, 0, w, h).data, w, h };
}

async function image(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/** 地図と環の表を読み込む（base はサイトの BASE_URL） */
export async function loadSky(base: string): Promise<Sky> {
  const [moon, jupiter, saturn, mars, ring] = await Promise.all([
    image(base + TEX.moon),
    image(base + TEX.jupiter),
    image(base + TEX.saturn),
    image(base + TEX.mars),
    fetch(base + TEX.ring).then((r) => {
      if (!r.ok) throw new Error(`${r.status}`);
      return r.arrayBuffer();
    }),
  ]);
  const rb = new Uint8Array(ring);
  return {
    moon,
    jupiter,
    saturn,
    mars,
    ring: { data: rb, w: rb.length / 4, h: 1 },
    k: gains(
      pixels(moon, 400, 360),
      pixels(jupiter, 512, 256),
      pixels(saturn, saturn.naturalWidth, saturn.naturalHeight),
      pixels(mars, 512, 256),
    ),
  };
}
