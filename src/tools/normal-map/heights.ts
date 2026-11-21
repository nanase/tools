/**
 * 模様の高さ（R × R、0〜1）と、そこから作る法線マップ（RGBA8）。
 * 行 j は奥行き z、列 i は横 x（どちらも −1〜1）。行 0 が奥（画像の上）
 */

/** 高さの画像の 1 辺の画素数 */
export const HR = 512;
/** 凹凸の高さが 1 倍のときの山の高さ（板の幅が 2） */
export const RELIEF = 0.08;

export const PATS = [
  ['brick', 'レンガ'],
  ['hex', '六角タイル'],
  ['cobble', '石畳'],
  ['scale', 'うろこ'],
  ['wood', '木目'],
  ['weave', '織物'],
  ['corrugated', '波板'],
  ['checker', '縞鋼板'],
  ['knurl', 'ローレット'],
  ['rivet', '鋲'],
  ['dimple', 'くぼみ'],
  ['pcb', '回路基板'],
  ['maze', '迷路'],
  ['rock', '岩肌'],
  ['crater', 'クレーター'],
  ['ripple', '波紋'],
  ['text', '文字'],
  ['image', '画像'],
] as const;
export type PatId = (typeof PATS)[number][0];
/** 式で作る模様（文字と画像は画面のスクリプトで作る） */
export type Computed = Exclude<PatId, 'text' | 'image'>;

type F = (x: number, z: number) => number;

const ss = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const fr = (x: number): number => x - Math.floor(x);
/** 2 次元の長さ（Math.hypot は遅い） */
const len = (a: number, b: number): number => Math.sqrt(a * a + b * b);
/** 整数の格子点ごとに決まる 0〜1 の擬似乱数 */
const hash2 = (i: number, j: number): number => fr(Math.sin(i * 127.1 + j * 311.7) * 43758.5453);
/** 線形合同法の乱数（同じ種なら同じ並び） */
function rnd(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
/** 値のノイズ（格子点の乱数を滑らかにつなぐ。0〜1） */
function noise(x: number, z: number): number {
  const ix = Math.floor(x),
    iz = Math.floor(z),
    u = x - ix,
    v = z - iz,
    a = hash2(ix, iz),
    b = hash2(ix + 1, iz),
    c = hash2(ix, iz + 1),
    d = hash2(ix + 1, iz + 1),
    su = u * u * (3 - 2 * u),
    sv = v * v * (3 - 2 * v);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}
/** 細かさの違うノイズを重ねる（0〜1 付近） */
export function fbm(x: number, z: number, oct: number): number {
  let s = 0,
    a = 0.5,
    f = 1,
    n = 0;
  for (let o = 0; o < oct; o++) {
    s += a * noise(x * f + o * 17.3, z * f - o * 9.1);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}
/** 点 (x, z) から線分 a–b までの距離 */
function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax,
    dz = bz - az,
    t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
  return len(x - ax - dx * t, z - az - dz * t);
}

const brick: F = (x, z) => {
  const qy = ((z + 1) / 2) * 6;
  let qx = ((x + 1) / 2) * 3;
  if (Math.floor(qy) % 2) qx += 0.5;
  const fx = fr(qx),
    fy = fr(qy);
  return ss(0.016, 0.05, Math.min(Math.min(fx, 1 - fx) * (2 / 3), Math.min(fy, 1 - fy) * (1 / 3)));
};

/** 平らな辺を上に向けた六角形を敷き詰め、目地を溝にする */
const hex: F = (x, z) => {
  const s = 0.2,
    w = Math.sqrt(3) * s;
  let best = 1e9,
    bx = 0,
    bz = 0;
  const r0 = Math.round(z / (1.5 * s));
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    const off = r % 2 ? w / 2 : 0,
      c0 = Math.round((x - off) / w);
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      const cx = c * w + off,
        cz = r * 1.5 * s,
        d = (x - cx) ** 2 + (z - cz) ** 2;
      if (d < best) {
        best = d;
        bx = x - cx;
        bz = z - cz;
      }
    }
  }
  let m = 0;
  for (let a = 0; a < 3; a++) {
    const t = (Math.PI / 3) * a;
    m = Math.max(m, Math.abs(bx * Math.cos(t) + bz * Math.sin(t)));
  }
  return ss(0.012, 0.045, w / 2 - m);
};

/** ボロノイの区画を石にし、境を溝にする。石ごとに少し高さを変え、縁を丸める */
const cobble: F = (x, z) => {
  const c = 2 / 7,
    gx = (x + 1) / c,
    gz = (z + 1) / c,
    ix = Math.floor(gx),
    iz = Math.floor(gz);
  let f1 = 9,
    f2 = 9,
    id = 0;
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++) {
      const cx = ix + a + 0.15 + 0.7 * hash2(ix + a, iz + b),
        cz = iz + b + 0.15 + 0.7 * hash2(iz + b + 17, ix + a + 3),
        d = len(gx - cx, gz - cz);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash2(ix + a + 5, iz + b + 9);
      } else if (d < f2) f2 = d;
    }
  const e = ((f2 - f1) / 2) * c;
  return ss(0.006, 0.05, e) * (0.75 + 0.25 * id) * (1 - 0.25 * Math.min(1, f1 * f1)) + 0.02 * fbm(x * 18, z * 18, 3);
};

/** 屋根瓦のように重なるうろこ。手前（z の大きい）の列が奥の列に重なる */
const scale: F = (x, z) => {
  const R = 0.2,
    dz = 0.15,
    w = 0.3;
  const r0 = Math.floor(z / dz);
  for (let r = r0 + 2; r >= r0 - 2; r--) {
    const off = r % 2 ? w / 2 : 0,
      c = Math.round((x - off) / w),
      cx = c * w + off,
      cz = r * dz,
      d = len(x - cx, z - cz);
    /* うろこは中心から下（手前）側の円。縁ほど低い */
    if (d < R && z >= cz - R * 0.2) {
      const t = d / R;
      return 0.25 + 0.75 * Math.sqrt(Math.max(0, 1 - t * t)) * (0.6 + 0.4 * ss(-R, R, z - cz));
    }
  }
  return 0;
};

/** 板 4 枚の床。継ぎ目を溝にし、板の中に木目の筋を刻む */
const wood: F = (x, z) => {
  const n = 4,
    v = ((z + 1) / 2) * n,
    k = Math.floor(v),
    lz = fr(v),
    /* 板ごとに継ぎ目の位置をずらす */
    j = fr((x + 1) * 0.5 + hash2(k, 3) * 0.7),
    gap = ss(0, 0.03, Math.min(lz, 1 - lz)) * ss(0, 0.012, Math.min(j, 1 - j)),
    g = Math.sin(lz * 22 + 6 * fbm(x * 1.6 + k * 5, lz * 2.5 + k, 4) + x * 1.5),
    grain = 0.82 + 0.1 * Math.abs(g) ** 0.6;
  return gap * grain;
};

/** 平織り。経糸と緯糸が交互に上下する */
const weave: F = (x, z) => {
  const n = 8,
    prof = (f: number) => Math.max(0, Math.sin(Math.PI * f)) ** 0.35,
    u = ((x + 1) / 2) * n,
    v = ((z + 1) / 2) * n,
    ix = Math.floor(u),
    iz = Math.floor(v),
    warp = prof(fr(u)) * (0.35 + 0.65 * (0.5 + 0.5 * Math.cos(Math.PI * (v - 0.5) + Math.PI * ix))),
    weft = prof(fr(v)) * (0.35 + 0.65 * (0.5 + 0.5 * Math.cos(Math.PI * (u - 0.5) + Math.PI * iz + Math.PI)));
  return Math.max(warp, weft);
};

/** 波板。山を縦に並べる */
const corrugated: F = (x) => (0.5 + 0.5 * Math.cos(x * Math.PI * 6.5)) ** 0.8;

/** 縞鋼板。細長い粒を向きを交互に変えて並べる */
const checker: F = (x, z) => {
  const c = 0.25,
    ix = Math.floor((x + 1) / c),
    iz = Math.floor((z + 1) / c),
    lx = x + 1 - (ix + 0.5) * c,
    lz = z + 1 - (iz + 0.5) * c,
    t = (ix + iz) % 2 ? Math.PI / 4 : -Math.PI / 4,
    u = lx * Math.cos(t) + lz * Math.sin(t),
    v = -lx * Math.sin(t) + lz * Math.cos(t),
    r2 = (u / 0.095) ** 2 + (v / 0.024) ** 2;
  return r2 < 1 ? Math.sqrt(1 - r2) : 0;
};

/** ローレット（綾目）。斜めの溝が交わって四角錐が並ぶ */
const knurl: F = (x, z) => {
  const k = 5,
    tri = (q: number) => 1 - 2 * Math.abs(fr(q) - 0.5);
  return Math.min(tri((x + z) * k), tri((x - z) * k)) ** 0.8;
};

const rivet: F = (x, z) => {
  const fx = fr((x + 1) * 2.5) - 0.5,
    fz = fr((z + 1) * 2.5) - 0.5,
    r = len(fx, fz) * 0.4,
    s = 1 - (r * r) / (0.14 * 0.14);
  return s > 0 ? s ** 0.7 : 0;
};

/** ゴルフボールのようなくぼみ。六方に並べる */
const dimple: F = (x, z) => {
  const s = 0.17,
    w = Math.sqrt(3) * s;
  let best = 1e9;
  const r0 = Math.round(z / (1.5 * s));
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    const off = r % 2 ? w / 2 : 0,
      c0 = Math.round((x - off) / w);
    for (let c = c0 - 1; c <= c0 + 1; c++) best = Math.min(best, len(x - c * w - off, z - r * 1.5 * s));
  }
  const t = best / (s * 0.82);
  return t < 1 ? 1 - 0.85 * Math.sqrt(1 - t * t) : 1;
};

/** 回路基板: 中央の IC から配線が 45° に折れて四方のランドへ延びる */
interface Pcb {
  /** 線分の両端を 4 つずつ */
  segs: Float64Array;
  /** ランドの中心を 2 つずつ */
  pads: Float64Array;
}
let pcb0: Pcb | null = null;
function pcbLayout(): Pcb {
  if (pcb0) return pcb0;
  const segs: [number, number, number, number][] = [],
    pads: [number, number][] = [],
    R = rnd(5);
  /* IC の足（左右に 6 本ずつ） */
  for (let i = 0; i < 6; i++) {
    const z = -0.3 + i * 0.12;
    for (const sx of [-1, 1]) {
      const x0 = sx * 0.3,
        x1 = sx * (0.5 + 0.08 * (i % 3)),
        tz = z + (i < 3 ? -1 : 1) * (0.15 + 0.25 * R()),
        x2 = x1 + sx * Math.abs(tz - z),
        x3 = sx * (0.72 + 0.15 * R());
      segs.push([x0, z, x1, z], [x1, z, x2, tz], [x2, tz, x3, tz]);
      pads.push([x3, tz]);
    }
  }
  /* 上下へ延びる配線 */
  for (let i = 0; i < 5; i++) {
    const x = -0.56 + i * 0.28;
    for (const sz of [-1, 1]) {
      const z1 = sz * (0.5 + 0.1 * R()),
        x2 = x + (R() - 0.5) * 0.3,
        z2 = z1 + sz * Math.abs(x2 - x),
        z3 = sz * 0.86;
      segs.push([x, sz * 0.38, x, z1], [x, z1, x2, z2], [x2, z2, x2, z3]);
      pads.push([x2, z3], [x, sz * 0.38]);
    }
  }
  pcb0 = { segs: Float64Array.from(segs.flat()), pads: Float64Array.from(pads.flat()) };
  return pcb0;
}
const pcb: F = (x, z) => {
  const L = pcbLayout();
  let h = 0;
  /* IC の本体 */
  const bx = Math.abs(x) - 0.26,
    bz = Math.abs(z) - 0.36;
  const ic = Math.max(bx, bz);
  if (ic < 0) h = 0.6 + 0.4 * ss(0, 0.04, -ic) - (len(x + 0.18, z + 0.28) < 0.035 ? 0.08 : 0);
  let d = 9;
  const S = L.segs;
  for (let k = 0; k < S.length; k += 4) {
    const ax = S[k],
      az = S[k + 1],
      cx = S[k + 2],
      cz = S[k + 3];
    /* 線分を囲む四角から離れていれば測らない */
    if (
      x < Math.min(ax, cx) - 0.03 ||
      x > Math.max(ax, cx) + 0.03 ||
      z < Math.min(az, cz) - 0.03 ||
      z > Math.max(az, cz) + 0.03
    )
      continue;
    d = Math.min(d, segDist(x, z, ax, az, cx, cz));
  }
  h = Math.max(h, 0.45 * ss(0.026, 0.014, d));
  const Q = L.pads;
  for (let k = 0; k < Q.length; k += 2) {
    const px = Q[k],
      pz = Q[k + 1];
    if (Math.abs(x - px) > 0.06 || Math.abs(z - pz) > 0.06) continue;
    const r = len(x - px, z - pz);
    h = Math.max(h, r < 0.022 ? 0.05 : 0.5 * ss(0.06, 0.045, r));
  }
  return h;
};

/** 迷路: 9 × 9 のマスを深さ優先で掘り、残った壁を高くする */
const MZ = 9;
let maze0: Uint8Array | null = null;
/** マスごとの壁（1: 右、2: 下） */
function mazeWalls(): Uint8Array {
  if (maze0) return maze0;
  const w = new Uint8Array(MZ * MZ).fill(3),
    seen = new Uint8Array(MZ * MZ),
    R = rnd(7),
    st = [0];
  seen[0] = 1;
  while (st.length) {
    const c = st[st.length - 1],
      cx = c % MZ,
      cy = Math.floor(c / MZ),
      nb: [number, number][] = [];
    if (cx > 0 && !seen[c - 1]) nb.push([c - 1, 0]);
    if (cx < MZ - 1 && !seen[c + 1]) nb.push([c + 1, 1]);
    if (cy > 0 && !seen[c - MZ]) nb.push([c - MZ, 2]);
    if (cy < MZ - 1 && !seen[c + MZ]) nb.push([c + MZ, 3]);
    if (!nb.length) {
      st.pop();
      continue;
    }
    const [n, dir] = nb[Math.floor(R() * nb.length)];
    if (dir === 0) w[n] &= ~1;
    else if (dir === 1) w[c] &= ~1;
    else if (dir === 2) w[n] &= ~2;
    else w[c] &= ~2;
    seen[n] = 1;
    st.push(n);
  }
  maze0 = w;
  return w;
}
const maze: F = (x, z) => {
  const W = mazeWalls(),
    m = 0.92,
    c = (2 * m) / MZ,
    gx = (x + m) / c,
    gz = (z + m) / c;
  if (gx < -0.2 || gz < -0.2 || gx > MZ + 0.2 || gz > MZ + 0.2) return 0;
  const ix = Math.min(MZ - 1, Math.max(0, Math.floor(gx))),
    iz = Math.min(MZ - 1, Math.max(0, Math.floor(gz)));
  let d = 9;
  /* 近くのマスの右と下の壁、外周 */
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++) {
      const cx = ix + a,
        cz = iz + b;
      if (cx < -1 || cz < -1 || cx >= MZ || cz >= MZ) continue;
      const inside = cx >= 0 && cz >= 0,
        bits = inside ? W[cz * MZ + cx] : 0;
      if (bits & 1 || (cx === -1 && cz >= 0) || (inside && cx === MZ - 1))
        d = Math.min(d, segDist(gx, gz, cx + 1, cz, cx + 1, cz + 1));
      if (bits & 2 || (cz === -1 && cx >= 0) || (inside && cz === MZ - 1))
        d = Math.min(d, segDist(gx, gz, cx, cz + 1, cx + 1, cz + 1));
    }
  /* 入口と出口を開ける */
  if ((ix === 0 && iz === 0 && gx < 0.5) || (ix === MZ - 1 && iz === MZ - 1 && gx > MZ - 0.5)) d = 9;
  return ss(0.2, 0.1, d);
};

/** 岩肌: 尾根の立ったノイズに細かい凹凸を足す */
const rock: F = (x, z) => {
  const r = 1 - Math.abs(fbm(x * 2.2 + 3, z * 2.2 - 1, 5) * 2 - 1);
  return r * r * 0.8 + 0.25 * fbm(x * 9, z * 9, 3);
};

/** クレーター: 大小のくぼみと盛り上がった縁。大きい順に重ね、新しいほど上に残す */
let craters0: [number, number, number][] | null = null;
const crater: F = (x, z) => {
  if (!craters0) {
    const R = rnd(11),
      cs: [number, number, number][] = [];
    for (let i = 0; i < 26; i++) cs.push([R() * 2.2 - 1.1, R() * 2.2 - 1.1, 0.06 + 0.32 * R() ** 2]);
    craters0 = cs.sort((a, b) => b[2] - a[2]);
  }
  let v = 0.5 + 0.12 * (fbm(x * 3, z * 3, 4) - 0.5);
  for (const [cx, cz, r] of craters0) {
    const p = len(x - cx, z - cz) / r;
    if (p > 1.6) continue;
    const bowl = p < 1 ? 0.8 * r * (p * p - 1) : 0,
      rim = 0.3 * r * Math.exp(-(((p - 1) / 0.18) ** 2));
    /* 中は掘り下げた底へ寄せる（古い地形を消す） */
    const k = ss(1.05, 0.85, p);
    v = v * (1 - k) + (0.5 + bowl) * k + rim;
  }
  return v + 0.01 * fbm(x * 30, z * 30, 2);
};

/** 1 点から広がる波紋。遠いほど低くなる */
const ripple: F = (x, z) => {
  const a = len(x + 0.35, z + 0.25);
  return Math.cos(a * 26) / (1 + a * 1.2);
};

const FN: Record<Computed, F> = {
  brick,
  hex,
  cobble,
  scale,
  wood,
  weave,
  corrugated,
  checker,
  knurl,
  rivet,
  dimple,
  pcb,
  maze,
  rock,
  crater,
  ripple,
};

/** 最小 0、最大 1 にそろえる */
export function normalize(h: Float32Array): Float32Array {
  let lo = Number.POSITIVE_INFINITY,
    hi = Number.NEGATIVE_INFINITY;
  for (const v of h) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const k = hi - lo || 1;
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - lo) / k;
  return h;
}

/** 模様の高さ。文字と画像はここでは作らない（client.ts） */
export function heightMap(id: Computed, R = HR): Float32Array {
  const f = FN[id],
    h = new Float32Array(R * R);
  for (let j = 0; j < R; j++) {
    const z = -1 + (2 * (j + 0.5)) / R;
    for (let i = 0; i < R; i++) h[j * R + i] = f(-1 + (2 * (i + 0.5)) / R, z);
  }
  return normalize(h);
}

/**
 * 高さから法線マップを作る。隣の画素との差で傾きを求め、接空間の法線を色にする。
 * R が右（+x）、G が画像の上（奥、−z）、B が板から外向き。r = (n + 1) / 2 で 0〜255 に詰める
 */
export function normalMap(h: Float32Array, R = HR, relief = RELIEF): Uint8Array {
  const out = new Uint8Array(R * R * 4),
    at = (i: number, j: number) => h[Math.min(R - 1, Math.max(0, j)) * R + Math.min(R - 1, Math.max(0, i))],
    /* 画素の間隔（板の幅 2 を R 画素に） */
    dx = 2 / R;
  for (let j = 0; j < R; j++)
    for (let i = 0; i < R; i++) {
      const sx = ((at(i + 1, j) - at(i - 1, j)) * relief) / (2 * dx),
        sz = ((at(i, j + 1) - at(i, j - 1)) * relief) / (2 * dx),
        /* 画像の上は −z なので、上向きの傾きは +sz */
        n = encodeNormal(-sx, sz),
        o = (j * R + i) * 4;
      out[o] = n[0];
      out[o + 1] = n[1];
      out[o + 2] = n[2];
      out[o + 3] = 255;
    }
  return out;
}

/** 接空間の法線 (a, b, 1) を正規化し、0〜255 の色にする */
export function encodeNormal(a: number, b: number): [number, number, number] {
  const l = Math.sqrt(a * a + b * b + 1);
  return [
    Math.round((a / l / 2 + 0.5) * 255),
    Math.round((b / l / 2 + 0.5) * 255),
    Math.round((1 / l / 2 + 0.5) * 255),
  ];
}
