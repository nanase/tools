/**
 * 地図を描く: 地表の明るさ（昼夜と、周辺減光を入れた残光 F）で塗った地図に、
 * 最大の食分の等値線・中心線・本影の帯・観測地を重ねる
 *
 * 地図の明るさは太陽の光の量そのもので、テーマに依らない
 */
import { observerXYZ } from './earth';
import type { Elements } from './elements';
import { contour, D2R, type Projection, unwrap } from './geo';
import { isLand, type LandMask, type Rings, ringsPath } from './land';
import type { PathPoint } from './path';
import { magAt, type Snap, snapAt, spotAt } from './shade';

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
  contour: string;
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
  contour: 'rgba(16,20,24,0.7)',
};

/** 太陽の高さ（sin）から昼の明るさ（薄明の −6° から +3° で 0→1） */
const daylight = (s: number) => {
  const a = (s + 0.105) / 0.157;
  if (a <= 0) return 0;
  if (a >= 1) return 1;
  return a * a * (3 - 2 * a);
};

export interface MapScene {
  proj: Projection;
  mask: LandMask;
  rings: Rings;
  el: Elements;
  dt: number;
  /** 地表を塗る時刻 [h]。null なら食のない昼の地図 */
  t: number | null;
  /** 最大の食分の格子（等値線を引く） */
  grid?: { lats: Float64Array; lons: Float64Array; mag: Float32Array; levels: number[] };
  central?: PathPoint[][];
  limits?: PathPoint[][][];
  /** 半影の南北限界と、日の出・日の入りに食が始まる・終わる曲線（食が見える範囲の外縁） */
  outer?: PathPoint[][];
  observer?: { lat: number; lon: number; label?: string };
  style?: MapStyle;
  /** 地図の外（地球儀の外）の色。null なら透明 */
  space?: RGB | null;
}

export function drawMap(ctx: CanvasRenderingContext2D, sc: MapScene) {
  const st = sc.style ?? MAP_STYLE;
  const { proj } = sc;
  const { w, h } = proj;
  // 正距円筒は陸地をベクトルで塗る（拡大しても海岸線が粗くならない）。ほかは陸地の網を画素ごとに引く
  let img: ImageData;
  if (proj.raw) {
    ctx.fillStyle = `rgb(${st.ocean.join(',')})`;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = `rgb(${st.land.join(',')})`;
    ctx.fill(ringsPath(proj, sc.rings));
    img = ctx.getImageData(0, 0, w, h);
  } else img = ctx.createImageData(w, h);
  const px = img.data;
  const snap = sc.t === null ? null : snapAt(sc.el, sc.t, sc.dt);
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
        }
        continue;
      }
      const base: RGB = proj.raw ? [px[o], px[o + 1], px[o + 2]] : isLand(sc.mask, ll[0], ll[1]) ? st.land : st.ocean;
      let b = 1;
      if (snap) {
        const s = spotAt(snap, observerXYZ(ll[0], ll[1], 0));
        const day = daylight(s.zeta);
        b = st.night + (1 - st.night) * Math.sqrt(day * s.flux);
      }
      px[o] = base[0] * b;
      px[o + 1] = base[1] * b;
      px[o + 2] = base[2] * b;
      px[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  ctx.save();
  if (!proj.wraps) {
    // 地図の外へはみ出す線を切る
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
  }
  drawGraticule(ctx, proj, st);
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = st.coast;
  ctx.stroke(ringsPath(proj, sc.rings));

  if (sc.grid) drawContours(ctx, proj, sc.grid, st);
  if (sc.outer) for (const seg of sc.outer) strokeLine(ctx, proj, seg, st.ink, 1.3);
  if (snap) drawInstant(ctx, proj, snap, st);
  if (sc.limits) drawBand(ctx, proj, sc.limits, st);
  if (sc.central) {
    for (const seg of sc.central) strokeLine(ctx, proj, seg, st.ink, 1.6, st.halo);
  }
  if (sc.observer) drawObserver(ctx, proj, sc.observer, st);
  ctx.restore();
}

function drawGraticule(ctx: CanvasRenderingContext2D, proj: Projection, st: MapStyle) {
  ctx.strokeStyle = st.grat;
  ctx.lineWidth = 1;
  for (let lat = -75; lat <= 75; lat += 15) {
    const pts: PathPoint[] = [];
    for (let lon = -180; lon <= 180; lon += 2) pts.push({ t: 0, lat: lat * D2R, lon: lon * D2R, p: [0, 0, 0] });
    strokeLine(ctx, proj, pts, st.grat, 1);
  }
  for (let lon = -180; lon < 180; lon += 15) {
    const pts: PathPoint[] = [];
    for (let lat = -90; lat <= 90; lat += 2) pts.push({ t: 0, lat: lat * D2R, lon: lon * D2R, p: [0, 0, 0] });
    strokeLine(ctx, proj, pts, st.grat, 1);
  }
}

/** 点列を投影して線を引く。経度で続く地図は ±360° ずらした分も引く */
export function strokeLine(
  ctx: CanvasRenderingContext2D,
  proj: Projection,
  pts: { lat: number; lon: number }[],
  color: string,
  width: number,
  halo?: string,
) {
  const path = linePath(proj, pts);
  if (halo) {
    ctx.strokeStyle = halo;
    ctx.lineWidth = width + 2.4;
    ctx.lineJoin = 'round';
    ctx.stroke(path);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.stroke(path);
}

function linePath(proj: Projection, pts: { lat: number; lon: number }[]): Path2D {
  const path = new Path2D();
  if (proj.raw) {
    const lons = unwrap(pts.map((p) => p.lon));
    for (const sh of [-2 * Math.PI, 0, 2 * Math.PI]) {
      pts.forEach((p, k) => {
        const q = (proj.raw as (a: number, b: number) => [number, number])(p.lat, lons[k] + sh);
        if (k === 0) path.moveTo(q[0], q[1]);
        else path.lineTo(q[0], q[1]);
      });
    }
    return path;
  }
  let prev: [number, number] | null = null;
  for (const p of pts) {
    const q = proj.fwd(p.lat, p.lon);
    // 地図の縁で切れる（Equal Earth の端・地球儀の裏）ところは線をつながない
    if (q && prev && Math.hypot(q[0] - prev[0], q[1] - prev[1]) < proj.w / 4) path.lineTo(q[0], q[1]);
    else if (q) path.moveTo(q[0], q[1]);
    prev = q;
  }
  return path;
}

function drawContours(ctx: CanvasRenderingContext2D, proj: Projection, g: NonNullable<MapScene['grid']>, st: MapStyle) {
  const nx = g.lons.length;
  const ny = g.lats.length;
  const at = (gx: number, gy: number): [number, number] => {
    const i = Math.min(nx - 2, Math.floor(gx));
    const j = Math.min(ny - 2, Math.floor(gy));
    return [g.lats[j] + (g.lats[j + 1] - g.lats[j]) * (gy - j), g.lons[i] + (g.lons[i + 1] - g.lons[i]) * (gx - i)];
  };
  const labels: [string, number, number][] = [];
  g.levels.forEach((lv) => {
    const segs = contour(g.mag, nx, ny, lv);
    const path = new Path2D();
    // 等値線の数字は、地図の左から 3 割あたりの点に置く（上下に 2 つまで）
    const best: { d: number; x: number; y: number; up: boolean }[] = [];
    for (const s of segs) {
      const a = at(s[0], s[1]);
      const b = at(s[2], s[3]);
      for (const sh of proj.raw ? [-2 * Math.PI, 0, 2 * Math.PI] : [0]) {
        const p = proj.raw ? proj.raw(a[0], a[1] + sh) : proj.fwd(a[0], a[1]);
        const q = proj.raw ? proj.raw(b[0], b[1] + sh) : proj.fwd(b[0], b[1]);
        if (!p || !q || Math.hypot(p[0] - q[0], p[1] - q[1]) > proj.w / 8) continue;
        path.moveTo(p[0], p[1]);
        path.lineTo(q[0], q[1]);
        const mx = (p[0] + q[0]) / 2;
        const my = (p[1] + q[1]) / 2;
        if (my > 14 && my < proj.h - 8 && mx > 20 && mx < proj.w - 30) {
          const d = Math.abs(mx - proj.w * 0.3);
          const up = my < proj.h / 2;
          const k = up ? 0 : 1;
          if (!best[k] || d < best[k].d) best[k] = { d, x: mx, y: my, up };
        }
      }
    }
    ctx.strokeStyle = st.contour;
    ctx.lineWidth = 0.9;
    ctx.setLineDash([4, 3]);
    ctx.stroke(path);
    for (const b of best) if (b) labels.push([lv.toFixed(1), b.x, b.y]);
  });
  ctx.setLineDash([]);
  ctx.font = '500 11px "Fira Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [t, x, y] of labels) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = st.halo;
    ctx.strokeText(t, x, y);
    ctx.fillStyle = st.ink;
    ctx.fillText(t, x, y);
  }
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

/** 時刻 t の半影の外縁（その瞬間に欠けて見える範囲の境） */
function drawInstant(ctx: CanvasRenderingContext2D, proj: Projection, snap: Snap, st: MapStyle) {
  const step = 0.5;
  const nx = 721;
  const ny = 361;
  const v = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++)
      v[j * nx + i] = magAt(snap, observerXYZ((90 - j * step) * D2R, (-180 + i * step) * D2R, 0));
  const path = new Path2D();
  for (const s of contour(v, nx, ny, 1e-4)) {
    const a: [number, number] = [(90 - s[1] * step) * D2R, (-180 + s[0] * step) * D2R];
    const b: [number, number] = [(90 - s[3] * step) * D2R, (-180 + s[2] * step) * D2R];
    for (const sh of proj.raw ? [-2 * Math.PI, 0, 2 * Math.PI] : [0]) {
      const p = proj.raw ? proj.raw(a[0], a[1] + sh) : proj.fwd(a[0], a[1]);
      const q = proj.raw ? proj.raw(b[0], b[1] + sh) : proj.fwd(b[0], b[1]);
      if (!p || !q || Math.hypot(p[0] - q[0], p[1] - q[1]) > proj.w / 8) continue;
      path.moveTo(p[0], p[1]);
      path.lineTo(q[0], q[1]);
    }
  }
  ctx.strokeStyle = st.halo;
  ctx.lineWidth = 1.6;
  ctx.stroke(path);
}

/** 本影（金環）の帯: 北限と南限の間を塗り、限界の線を引く */
function drawBand(ctx: CanvasRenderingContext2D, proj: Projection, limits: PathPoint[][][], st: MapStyle) {
  const [north, south] = limits;
  for (let k = 0; k < Math.min(north.length, south.length); k++) {
    const ring = [...north[k], ...[...south[k]].reverse()];
    const path = linePath(proj, ring);
    ctx.fillStyle = st.band;
    ctx.fill(path);
  }
  for (const side of limits) for (const seg of side) strokeLine(ctx, proj, seg, st.ink, 0.9);
}

function drawObserver(
  ctx: CanvasRenderingContext2D,
  proj: Projection,
  o: NonNullable<MapScene['observer']>,
  st: MapStyle,
) {
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
