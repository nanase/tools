/**
 * 電車と自動車の絵: 背景（動かない）・車体（車輪を除く）・車輪・手前（動かない）。単位は m、y は上向き。
 * 電車はレールの頭、自動車は路面が y = 0
 */
import { BIKE, CAR, CAR_VIEW, TRAIN, TRAIN_VIEW } from '../motion';
import {
  canvas,
  cloud,
  disc,
  fillPoly,
  fillRr,
  grad,
  houses,
  limb,
  line,
  mctx,
  radial,
  rng,
  rr,
  sky,
  speckle,
  text,
  tree,
} from '../paint';

const BG_W = 2048;
const BG_H = 1152;
const bgCtx = (c: HTMLCanvasElement, v: readonly number[]) => mctx(c, v[0], v[1], v[2]);

/* ===================== 電車 ===================== */
export function trainBg(): HTMLCanvasElement {
  const c = canvas(BG_W, BG_H);
  const ctx = bgCtx(c, TRAIN_VIEW);
  const R = rng(11);
  sky(ctx, -13, -2.6, 26, 14.7, '#5f93cc', '#d5e4ee');
  for (let i = 0; i < 6; i++) cloud(ctx, R, -10 + R() * 20, 6.8 + R() * 1.8, 1 + R() * 1.2);
  ctx.fillStyle = '#93a9a7';
  ctx.beginPath();
  ctx.moveTo(-13, 0);
  for (let x = -13; x <= 13.01; x += 0.25) ctx.lineTo(x, 3.6 + 0.8 * Math.sin(x * 0.19 + 1) + 0.4 * Math.sin(x * 0.61));
  ctx.lineTo(13, 0);
  ctx.fill();
  houses(ctx, R, -14, 14, 0.9, 1.8, 4.2, ['#d9d2c4', '#cfc9bd', '#e2ddd3', '#bfc4c4', '#d6cdbb']);
  for (let i = 0; i < 9; i++)
    tree(ctx, R, -13 + R() * 26, 1.4 + R() * 1.4, 1.2 + R() * 0.8, R() < 0.5 ? '#5e7a52' : '#6d8a5c');
  // 線路の向こうの草地と柵
  ctx.fillStyle = '#7f9a62';
  ctx.fillRect(-13, 0.25, 26, 0.9);
  speckle(ctx, R, -13, 0.25, 26, 0.9, 2500, ['#6f8a55', '#8eaa6f', '#73905a'], 0.05);
  for (let x = -13; x < 13; x += 2) {
    ctx.fillStyle = '#8a8f93';
    ctx.fillRect(x, 0.6, 0.06, 1.2);
  }
  line(ctx, -13, 1.75, 13, 1.75, 0.03, '#8a8f93');
  line(ctx, -13, 1.2, 13, 1.2, 0.03, '#8a8f93');
  for (let x = -13; x < 13; x += 0.12) line(ctx, x, 0.62, x, 1.75, 0.008, 'rgba(110,116,120,.55)');
  // バラスト
  ctx.fillStyle = grad(ctx, 0, 0.3, 0, -2.6, [
    [0, '#8f8a82'],
    [1, '#76716a'],
  ]);
  ctx.fillRect(-13, -2.6, 26, 2.9);
  speckle(ctx, R, -13, -2.6, 26, 2.9, 26000, ['#a29d94', '#6a655e', '#8a857c', '#b3ada3', '#5d5852'], 0.07);
  // まくらぎの端とレール
  for (let x = -13; x < 13; x += 0.62) {
    ctx.fillStyle = '#b6b2aa';
    ctx.fillRect(x, -0.42, 0.26, 0.24);
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.fillRect(x, -0.42, 0.26, 0.05);
  }
  ctx.fillStyle = grad(ctx, 0, 0, 0, -0.18, [
    [0, '#d5d7d8'],
    [0.12, '#8e8f8f'],
    [0.5, '#5a4b42'],
    [1, '#3c312b'],
  ]);
  ctx.fillRect(-13, -0.18, 26, 0.18);
  line(ctx, -13, -0.01, 13, -0.01, 0.025, '#eceeee');
  return c;
}

/** 手前の電柱と架線（ちょう架線・トロリ線・ハンガー・き電線） */
export function trainFg(): HTMLCanvasElement {
  const c = canvas(BG_W, BG_H);
  const ctx = bgCtx(c, TRAIN_VIEW);
  const R = rng(5);
  const px = 6.6;
  const msg = (x: number) => 6.25 - 0.0011 * (x - (px - 0.9)) ** 2;
  for (let x = -12.5; x < 13; x += 5) line(ctx, x, 5.12, x, msg(x), 0.012, '#3a3c3e');
  const curve = (f: (x: number) => number, w: number, col: string) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath();
    for (let x = -13; x <= 13; x += 0.2) x === -13 ? ctx.moveTo(x, f(x)) : ctx.lineTo(x, f(x));
    ctx.stroke();
  };
  curve(msg, 0.022, '#2e3032');
  line(ctx, -13, 5.12, 13, 5.12, 0.026, '#2a2c2e');
  curve((x) => 8.45 - 0.0016 * (x - px) ** 2, 0.035, '#3d3f41');
  // 電柱（鋼管）と基礎
  ctx.fillStyle = grad(ctx, px - 0.2, 0, px + 0.2, 0, [
    [0, '#5f6466'],
    [0.3, '#c3c8ca'],
    [0.55, '#a2a8ab'],
    [1, '#4c5153'],
  ]);
  ctx.fillRect(px - 0.2, -2.6, 0.4, 11.6);
  for (let y = -1; y < 9; y += 1.6) line(ctx, px - 0.2, y, px + 0.2, y, 0.02, 'rgba(60,64,66,.5)');
  ctx.fillStyle = '#a7a39b';
  ctx.fillRect(px - 0.38, -2.6, 0.76, 0.75);
  // き電線の腕金と碍子
  ctx.fillStyle = '#596063';
  ctx.fillRect(px - 1.1, 8.55, 1.5, 0.12);
  for (const x of [px - 0.9, px + 0.05])
    for (let k = 0; k < 4; k++)
      fillRr(ctx, x - 0.11, 8.48 - k * 0.07 - 0.07, 0.22, 0.07, 0.03, k % 2 ? '#7a4a33' : '#8f5a3f');
  // 可動ブラケット（斜めの管）と碍子
  line(ctx, px - 0.18, 6.55, px - 1.05, 6.3, 0.07, '#7d8487');
  line(ctx, px - 0.18, 5.45, px - 1.0, 6.3, 0.06, '#7d8487');
  line(ctx, px - 0.95, 6.28, px - 0.95, 5.12, 0.035, '#6c7376');
  for (const y of [6.5, 5.6])
    for (let k = 0; k < 3; k++) fillRr(ctx, px - 0.35 - k * 0.08 - 0.04, y - 0.09, 0.07, 0.18, 0.03, '#8f5a3f');
  ctx.fillStyle = '#3c4245';
  ctx.fillRect(px - 1.05, 5.08, 0.2, 0.1);
  // 電柱の番号札
  ctx.fillStyle = '#f0f0ea';
  ctx.fillRect(px - 0.16, 1.6, 0.32, 0.5);
  text(ctx, '47', px, 1.85, 0.2, '#222');
  // 手前の草
  for (let i = 0; i < 900; i++) {
    const x = -13 + R() * 26;
    line(ctx, x, -2.6, x + (R() - 0.5) * 0.25, -2.6 + 0.15 + R() * 0.55, 0.025, R() < 0.5 ? '#5f7a46' : '#7a9658');
  }
  return c;
}

/** 1 両分（連結面の間 20.5 m）。車体の座標で x = 0〜20.5、y = −0.6〜5.4 */
export function trainBody(): HTMLCanvasElement {
  const [bx0, by0, bw] = TRAIN.body;
  const c = canvas(2214, 648);
  const ctx = mctx(c, bx0, by0, bw);
  const L = 0.25;
  const Rt = 20.25;
  // 車体の影
  ctx.fillStyle = grad(ctx, 0, 0.05, 0, -0.35, [
    [0, 'rgba(0,0,0,.28)'],
    [1, 'rgba(0,0,0,0)'],
  ]);
  ctx.fillRect(L, -0.35, Rt - L, 0.4);
  // 床下機器
  const boxes: [number, number, number, string][] = [
    [4.6, 6.3, 0.55, '#3b3f43'],
    [6.6, 8.9, 0.62, '#2f3336'],
    [9.2, 11.7, 0.5, '#45494c'],
    [12.0, 13.6, 0.64, '#383c3f'],
    [13.9, 15.4, 0.58, '#2e3134'],
  ];
  for (const [a, b, lo, col] of boxes) {
    ctx.fillStyle = col;
    ctx.fillRect(a, lo, b - a, 1.13 - lo);
    ctx.fillStyle = 'rgba(255,255,255,.07)';
    ctx.fillRect(a, 1.05, b - a, 0.04);
    for (let x = a + 0.15; x < b - 0.1; x += 0.35) {
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.fillRect(x, lo + 0.1, 0.04, 1.0 - lo - 0.15);
    }
  }
  // 台車の枠（車輪の手前）
  for (const bc of [3.35, 17.15]) {
    fillRr(ctx, bc - 1.62, 0.42, 3.24, 0.34, 0.1, '#2a2d30');
    ctx.fillStyle = '#34383b';
    ctx.fillRect(bc - 0.55, 0.62, 1.1, 0.45);
    for (const s of [-1, 1]) {
      const wx = bc + s * 1.05;
      fillRr(ctx, wx - 0.2, 0.26, 0.4, 0.36, 0.05, '#1f2224');
      disc(ctx, wx, 0.43, 0.1, '#4b5154');
      ctx.strokeStyle = '#5c6366';
      ctx.lineWidth = 0.035;
      ctx.beginPath();
      for (let k = 0; k <= 8; k++) ctx.lineTo(wx + (k % 2 ? 0.12 : -0.12), 0.62 + k * 0.04);
      ctx.stroke();
    }
    ctx.fillStyle = '#3f4447';
    ctx.fillRect(bc - 0.35, 0.3, 0.7, 0.18);
  }
  // 連結部の幌と連結器
  for (const [a, b] of [
    [0, L],
    [Rt, 20.5],
  ]) {
    ctx.fillStyle = '#26292b';
    ctx.fillRect(a, 1.3, b - a, 2.0);
    for (let y = 1.35; y < 3.3; y += 0.12) line(ctx, a, y, b, y, 0.02, '#3a3e41');
  }
  ctx.fillStyle = '#2c2f31';
  ctx.fillRect(0, 0.78, L + 0.1, 0.16);
  ctx.fillRect(Rt - 0.1, 0.78, 0.35, 0.16);
  // 車体（ステンレス）
  ctx.save();
  rr(ctx, L, 1.12, Rt - L, 2.52, 0.14);
  ctx.clip();
  ctx.fillStyle = grad(ctx, 0, 3.64, 0, 1.12, [
    [0, '#e4e8ea'],
    [0.45, '#cdd2d5'],
    [0.8, '#b2b8bc'],
    [1, '#8f969a'],
  ]);
  ctx.fillRect(L, 1.12, Rt - L, 2.52);
  for (let x = L; x < Rt; x += 0.06) {
    ctx.fillStyle = Math.round(x / 0.06) % 2 ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.07)';
    ctx.fillRect(x, 1.18, 0.03, 0.66);
  }
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.fillRect(L, 1.12, Rt - L, 0.06);
  ctx.restore();
  // 屋根
  fillRr(
    ctx,
    L + 0.1,
    3.58,
    Rt - L - 0.2,
    0.32,
    0.12,
    grad(ctx, 0, 3.92, 0, 3.6, [
      [0, '#9aa0a4'],
      [1, '#b9bfc3'],
    ]),
  );
  line(ctx, L + 0.05, 3.6, Rt - 0.05, 3.6, 0.025, '#6e7478');
  // 帯
  ctx.fillStyle = '#2b9a52';
  ctx.fillRect(L, 1.86, Rt - L, 0.13);
  ctx.fillStyle = '#1e7a3e';
  ctx.fillRect(L, 1.86, Rt - L, 0.025);
  ctx.fillStyle = '#2b9a52';
  ctx.fillRect(L, 3.1, Rt - L, 0.07);
  // 窓
  const doors = [2.85, 7.7, 12.8, 17.65];
  const dw = 1.3;
  const glass = (x: number, y: number, w: number, h: number) => {
    fillRr(ctx, x - 0.03, y - 0.03, w + 0.06, h + 0.06, 0.06, '#20262b');
    fillRr(
      ctx,
      x,
      y,
      w,
      h,
      0.05,
      grad(ctx, 0, y + h, 0, y, [
        [0, '#5e7487'],
        [0.45, '#33424f'],
        [1, '#1d252c'],
      ]),
    );
    ctx.save();
    rr(ctx, x, y, w, h, 0.05);
    ctx.clip();
    fillPoly(
      ctx,
      [
        [x + w * 0.15, y + h],
        [x + w * 0.45, y + h],
        [x + w * 0.05, y],
        [x - w * 0.25, y],
      ],
      'rgba(220,235,245,.16)',
    );
    ctx.fillStyle = 'rgba(30,36,40,.55)';
    ctx.fillRect(x, y, w, h * 0.22);
    ctx.restore();
  };
  const edges = [L + 0.35, ...doors.flatMap((d) => [d - dw / 2 - 0.25, d + dw / 2 + 0.25]), Rt - 0.35];
  for (let i = 0; i < edges.length; i += 2) {
    const a = edges[i];
    const span = edges[i + 1] - a;
    const n = span > 3 ? 3 : span > 1.6 ? 2 : 1;
    const gap = 0.12;
    const ww = (span - gap * (n - 1)) / n;
    for (let k = 0; k < n; k++) glass(a + k * (ww + gap), 2.02, ww, 0.98);
  }
  // ドア
  for (const d of doors) {
    const x = d - dw / 2;
    ctx.fillStyle = '#5b6165';
    ctx.fillRect(x - 0.05, 1.15, dw + 0.1, 1.92);
    ctx.fillStyle = grad(ctx, 0, 3.0, 0, 1.18, [
      [0, '#e1e5e7'],
      [1, '#a9b0b4'],
    ]);
    ctx.fillRect(x, 1.18, dw, 1.86);
    line(ctx, d, 1.18, d, 3.04, 0.025, '#3a3f42');
    for (const s of [-1, 1]) glass(d + (s < 0 ? -0.5 : 0.12), 2.1, 0.38, 0.78);
    ctx.fillStyle = '#c2a23a';
    ctx.fillRect(x - 0.06, 3.07, dw + 0.12, 0.06);
  }
  // 屋根の機器: 冷房装置とパンタグラフ
  fillRr(
    ctx,
    8.6,
    3.86,
    3.0,
    0.38,
    0.08,
    grad(ctx, 0, 4.24, 0, 3.86, [
      [0, '#c5cacd'],
      [1, '#8f969a'],
    ]),
  );
  for (let x = 8.8; x < 11.5; x += 0.14) line(ctx, x, 3.92, x, 4.18, 0.02, 'rgba(60,64,66,.5)');
  ctx.fillStyle = '#9aa0a4';
  ctx.fillRect(3.0, 3.86, 1.1, 0.16);
  for (const x of [13.2, 14.6]) fillRr(ctx, x - 0.07, 3.86, 0.14, 0.16, 0.04, '#8f5a3f');
  ctx.fillStyle = '#545b5f';
  ctx.fillRect(13.0, 4.0, 1.8, 0.07);
  line(ctx, 13.35, 4.05, 14.75, 4.62, 0.06, '#4b5256');
  line(ctx, 14.75, 4.62, 14.05, 5.08, 0.045, '#5c6367');
  line(ctx, 13.4, 4.12, 14.7, 4.6, 0.025, '#6c7376');
  fillRr(ctx, 13.78, 5.06, 0.54, 0.07, 0.03, '#3d4447');
  line(ctx, 13.72, 5.09, 13.6, 5.02, 0.03, '#3d4447');
  line(ctx, 14.38, 5.09, 14.5, 5.02, 0.03, '#3d4447');
  return c;
}

/** 鉄道の車輪（直径 860 mm）。回っているのが分かるよう、穴とボルトと白い印を付ける */
export function trainWheel(): HTMLCanvasElement {
  const r = TRAIN.wr * 1.05;
  const c = canvas(256, 256);
  const ctx = mctx(c, -r, -r, 2 * r);
  disc(ctx, 0, 0, 0.43, '#4c4e50');
  disc(
    ctx,
    0,
    0,
    0.395,
    grad(ctx, -0.4, 0.4, 0.4, -0.4, [
      [0, '#6b5a50'],
      [1, '#3e3530'],
    ]),
  );
  ctx.strokeStyle = '#2b2522';
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  ctx.arc(0, 0, 0.3, 0, 7);
  ctx.stroke();
  disc(ctx, 0, 0, 0.13, '#5a4c44');
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    disc(ctx, 0.22 * Math.cos(a), 0.22 * Math.sin(a), 0.035, '#2a2420');
  }
  ctx.fillStyle = '#e8e2d0';
  ctx.fillRect(0.15, -0.02, 0.2, 0.04);
  return c;
}

/* ===================== 自動車と自転車 ===================== */
function signDisc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, kind: 'speed' | 'park'): void {
  disc(ctx, x, y, r + 0.012, '#dcdcd8');
  disc(ctx, x, y, r, '#c8202a');
  if (kind === 'speed') {
    disc(ctx, x, y, r * 0.78, '#f7f7f4');
    text(ctx, '50', x, y - 0.01, r * 1.05, '#1b4fa0', 800, '"Arial Narrow", "Segoe UI", sans-serif');
  } else {
    disc(ctx, x, y, r * 0.78, '#1b56a8');
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.78, 0, 7);
    ctx.clip();
    line(ctx, x - r, y + r, x + r, y - r, r * 0.2, '#c8202a');
    ctx.restore();
  }
}
export function carBg(): HTMLCanvasElement {
  const c = canvas(BG_W, BG_H);
  const ctx = bgCtx(c, CAR_VIEW);
  const R = rng(21);
  sky(ctx, -4.5, -0.9, 9, 5.2, '#6c9ccf', '#d9e5ec');
  // 向かいの建物
  const blds: [number, number, string][] = [
    [-4.8, 2.4, '#d8cfc0'],
    [-2.3, 3.1, '#bfc5c7'],
    [0.95, 2.2, '#e0d8ca'],
    [3.25, 2.6, '#c9bba8'],
  ];
  for (const [x, w, col] of blds) {
    ctx.fillStyle = col;
    ctx.fillRect(x, 0.78, w, 4.3);
    ctx.fillStyle = 'rgba(0,0,0,.1)';
    ctx.fillRect(x + w - 0.12, 0.78, 0.12, 4.3);
    for (let y = 2.55; y < 5; y += 1.15)
      for (let wx = x + 0.3; wx < x + w - 0.6; wx += 0.85) {
        ctx.fillStyle = '#6f7f8b';
        ctx.fillRect(wx, y, 0.55, 0.7);
        ctx.fillStyle = 'rgba(255,255,255,.25)';
        ctx.fillRect(wx, y + 0.5, 0.55, 0.06);
      }
    ctx.fillStyle = '#48525a';
    ctx.fillRect(x + 0.15, 0.78, w - 0.3, 1.25);
    ctx.fillStyle = 'rgba(200,215,225,.35)';
    for (let k = 0; k < 4; k++) ctx.fillRect(x + 0.25 + (k * (w - 0.5)) / 4, 0.85, (w - 0.5) / 4 - 0.08, 1.05);
    ctx.fillStyle = R() < 0.5 ? '#a63b2c' : '#2f6c8f';
    ctx.fillRect(x + 0.1, 2.05, w - 0.2, 0.32);
  }
  text(ctx, 'カフェ', -1.0, 2.21, 0.2, '#fff');
  text(ctx, '薬局', 2.05, 2.21, 0.2, '#fff');
  // 向こうの歩道と縁石
  ctx.fillStyle = '#b7b3ab';
  ctx.fillRect(-4.5, 0.42, 9, 0.38);
  for (let x = -4.5; x < 4.5; x += 0.3) line(ctx, x, 0.42, x + 0.1, 0.8, 0.01, 'rgba(0,0,0,.12)');
  ctx.fillStyle = '#d6d3cc';
  ctx.fillRect(-4.5, 0.38, 9, 0.06);
  // 電柱と電線
  ctx.fillStyle = grad(ctx, -3.35, 0, -3.05, 0, [
    [0, '#8f918c'],
    [0.4, '#c7c8c2'],
    [1, '#7c7e79'],
  ]);
  ctx.fillRect(-3.33, 0.6, 0.26, 4.0);
  ctx.fillStyle = '#6b6e6b';
  ctx.fillRect(-3.9, 3.85, 1.4, 0.08);
  for (const y of [3.95, 3.7]) line(ctx, -4.5, y, 4.5, y - 0.12, 0.012, '#2f3133');
  fillRr(ctx, -3.1, 3.0, 0.32, 0.5, 0.06, '#9ea3a4');
  // 向こうの歩道の標識（最高速度・駐車禁止）
  const sx = 0.85;
  ctx.fillStyle = grad(ctx, sx - 0.025, 0, sx + 0.025, 0, [
    [0, '#7d8285'],
    [0.4, '#d5d9db'],
    [1, '#6f7477'],
  ]);
  ctx.fillRect(sx - 0.025, 0.6, 0.05, 2.75);
  signDisc(ctx, sx, 3.05, 0.22, 'speed');
  signDisc(ctx, sx, 2.56, 0.22, 'park');
  ctx.fillStyle = '#f2f2ee';
  ctx.fillRect(sx - 0.22, 2.2, 0.44, 0.13);
  text(ctx, '8-20', sx, 2.265, 0.09, '#222', 700);
  // 路面
  ctx.fillStyle = grad(ctx, 0, 0.38, 0, -0.9, [
    [0, '#56585a'],
    [1, '#424446'],
  ]);
  ctx.fillRect(-4.5, -0.9, 9, 1.28);
  speckle(ctx, R, -4.5, -0.9, 9, 1.28, 30000, ['#606264', '#3c3e40', '#4e5052', '#6a6c6e'], 0.012);
  ctx.fillStyle = '#e9e7e0';
  ctx.fillRect(-4.5, 0.28, 9, 0.035);
  for (let x = -4.4; x < 4.5; x += 3) ctx.fillRect(x, -0.42, 1.5, 0.05);
  return c;
}

/** 車体（全長 4.5 m）。車体の座標で x = −2.6〜2.6、y = −0.12〜1.6。前は +x */
export function carBody(): HTMLCanvasElement {
  const [bx0, by0, bw] = CAR.body;
  const c = canvas(1600, 528);
  const ctx = mctx(c, bx0, by0, bw);
  const wr = 0.385;
  // 影
  ctx.save();
  ctx.scale(1, 0.06);
  disc(
    ctx,
    0,
    0,
    2.6,
    radial(ctx, 0, 0, 2.6, [
      [0.08, 'rgba(0,0,0,.45)'],
      [1, 'rgba(0,0,0,0)'],
    ]),
  );
  ctx.restore();
  const body = () => {
    ctx.beginPath();
    ctx.moveTo(-2.2, 0.3);
    ctx.bezierCurveTo(-2.3, 0.4, -2.3, 0.6, -2.29, 0.92);
    ctx.bezierCurveTo(-2.25, 1.05, -2.15, 1.08, -2.05, 1.12);
    ctx.bezierCurveTo(-1.95, 1.3, -1.85, 1.42, -1.55, 1.46);
    ctx.bezierCurveTo(-0.8, 1.5, -0.3, 1.5, 0.15, 1.46);
    ctx.bezierCurveTo(0.45, 1.36, 0.65, 1.18, 0.9, 1.06);
    ctx.bezierCurveTo(1.4, 1.0, 1.9, 0.96, 2.18, 0.86);
    ctx.bezierCurveTo(2.3, 0.78, 2.32, 0.55, 2.28, 0.38);
    ctx.lineTo(2.18, 0.3);
    ctx.lineTo(1.33 + wr, 0.3);
    ctx.arc(1.33, 0.32, wr, -0.05, Math.PI + 0.05, false);
    ctx.lineTo(-1.33 + wr, 0.28);
    ctx.arc(-1.33, 0.32, wr, -0.05, Math.PI + 0.05, false);
    ctx.closePath();
  };
  body();
  ctx.fillStyle = grad(ctx, 0, 1.5, 0, 0.28, [
    [0, '#7aa6d4'],
    [0.25, '#2f5f96'],
    [0.5, '#1d4677'],
    [0.62, '#5f86b3'],
    [0.7, '#244d80'],
    [1, '#132f52'],
  ]);
  ctx.fill();
  ctx.save();
  body();
  ctx.clip();
  // 下の樹脂と陰・プレスライン
  ctx.fillStyle = '#1b1d1f';
  ctx.fillRect(-2.4, 0.26, 4.8, 0.14);
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.fillRect(-2.4, 0.4, 4.8, 0.08);
  line(ctx, -2.2, 0.98, 2.1, 0.9, 0.012, 'rgba(255,255,255,.35)');
  // 窓
  ctx.beginPath();
  ctx.moveTo(-1.98, 1.1);
  ctx.bezierCurveTo(-1.86, 1.28, -1.75, 1.38, -1.5, 1.41);
  ctx.bezierCurveTo(-0.8, 1.45, -0.3, 1.45, 0.1, 1.41);
  ctx.bezierCurveTo(0.35, 1.32, 0.55, 1.18, 0.74, 1.08);
  ctx.lineTo(-1.98, 1.06);
  ctx.closePath();
  ctx.fillStyle = grad(ctx, 0, 1.45, 0, 1.05, [
    [0, '#9fb6c9'],
    [0.35, '#2d3a45'],
    [1, '#141a1f'],
  ]);
  ctx.fill();
  fillPoly(
    ctx,
    [
      [-1.2, 1.46],
      [-0.75, 1.46],
      [-1.1, 1.05],
      [-1.55, 1.05],
    ],
    'rgba(230,240,250,.18)',
  );
  ctx.fillStyle = '#16191c';
  ctx.fillRect(-0.6, 1.05, 0.08, 0.42);
  ctx.fillRect(-1.75, 1.05, 0.12, 0.4);
  line(ctx, -1.98, 1.06, 0.76, 1.07, 0.02, '#0e1012');
  // ドアの線と取っ手
  ctx.strokeStyle = 'rgba(0,0,0,.55)';
  ctx.lineWidth = 0.012;
  for (const [x0, x1] of [
    [0.78, 0.66],
    [-0.56, -0.6],
    [-1.68, -1.6],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x0, 1.06);
    ctx.quadraticCurveTo(x0 + 0.05, 0.6, x1, 0.4);
    ctx.stroke();
  }
  for (const x of [0.02, -1.1]) fillRr(ctx, x, 0.9, 0.16, 0.035, 0.015, '#c9ced2');
  // 灯火
  fillPoly(
    ctx,
    [
      [1.92, 0.94],
      [2.2, 0.86],
      [2.27, 0.76],
      [1.98, 0.8],
    ],
    grad(ctx, 1.95, 0, 2.28, 0, [
      [0, '#9aa8b2'],
      [1, '#f2f6f8'],
    ]),
  );
  fillPoly(
    ctx,
    [
      [-2.29, 0.86],
      [-2.27, 1.0],
      [-2.08, 1.1],
      [-2.08, 0.9],
    ],
    '#b3141c',
  );
  ctx.fillStyle = '#1b1d1f';
  ctx.fillRect(2.0, 0.35, 0.3, 0.14);
  ctx.restore();
  // ドアミラー
  fillPoly(
    ctx,
    [
      [0.62, 1.1],
      [0.82, 1.12],
      [0.84, 1.2],
      [0.66, 1.22],
    ],
    '#1d4677',
  );
  // タイヤハウス（車輪の外側だけ黒く）
  for (const wx of CAR.wheels) {
    ctx.fillStyle = '#0d0e0f';
    ctx.beginPath();
    ctx.arc(wx, 0.32, wr - 0.005, 0, Math.PI, false);
    ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    disc(ctx, wx, 0.32, 0.322, '#000');
    ctx.restore();
  }
  return c;
}

/** 5 本スポークのアルミホイールとタイヤ（直径 640 mm） */
export function carWheel(): HTMLCanvasElement {
  const r = CAR.wr * 1.05;
  const c = canvas(256, 256);
  const ctx = mctx(c, -r, -r, 2 * r);
  disc(ctx, 0, 0, 0.32, '#141516');
  ctx.strokeStyle = '#26282a';
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  ctx.arc(0, 0, 0.27, 0, 7);
  ctx.stroke();
  disc(ctx, 0, 0, 0.205, '#5d6165');
  disc(ctx, 0, 0, 0.17, '#2a2c2e');
  ctx.strokeStyle = '#4a4e52';
  ctx.lineWidth = 0.008;
  for (let rr2 = 0.08; rr2 < 0.17; rr2 += 0.022) {
    ctx.beginPath();
    ctx.arc(0, 0, rr2, 0, 7);
    ctx.stroke();
  }
  ctx.fillStyle = grad(ctx, -0.2, 0.2, 0.2, -0.2, [
    [0, '#eef1f3'],
    [0.5, '#b4babe'],
    [1, '#80868a'],
  ]);
  for (let k = 0; k < 5; k++) {
    const a = (k * 2 * Math.PI) / 5 + Math.PI / 2;
    for (const d of [-0.11, 0.11]) {
      const ca = Math.cos(a + d);
      const sa = Math.sin(a + d);
      const cb = Math.cos(a + d * 0.3);
      const sb = Math.sin(a + d * 0.3);
      ctx.beginPath();
      ctx.moveTo(0.05 * cb - 0.02 * sb, 0.05 * sb + 0.02 * cb);
      ctx.lineTo(0.195 * ca - 0.018 * sa, 0.195 * sa + 0.018 * ca);
      ctx.lineTo(0.195 * ca + 0.018 * sa, 0.195 * sa - 0.018 * ca);
      ctx.lineTo(0.05 * cb + 0.02 * sb, 0.05 * sb - 0.02 * cb);
      ctx.fill();
    }
  }
  ctx.strokeStyle = '#c9ced2';
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  ctx.arc(0, 0, 0.195, 0, 7);
  ctx.stroke();
  disc(ctx, 0, 0, 0.055, '#9aa0a4');
  disc(ctx, 0, 0, 0.025, '#3a3e42');
  return c;
}

/** 自転車と乗る人。自転車の座標で x = −1〜1、y = −0.42〜1.62。前は +x、路面は y = −0.35 */
export function bikeBody(): HTMLCanvasElement {
  const [bx0, by0, bw] = BIKE.body;
  const c = canvas(600, 612);
  const ctx = mctx(c, bx0, by0, bw);
  type P = readonly [number, number];
  const seg = (a: P, b: P, w: number, col: string) => line(ctx, a[0], a[1], b[0], b[1], w, col);
  ctx.save();
  ctx.translate(0, -0.35);
  ctx.scale(1, 0.05);
  disc(
    ctx,
    0,
    0,
    1,
    radial(ctx, 0, 0, 1, [
      [0.1, 'rgba(0,0,0,.4)'],
      [1, 'rgba(0,0,0,0)'],
    ]),
  );
  ctx.restore();
  const RH: P = [-0.52, -0.01];
  const FH: P = [0.52, -0.01];
  const BB: P = [-0.06, -0.08];
  const ST: P = [-0.2, 0.48];
  const HT: P = [0.36, 0.5];
  const HB: P = [0.4, 0.34];
  const hip: P = [-0.22, 0.66];
  const sh: P = [0.1, 1.12];
  // 奥の脚
  limb(ctx, [hip, [-0.12, 0.3], [-0.16, -0.1]], 0.12, '#1f2a36');
  seg([-0.2, -0.12], [-0.06, -0.12], 0.06, '#111');
  // フレーム
  const fc = '#1f7a8c';
  seg(BB, RH, 0.025, fc);
  seg(ST, RH, 0.022, fc);
  seg(BB, ST, 0.035, fc);
  seg(ST, HT, 0.035, fc);
  seg(BB, HB, 0.042, fc);
  seg(HT, HB, 0.045, fc);
  seg(HB, FH, 0.03, '#2b2f33');
  seg(ST, [-0.23, 0.6], 0.025, '#c4c9cc');
  fillRr(ctx, -0.37, 0.6, 0.27, 0.05, 0.02, '#16181a');
  seg(HT, [0.37, 0.64], 0.03, '#c4c9cc');
  seg([0.37, 0.64], [0.27, 0.67], 0.035, '#16181a');
  ctx.strokeStyle = '#3a3e42';
  ctx.lineWidth = 0.015;
  ctx.beginPath();
  ctx.arc(BB[0], BB[1], 0.1, 0, 7);
  ctx.stroke();
  seg([BB[0], BB[1] + 0.1], [RH[0], RH[1] + 0.04], 0.012, '#4a4f53');
  seg([BB[0], BB[1] - 0.1], [RH[0], RH[1] - 0.04], 0.012, '#4a4f53');
  disc(ctx, RH[0] - 0.02, RH[1] + 0.12, 0.04, '#e1b13c');
  // 乗る人
  seg(hip, sh, 0.22, '#d9822b');
  seg([hip[0] + 0.02, hip[1] - 0.04], [0.02, 0.62], 0.16, '#26323f');
  limb(ctx, [hip, [0.06, 0.4], [0.0, -0.13]], 0.12, '#26323f');
  seg([-0.05, -0.16], [0.11, -0.16], 0.07, '#111');
  limb(ctx, [sh, [0.25, 0.9], [0.3, 0.68]], 0.08, '#c9741f');
  disc(ctx, 0.3, 0.67, 0.04, '#e0b48f');
  disc(ctx, 0.19, 1.3, 0.1, '#e0b48f');
  ctx.fillStyle = '#3a2a22';
  ctx.beginPath();
  ctx.arc(0.13, 1.31, 0.08, Math.PI * 0.5, Math.PI * 1.4);
  ctx.fill();
  // ヘルメット（上半分）
  ctx.fillStyle = '#f0f1ef';
  ctx.beginPath();
  ctx.ellipse(0.18, 1.35, 0.135, 0.085, -0.15, 0, Math.PI);
  ctx.fill();
  ctx.strokeStyle = '#2b2f33';
  ctx.lineWidth = 0.012;
  ctx.stroke();
  return c;
}

/** 自転車の車輪（直径 680 mm、スポーク 32 本） */
export function bikeWheel(): HTMLCanvasElement {
  const r = BIKE.wr * 1.05;
  const c = canvas(256, 256);
  const ctx = mctx(c, -r, -r, 2 * r);
  disc(ctx, 0, 0, 0.34, '#18191a');
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  disc(ctx, 0, 0, 0.3, '#000');
  ctx.restore();
  ctx.strokeStyle = '#b9bec2';
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  ctx.arc(0, 0, 0.307, 0, 7);
  ctx.stroke();
  ctx.strokeStyle = '#cfd3d6';
  ctx.lineWidth = 0.004;
  for (let k = 0; k < 32; k++) {
    const a = (k * Math.PI) / 16;
    const h = a + (k % 2 ? 0.5 : -0.5);
    ctx.beginPath();
    ctx.moveTo(0.028 * Math.cos(h), 0.028 * Math.sin(h));
    ctx.lineTo(0.298 * Math.cos(a), 0.298 * Math.sin(a));
    ctx.stroke();
  }
  disc(ctx, 0, 0, 0.035, '#8c9296');
  ctx.fillStyle = '#2b2f33';
  ctx.fillRect(0, 0.29, 0.012, 0.03);
  return c;
}

/** 使わない層（空の 4 × 4） */
export const blank = (): HTMLCanvasElement => canvas(4, 4);
