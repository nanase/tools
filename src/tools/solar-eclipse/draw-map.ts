/**
 * 地図を描く: 地表の明るさ（昼夜と、周辺減光を入れた残光 F）で塗った地図に、
 * 本影の帯・中心線・観測地を重ねる
 *
 * 地図の明るさは太陽の光の量そのもので、テーマに依らない
 */
import { observerXYZ } from '../../lib/astro/earth';
import { D2R, type Projection, unwrap } from './geo';
import { isLand, type LandMask, type Rings, ringsPath } from './land';
import { type FluxLUT, fluxAt } from './shade';

export type RGB = [number, number, number];

export interface MapStyle {
  ocean: RGB;
  land: RGB;
  /** 夜の側の明るさ（昼を 1 として） */
  night: number;
  coast: string;
  grat: string;
  ink: string;
  halo: string;
  band: string;
}

export const MAP_STYLE: MapStyle = {
  ocean: [150, 176, 190],
  land: [222, 220, 200],
  night: 0.16,
  coast: 'rgba(40,52,58,0.45)',
  grat: 'rgba(30,40,46,0.13)',
  ink: '#101418',
  halo: 'rgba(255,255,255,0.85)',
  band: 'rgba(16,20,24,0.32)',
};

/** 太陽の高さ（sin）から昼の明るさ（薄明の −6° から +3° で 0→1） */
export const daylight = (s: number) => {
  const a = (s + 0.105) / 0.157;
  if (a <= 0) return 0;
  if (a >= 1) return 1;
  return a * a * (3 - 2 * a);
};

export interface LatLon {
  lat: number;
  lon: number;
}

export interface MapScene {
  proj: Projection;
  rings: Rings;
  /** 陸地の網（正距円筒でない投影で、画素ごとに陸地かを引く） */
  mask?: LandMask;
  /** 地表を塗る時刻の早見表。なければ昼の地図 */
  lut?: FluxLUT | null;
  central?: LatLon[][];
  /** 本影（金環）の北限と南限 */
  limits?: [LatLon[][], LatLon[][]];
  observer?: LatLon & { label?: string };
  /** 経緯線の間隔 [°]。0 なら引かない */
  grat?: number;
  style?: MapStyle;
  /** 地図の外（地球儀の外）の色。null なら透明 */
  space?: RGB | null;
  /**
   * 描き直しの間で使い回すもの（同じ投影・同じ陸地の間）: 陸地を塗った下地と海岸線。
   * 時刻だけを変えて何度も描く地図で渡す
   */
  cache?: MapCache;
}

export interface MapCache {
  key?: string;
  base?: ImageData;
  coast?: Path2D;
}

export function drawMap(ctx: CanvasRenderingContext2D, sc: MapScene) {
  const st = sc.style ?? MAP_STYLE;
  const { proj } = sc;
  const { w, h } = proj;
  // 正距円筒は陸地をベクトルで塗る（拡大しても海岸線が粗くならない）。ほかは陸地の網を画素ごとに引く
  let img: ImageData;
  const vec = !!proj.raw || !sc.mask;
  const cache = sc.cache ?? {};
  const key = `${w}x${h}:${proj.inv(0, 0)}:${proj.inv(w, h)}:${sc.rings.length}`;
  if (cache.key !== key) {
    cache.key = key;
    cache.coast = ringsPath(proj, sc.rings);
    cache.base = undefined;
  }
  const coast = cache.coast as Path2D;
  if (vec) {
    if (!cache.base) {
      ctx.save();
      ctx.fillStyle = `rgb(${st.ocean.join(',')})`;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = `rgb(${st.land.join(',')})`;
      ctx.fill(coast);
      ctx.restore();
      cache.base = ctx.getImageData(0, 0, w, h);
    }
    img = new ImageData(new Uint8ClampedArray(cache.base.data), w, h);
  } else img = ctx.createImageData(w, h);
  const px = img.data;
  const lut = sc.lut ?? null;
  // 地表の明るさは滑らかなので、正距円筒では 4 px おきの格子で計算して間を補う
  const shade = (lat: number, lon: number) => {
    const s = fluxAt(lut as FluxLUT, observerXYZ(lat, lon, 0));
    return st.night + (1 - st.night) * Math.sqrt(daylight(s.zeta) * s.flux);
  };
  const G = 4;
  let gw = 0;
  let grid: Float32Array | null = null;
  if (lut && proj.raw) {
    gw = Math.ceil(w / G) + 1;
    const gh = Math.ceil(h / G) + 1;
    grid = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++)
      for (let i = 0; i < gw; i++) {
        const ll = proj.inv(i * G, j * G);
        grid[j * gw + i] = ll ? shade(ll[0], ll[1]) : 1;
      }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const ll = proj.inv(x + 0.5, y + 0.5);
      if (!ll) {
        if (sc.space) {
          px[o] = sc.space[0];
          px[o + 1] = sc.space[1];
          px[o + 2] = sc.space[2];
          px[o + 3] = 255;
        } else px[o + 3] = 0;
        continue;
      }
      let r = px[o];
      let g = px[o + 1];
      let b = px[o + 2];
      if (!vec) [r, g, b] = isLand(sc.mask as LandMask, ll[0], ll[1]) ? st.land : st.ocean;
      let k = 1;
      if (grid) {
        const fx = (x + 0.5) / G;
        const fy = (y + 0.5) / G;
        const i = Math.min(gw - 2, Math.floor(fx));
        const j = Math.floor(fy);
        const a = fx - i;
        const c = fy - j;
        const q = j * gw + i;
        k = (grid[q] * (1 - a) + grid[q + 1] * a) * (1 - c) + (grid[q + gw] * (1 - a) + grid[q + gw + 1] * a) * c;
      } else if (lut) k = shade(ll[0], ll[1]);
      px[o] = r * k;
      px[o + 1] = g * k;
      px[o + 2] = b * k;
      px[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  ctx.save();
  if (sc.grat) drawGraticule(ctx, proj, st, sc.grat);
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = st.coast;
  ctx.stroke(coast);
  if (sc.limits) drawBand(ctx, proj, sc.limits, st);
  if (sc.central) for (const seg of sc.central) strokeLine(ctx, proj, seg, st.ink, 1.6, st.halo);
  if (sc.observer) drawObserver(ctx, proj, sc.observer, st);
  ctx.restore();
}

function drawGraticule(ctx: CanvasRenderingContext2D, proj: Projection, st: MapStyle, step: number) {
  for (let lat = -90 + step; lat < 90; lat += step) {
    const pts: LatLon[] = [];
    for (let lon = -180; lon <= 180; lon += 2) pts.push({ lat: lat * D2R, lon: lon * D2R });
    strokeLine(ctx, proj, pts, st.grat, 1);
  }
  for (let lon = -180; lon < 180; lon += step) {
    const pts: LatLon[] = [];
    for (let lat = -90; lat <= 90; lat += 2) pts.push({ lat: lat * D2R, lon: lon * D2R });
    strokeLine(ctx, proj, pts, st.grat, 1);
  }
}

/** 点列を投影して線を引く。経度で続く地図は ±360° ずらした分も引く */
export function strokeLine(
  ctx: CanvasRenderingContext2D,
  proj: Projection,
  pts: LatLon[],
  color: string,
  width: number,
  halo?: string,
) {
  const path = linePath(proj, pts);
  ctx.lineJoin = 'round';
  if (halo) {
    ctx.strokeStyle = halo;
    ctx.lineWidth = width + 2.4;
    ctx.stroke(path);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke(path);
}

/** 点列の Path2D。地図の縁で切れる所（Equal Earth の端・地球儀の裏）はつながない */
export function linePath(proj: Projection, pts: LatLon[], close = false): Path2D {
  const path = new Path2D();
  const raw = proj.raw;
  if (raw) {
    const lons = unwrap(pts.map((p) => p.lon));
    for (const sh of [-2 * Math.PI, 0, 2 * Math.PI]) {
      pts.forEach((p, k) => {
        const q = raw(p.lat, lons[k] + sh);
        if (k === 0) path.moveTo(q[0], q[1]);
        else path.lineTo(q[0], q[1]);
      });
      if (close) path.closePath();
    }
    return path;
  }
  let prev: [number, number] | null = null;
  for (const p of pts) {
    const q = proj.fwd(p.lat, p.lon);
    if (q && prev && Math.hypot(q[0] - prev[0], q[1] - prev[1]) < proj.w / 4) path.lineTo(q[0], q[1]);
    else if (q) path.moveTo(q[0], q[1]);
    prev = q;
  }
  if (close) path.closePath();
  return path;
}

/** 本影（金環）の帯: 北限と南限の間を塗り、限界の線を引く */
function drawBand(ctx: CanvasRenderingContext2D, proj: Projection, limits: [LatLon[][], LatLon[][]], st: MapStyle) {
  const [north, south] = limits;
  for (let k = 0; k < Math.min(north.length, south.length); k++) {
    ctx.fillStyle = st.band;
    ctx.fill(linePath(proj, [...north[k], ...[...south[k]].reverse()], true));
  }
  for (const side of limits) for (const seg of side) strokeLine(ctx, proj, seg, st.ink, 0.9);
}

function drawObserver(ctx: CanvasRenderingContext2D, proj: Projection, o: LatLon & { label?: string }, st: MapStyle) {
  const q = proj.fwd(o.lat, o.lon);
  if (!q) return;
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = st.halo;
  ctx.beginPath();
  ctx.arc(q[0], q[1], 6, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = st.ink;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(q[0], q[1], 1.6, 0, 2 * Math.PI);
  ctx.fillStyle = st.ink;
  ctx.fill();
  if (o.label) {
    ctx.font = '600 13px system-ui, "Segoe UI", "Yu Gothic UI", sans-serif';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = st.halo;
    ctx.strokeText(o.label, q[0] + 10, q[1] - 8);
    ctx.fillStyle = st.ink;
    ctx.fillText(o.label, q[0] + 10, q[1] - 8);
  }
}
