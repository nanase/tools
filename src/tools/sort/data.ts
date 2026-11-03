/** 並べ替えるデータの生成。値は 1〜n の整数で、バーの高さになる */

export const DISTS = [
  ['random', 'ランダム'],
  ['nearly', 'ほぼ並び替え済み'],
  ['sorted', '並び替え済み'],
  ['reversed', '逆順'],
  ['center', '中央値付近に偏り'],
  ['edges', '両端に偏り'],
  ['few', '値の種類が少ない'],
  ['saw', 'のこぎり'],
  ['organ', '山形'],
] as const;

export type Dist = (typeof DISTS)[number][0];
/** 選べるデータ: DISTS と手描き */
export type DataKind = Dist | 'draw';

export const distName = (k: DataKind): string => DISTS.find((d) => d[0] === k)?.[1] ?? '手描き';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 種類 kind・n 個のデータ。同じ引数なら同じ値になる */
export function gen(kind: Dist, n: number, seed: number): number[] {
  const h = [...kind].reduce((p, c) => (p * 31 + c.charCodeAt(0)) >>> 0, 7),
    R = rng(Math.imul(seed, 2654435761) + h + n),
    gauss = () => Math.sqrt(-2 * Math.log(1 - R())) * Math.cos(2 * Math.PI * R()),
    clamp = (v: number) => Math.min(n, Math.max(1, Math.round(v))),
    shuffle = (a: number[]) => {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(R() * (i + 1)),
          t = a[i];
        a[i] = a[j];
        a[j] = t;
      }
      return a;
    },
    up = Array.from({ length: n }, (_, i) => i + 1);
  switch (kind) {
    case 'random':
      return shuffle(up);
    case 'sorted':
      return up;
    case 'reversed':
      return up.reverse();
    case 'nearly': {
      /* 約 5 % の要素を、近くの要素と入れ替える */
      const m = Math.max(1, Math.floor(n / 20)),
        w = Math.max(2, Math.floor(n / 10));
      for (let k = 0; k < m; k++) {
        const i = Math.floor(R() * n),
          j = Math.min(n - 1, i + 1 + Math.floor(R() * w)),
          t = up[i];
        up[i] = up[j];
        up[j] = t;
      }
      return up;
    }
    case 'center':
      return up.map(() => clamp(n / 2 + (gauss() * n) / 8));
    case 'edges':
      return up.map(() => {
        const d = (Math.abs(gauss()) * n) / 10;
        return clamp(R() < 0.5 ? 1 + d : n - d);
      });
    case 'few':
      return shuffle(up.map((_, i) => clamp((n * (1 + (i % 5))) / 5)));
    case 'saw': {
      const w = Math.ceil(n / 4);
      return up.map((_, i) => clamp((((i % w) + 1) / w) * n));
    }
    case 'organ':
      return up.map((_, i) => clamp(i < n / 2 ? 2 * i + 1 : 2 * (n - i)));
  }
}

/** 手描きのデータを n 個へ写す */
export function resample(a: readonly number[], n: number): number[] {
  const k = n / Math.max(1, a.length);
  return Array.from({ length: n }, (_, i) =>
    Math.min(n, Math.max(1, Math.round(a[Math.floor((i * a.length) / n)] * k))),
  );
}

/** 選択肢に添える形の絵（ビルド時に出す） */
export function shapeSvg(kind: Dist): string {
  const a = gen(kind, 16, 3),
    m = Math.max(...a),
    r = a
      .map(
        (v, i) =>
          `<rect x="${i * 2 + 0.2}" y="${(12 * (1 - v / m)).toFixed(2)}" width="1.6" height="${((12 * v) / m).toFixed(2)}"/>`,
      )
      .join('');
  return `<svg viewBox="0 0 32 12" preserveAspectRatio="none" aria-hidden="true">${r}</svg>`;
}
