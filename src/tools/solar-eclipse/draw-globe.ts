/**
 * 宇宙から見た地球を描く: 視点（月・L1・静止軌道など）から透視投影で地球を見て、
 * 画素ごとに昼夜と残光 F で地表を暗くする（本影の黒と半影のぼかしが同じ式から出る）
 *
 * 地球は球として描く（扁平は 0.3 % で、この大きさでは見えない）
 */
import { observerXYZ } from '../../lib/astro/earth';
import type { Vec3 } from '../../lib/astro/vec';
import { latLon } from './earth';
import type { Elements } from './elements';
import { isLand, type LandMask } from './land';
import { fluxAt, fluxLUT, type Snap, snapAt } from './shade';

export interface GlobeScene {
  w: number;
  h: number;
  el: Elements;
  dt: number;
  t: number;
  mask: LandMask;
  /** 地球の中心から視点への向き（地球固定、単位ベクトル）と距離（地球半径） */
  dir: Vec3;
  dist: number;
  /** 地球の像の半径を画面の短い辺の何割にするか */
  fill?: number;
  observer?: { lat: number; lon: number };
  central?: { lat: number; lon: number }[][];
}

const norm = (v: Vec3): Vec3 => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** 視点の基底: c は視点の向き、ex は画面の右（東）、ey は画面の上（北） */
export function camera(dir: Vec3) {
  const c = norm(dir);
  let ex = cross([0, 0, 1], c);
  if (Math.hypot(...ex) < 1e-6) ex = [1, 0, 0];
  ex = norm(ex);
  const ey = cross(c, ex);
  return { c, ex, ey };
}

/** 太陽・地球・月の配置から決まる視点の向き */
export function viewDir(s: Snap, kind: 'moon' | 'l1' | 'geo', geoLon = 140.7 * (Math.PI / 180)): Vec3 {
  if (kind === 'geo') return [Math.cos(geoLon), Math.sin(geoLon), 0];
  if (kind === 'l1') {
    // DSCOVR は L1 のまわりを太陽の向きから 4〜15° 離れて回る。月が地球に重ならないよう 8° ずらす
    const a = 8 * (Math.PI / 180);
    return norm([
      s.k[0] * Math.cos(a) + s.j[0] * Math.sin(a),
      s.k[1] * Math.cos(a) + s.j[1] * Math.sin(a),
      s.k[2] * Math.cos(a) + s.j[2] * Math.sin(a),
    ]);
  }
  // 月の中心は影の軸の上、基準面から z ≈ 56〜64 地球半径
  const zm = 60;
  return norm([
    s.x * s.i[0] + s.y * s.j[0] + zm * s.k[0],
    s.x * s.i[1] + s.y * s.j[1] + zm * s.k[1],
    s.x * s.i[2] + s.y * s.j[2] + zm * s.k[2],
  ]);
}

const OCEAN: Vec3 = [18, 46, 84];
const LAND: Vec3 = [128, 122, 92];
const ICE: Vec3 = [226, 230, 234];

export function drawGlobe(ctx: CanvasRenderingContext2D, sc: GlobeScene) {
  const { w, h } = sc;
  const snap = snapAt(sc.el, sc.t, sc.dt);
  const lut = fluxLUT(snap);
  const { c, ex, ey } = camera(sc.dir);
  const C: Vec3 = [c[0] * sc.dist, c[1] * sc.dist, c[2] * sc.dist];
  // 地球の縁が画面の fill の位置に来るように画角を決める
  const half = Math.asin(1 / sc.dist);
  const T = Math.tan(half) / (sc.fill ?? 0.9);
  const R = Math.min(w, h) / 2;
  const img = ctx.createImageData(w, h);
  const px = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const sx = ((x + 0.5 - w / 2) / R) * T;
      const sy = ((h / 2 - y - 0.5) / R) * T;
      const d = norm([
        -c[0] + sx * ex[0] + sy * ey[0],
        -c[1] + sx * ex[1] + sy * ey[1],
        -c[2] + sx * ex[2] + sy * ey[2],
      ]);
      // 光線と単位球の交点
      const b = dot(C, d);
      const disc = b * b - (dot(C, C) - 1);
      px[o + 3] = 255;
      if (disc < 0) {
        // 大気のふち: 球に近い光線ほど明るい青
        const miss = Math.sqrt(Math.max(0, dot(C, C) - b * b)) - 1;
        const g = Math.max(0, 1 - miss / 0.025);
        const p: Vec3 = [C[0] - b * d[0], C[1] - b * d[1], C[2] - b * d[2]];
        const lit = Math.max(0, dot(norm(p), snap.k) + 0.2);
        px[o] = 60 * g * g * lit;
        px[o + 1] = 110 * g * g * lit;
        px[o + 2] = 200 * g * g * lit;
        continue;
      }
      const tt = -b - Math.sqrt(disc);
      const P: Vec3 = [C[0] + tt * d[0], C[1] + tt * d[1], C[2] + tt * d[2]];
      const [lat, lon] = latLon(P);
      const land = isLand(sc.mask, lat, lon);
      const polar = Math.abs(lat) > 1.15 && land;
      const base = polar ? ICE : land ? LAND : OCEAN;
      const cosi = dot(P, snap.k);
      // 球の点をそのまま地表の点として使う（扁平の分は見た目に効かない）
      const s = fluxAt(lut, P);
      const day = Math.max(0, Math.min(1, (cosi + 0.03) / 0.08));
      const light = Math.max(0, cosi) * 0.85 + 0.15;
      const v = (day * light * s.flux) ** (1 / 2.2);
      // 縁ほど大気で青く霞む
      const mu = -dot(P, d);
      const haze = (1 - mu) ** 3 * 0.6 * day;
      px[o] = base[0] * v * (1 - haze) + 70 * haze * s.flux;
      px[o + 1] = base[1] * v * (1 - haze) + 120 * haze * s.flux;
      px[o + 2] = base[2] * v * (1 - haze) + 210 * haze * s.flux;
    }
  }
  ctx.putImageData(img, 0, 0);

  const toScreen = (P: Vec3): [number, number] | null => {
    const v: Vec3 = [P[0] - C[0], P[1] - C[1], P[2] - C[2]];
    if (dot(v, P) > 0) return null;
    const z = -dot(v, c);
    return [w / 2 + ((dot(v, ex) / z) * R) / T, h / 2 - ((dot(v, ey) / z) * R) / T];
  };
  if (sc.central) {
    ctx.strokeStyle = 'rgba(255,214,120,0.9)';
    ctx.lineWidth = 1.4;
    for (const seg of sc.central) {
      ctx.beginPath();
      let on = false;
      for (const q of seg) {
        const s = toScreen(observerXYZ(q.lat, q.lon, 0));
        if (!s) {
          on = false;
          continue;
        }
        if (on) ctx.lineTo(s[0], s[1]);
        else ctx.moveTo(s[0], s[1]);
        on = true;
      }
      ctx.stroke();
    }
  }
  if (sc.observer) {
    const s = toScreen(observerXYZ(sc.observer.lat, sc.observer.lon, 0));
    if (s) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(s[0], s[1], 5, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }
}
