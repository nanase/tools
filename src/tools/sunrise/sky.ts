/**
 * 地点から見た空: 方位 360° × 高度 −20°〜90° のパノラマに、今日の太陽の道すじと夏至・冬至の道すじ、
 * 日の出・日の入りの方位、今の太陽を描く。地点の数値の文言もここで作る。色はテーマに依らない
 */
import { type Day, STEP } from './day';
import { drawSunMark, fitCanvas, haloText, type RGB, rgb } from './map';
import { band } from './sun';

const DIR16 = [
  '北',
  '北北東',
  '北東',
  '東北東',
  '東',
  '東南東',
  '南東',
  '南南東',
  '南',
  '南南西',
  '南西',
  '西南西',
  '西',
  '西北西',
  '北西',
  '北北西',
];
/** 段ごとの空と地面の色 */
const SKY: readonly RGB[] = [
  [160, 202, 230],
  [112, 130, 184],
  [74, 88, 142],
  [46, 56, 100],
  [22, 28, 56],
];
const GROUND: readonly RGB[] = [
  [104, 110, 90],
  [70, 76, 72],
  [50, 54, 60],
  [38, 42, 50],
  [26, 30, 38],
];
const SUN_LINE = '#ffd23a';
const minus = (s: string) => s.replace(/-/g, '−');
const p2 = (n: number) => String(n).padStart(2, '0');
const dir16 = (az: number): string => DIR16[Math.round(az / 22.5) % 16];

/** パノラマの真ん中の方位: 北半球は南（180°）、南半球は北（0°） */
export const skyCenter = (lat: number): 0 | 180 => (lat >= 0 ? 180 : 0);

/** 方位 az の横の位置（真ん中が center、幅 width で 360°） */
export function skyX(az: number, center: number, left: number, width: number): number {
  const rel = ((((az - center + 540) % 360) + 360) % 360) - 180;
  return left + ((rel + 180) / 360) * width;
}

function duration(ms: number): string {
  const m = Math.round(ms / 6e4);
  return `${Math.floor(m / 60)}時間${p2(m % 60)}分`;
}

/** 地点の数値: 高度・方位・日の出・南中・日の入り・昼の長さ */
export function factsOf(day: Day, now: { h: number; az: number }, fmt: (ms: number) => string): [string, string][] {
  const len =
    day.polar === 'day' ? '24時間00分（白夜）' : day.polar === 'night' ? '0時間00分（極夜）' : duration(day.len);
  return [
    ['高度', `${minus(now.h.toFixed(1))}°`],
    ['方位', `${Math.round(now.az) % 360}°（${dir16(now.az)}）`],
    ['日の出', day.rise === null ? '—' : fmt(day.rise)],
    ['南中', `${fmt(day.transit)}（${minus(day.maxH.toFixed(0))}°）`],
    ['日の入り', day.set === null ? '—' : fmt(day.set)],
    ['昼の長さ', len],
  ];
}

export interface SkyInput {
  day: Day;
  /** 夏至と冬至の日 */
  solstice: [Day, Day];
  /** 今の太陽（h は見かけ、hGeo は大気差なし） */
  now: { h: number; hGeo: number; az: number };
  lat: number;
  fmt: (ms: number) => string;
}

const A0 = -20;
const A1 = 90;

export function drawSky(cv: HTMLCanvasElement, o: SkyInput): void {
  const f = fitCanvas(cv, (w) => (w < 560 ? 200 : 250));
  const { ctx, w, h } = f;
  ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
  const L = 34;
  const pw = w - L - 6;
  const ph = h - 8 - 30;
  const center = skyCenter(o.lat);
  const X = (az: number) => skyX(az, center, L, pw);
  const Y = (a: number) => 8 + ((A1 - a) / (A1 - A0)) * ph;
  const k = band(o.now.hGeo);
  ctx.fillStyle = rgb(SKY[k]);
  ctx.fillRect(0, 0, w, Y(0));
  ctx.fillStyle = rgb(GROUND[k]);
  ctx.fillRect(0, Y(0), w, h - Y(0));
  for (const a of [30, 60]) {
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(L, Y(a));
    ctx.lineTo(L + pw, Y(a));
    ctx.stroke();
    haloText(ctx, `${a}°`, L - 4, Y(a), 13, 'right');
  }
  ctx.strokeStyle = 'rgba(255,255,255,.8)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, Y(0));
  ctx.lineTo(w, Y(0));
  ctx.stroke();
  for (let az = 0; az < 360; az += 45) {
    const x = X(az);
    ctx.strokeStyle = 'rgba(255,255,255,.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, Y(0));
    ctx.lineTo(x, Y(0) + 5);
    ctx.stroke();
    haloText(ctx, DIR16[az / 22.5], x, h - 12, 13, 'center');
  }
  /* 道すじ: 地平線の上は実線、下は破線。左右の端で折り返す所は線をつながない */
  const trace = (d: Day) => {
    ctx.beginPath();
    let px: number | null = null;
    for (let i = 0; i <= d.N; i++) {
      const x = X(d.azs[i]);
      const y = Y(Math.max(A0 - 5, d.hs[i]));
      if (px === null || Math.abs(x - px) > pw / 2) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      px = x;
    }
    ctx.stroke();
  };
  const path = (d: Day, color: string, width: number, above: number[], below: number[]) => {
    for (const [top, dash, alpha] of [
      [true, above, 1],
      [false, below, 0.55],
    ] as const) {
      ctx.save();
      ctx.beginPath();
      if (top) ctx.rect(0, 0, w, Y(0));
      else ctx.rect(0, Y(0), w, h);
      ctx.clip();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.globalAlpha = alpha;
      ctx.setLineDash(dash);
      trace(d);
      ctx.restore();
    }
  };
  const peak = (d: Day, s: string, dy: number) => {
    let im = 0;
    for (let i = 1; i <= d.N; i++) if (d.hs[i] > d.hs[im]) im = i;
    if (d.hs[im] > A0) haloText(ctx, s, X(d.azs[im]), Y(d.hs[im]) + dy, 13, 'center');
  };
  const [su, wi] = o.solstice;
  path(su, 'rgba(255,255,255,.75)', 1.2, [3, 4], [3, 4]);
  path(wi, 'rgba(255,255,255,.75)', 1.2, [3, 4], [3, 4]);
  const d = o.day;
  path(d, SUN_LINE, 2.5, [], [5, 4]);
  peak(su, '夏至', -10);
  peak(wi, '冬至', 12);
  /* 1 時間ごとの点、3 時間ごとの時刻、時刻の間の進む向きの矢じり */
  const per = 36e5 / STEP;
  for (let i = 0; i <= d.N; i += per) {
    const a = d.hs[i];
    if (a < A0) continue;
    const x = X(d.azs[i]);
    const y = Y(a);
    ctx.beginPath();
    ctx.arc(x, y, 2.6, 0, 2 * Math.PI);
    ctx.fillStyle = SUN_LINE;
    ctx.fill();
    if ((i / per) % 3 === 0 && a > 0)
      haloText(ctx, o.fmt(d.d0 + i * STEP).replace(/:00$/, '時'), x, y - 11, 13, 'center');
    const j = i + per / 2;
    if (j + 1 <= d.N && d.hs[j] > 0) {
      const x1 = X(d.azs[j - 1]);
      const x2 = X(d.azs[j + 1]);
      if (Math.abs(x2 - x1) < pw / 4) {
        const an = Math.atan2(Y(d.hs[j + 1]) - Y(d.hs[j - 1]), x2 - x1);
        ctx.save();
        ctx.translate(X(d.azs[j]), Y(d.hs[j]));
        ctx.rotate(an);
        ctx.beginPath();
        ctx.moveTo(5, 0);
        ctx.lineTo(-4, -4);
        ctx.lineTo(-4, 4);
        ctx.closePath();
        ctx.fillStyle = SUN_LINE;
        ctx.fill();
        ctx.restore();
      }
    }
  }
  /* 日の出・日の入りの方位の印 */
  const mark = (t: number | null, az: number | null, s: string) => {
    if (t === null || az === null) return;
    const x = X(az);
    ctx.fillStyle = SUN_LINE;
    ctx.beginPath();
    ctx.moveTo(x, Y(0) - 1);
    ctx.lineTo(x - 5, Y(0) + 8);
    ctx.lineTo(x + 5, Y(0) + 8);
    ctx.fill();
    haloText(ctx, `${s} ${o.fmt(t)}`, x, Y(0) + 18, 15, 'center');
  };
  mark(d.rise, d.riseAz, '日の出');
  mark(d.set, d.setAz, '日の入り');
  const sx = X(o.now.az);
  const sy = Y(Math.max(A0, o.now.h));
  if (o.now.h >= 0) drawSunMark(ctx, sx, sy, 8);
  else {
    ctx.beginPath();
    ctx.arc(sx, sy, 7, 0, 2 * Math.PI);
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = SUN_LINE;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
