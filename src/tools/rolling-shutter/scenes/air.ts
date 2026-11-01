/**
 * モトクロスとヘリコプターの絵。単位は m、y は上向き、地面が y = 0。
 * モトクロスは車体（車輪を除く）と車輪を車体の座標（両輪の中心の中点が原点、前が +x）で描き、シェーダが回して動かす。
 * ヘリコプターは機体だけを描き、ローターはシェーダが式で描く
 */
import { HELI, HELI_VIEW, MOTO, MOTO_VIEW } from '../motion';
import {
  canvas,
  cloud,
  disc,
  fillPoly,
  fillRr,
  grad,
  limb,
  line,
  mctx,
  radial,
  ridge,
  rng,
  sky,
  speckle,
  text,
  tree,
} from '../paint';

const BG_W = 2048;
const BG_H = 1152;

/* ===================== モトクロス ===================== */
export function motoBg(): HTMLCanvasElement {
  const c = canvas(BG_W, BG_H);
  const ctx = mctx(c, MOTO_VIEW[0], MOTO_VIEW[1], MOTO_VIEW[2]);
  const R = rng(51);
  sky(ctx, -9, -1, 18, 10.5, '#4f8ccc', '#d8e6ee');
  for (let i = 0; i < 5; i++) cloud(ctx, R, -8 + R() * 16, 6 + R() * 2, 0.8 + R() * 0.8);
  ridge(ctx, -9, 9, 0, (x) => 2.6 + 0.6 * Math.sin(x * 0.27 + 2) + 0.3 * Math.sin(x * 0.8), '#94aab3');
  ridge(ctx, -9, 9, 0, (x) => 1.9 + 0.35 * Math.sin(x * 0.43 + 0.3), '#7d9a74');
  for (let i = 0; i < 26; i++)
    tree(ctx, R, -9 + R() * 18, 1.75 + R() * 0.3, 0.35 + R() * 0.25, R() < 0.5 ? '#4e6e45' : '#5d7d50');
  // 観客席と柵の幕（文字なし）
  ctx.fillStyle = '#6b6f75';
  ctx.fillRect(-9, 1.05, 18, 0.8);
  for (let row = 0; row < 4; row++)
    for (let x = -9 + (row % 2) * 0.1; x < 9; x += 0.19) {
      if (R() < 0.25) continue;
      const y = 1.12 + row * 0.18;
      ctx.fillStyle = ['#d14b3a', '#f2f2ee', '#2f5aa6', '#f0b62e', '#2b2e33', '#3f8a4f'][(R() * 6) | 0];
      ctx.fillRect(x, y, 0.12, 0.1);
      disc(ctx, x + 0.06, y + 0.15, 0.045, ['#e0b08c', '#a87452', '#f0c9a8'][(R() * 3) | 0]);
    }
  for (let x = -9; x < 9; x += 2.4) {
    ctx.fillStyle = ['#e2552b', '#f2f2ee', '#1f4f9a'][Math.abs(Math.round(x / 2.4)) % 3];
    ctx.fillRect(x, 0.45, 2.35, 0.55);
    ctx.fillStyle = 'rgba(0,0,0,.15)';
    ctx.fillRect(x, 0.45, 2.35, 0.05);
  }
  for (let x = -9; x < 9; x += 2.4) {
    ctx.fillStyle = '#5a5f63';
    ctx.fillRect(x - 0.03, 0.4, 0.06, 0.7);
  }
  // 土のコース（わだち）
  ctx.fillStyle = grad(ctx, 0, 0.45, 0, -1, [
    [0, '#9c7a59'],
    [1, '#7d5c40'],
  ]);
  ctx.fillRect(-9, -1, 18, 1.45);
  speckle(ctx, R, -9, -1, 18, 1.45, 22000, ['#8a6a4c', '#b08c69', '#6e5038', '#a3815f'], 0.025);
  ctx.strokeStyle = 'rgba(70,48,30,.45)';
  for (let k = 0; k < 7; k++) {
    ctx.lineWidth = 0.03 + R() * 0.03;
    ctx.beginPath();
    const y = -0.85 + k * 0.17;
    for (let x = -9; x <= 9; x += 0.3) ctx.lineTo(x, y + 0.04 * Math.sin(x * 0.9 + k));
    ctx.stroke();
  }
  // 右の着地の斜面（の手前の端）
  fillPoly(
    ctx,
    [
      [6.4, 0.45],
      [9, 1.4],
      [9, -1],
      [6.4, -1],
    ],
    '#8b6a4b',
  );
  speckle(ctx, R, 6.4, -1, 2.6, 2.4, 2500, ['#7a5b3f', '#a07e5c'], 0.03);
  line(ctx, 6.4, 0.45, 9, 1.4, 0.04, '#6e5038');
  return c;
}

/** 車体と乗る人。車体の座標で x = −1.25〜1.25、y = −0.42〜1.83。後輪 (−0.74, 0)・前輪 (0.74, 0) */
export function motoBody(): HTMLCanvasElement {
  const [bx0, by0, bw] = MOTO.body;
  const c = canvas(900, 810);
  const ctx = mctx(c, bx0, by0, bw);
  type P = readonly [number, number];
  const seg = (a: P, b: P, w: number, col: string) => line(ctx, a[0], a[1], b[0], b[1], w, col);
  const plastic = '#f06a1d';
  const RH: P = [-0.74, 0];
  const FH: P = [0.74, 0];
  const piv: P = [-0.1, 0.24];
  const head: P = [0.45, 0.8];
  // 奥の脚と腕
  limb(
    ctx,
    [
      [-0.22, 0.98],
      [0.12, 0.66],
      [-0.02, 0.36],
    ],
    0.12,
    '#1d1f24',
  );
  limb(
    ctx,
    [
      [0.06, 1.36],
      [0.24, 1.2],
      [0.36, 1.04],
    ],
    0.07,
    '#2a2d33',
  );
  // スイングアームとリアサスペンション
  seg(RH, piv, 0.075, '#b9bec3');
  seg(RH, piv, 0.03, '#d8dcdf');
  seg([-0.38, 0.13], [-0.24, 0.58], 0.06, '#3a3d42');
  ctx.strokeStyle = '#f2c230';
  ctx.lineWidth = 0.018;
  ctx.beginPath();
  for (let k = 0; k <= 12; k++) {
    const u = k / 12;
    const x = -0.37 + 0.13 * u;
    const y = 0.17 + 0.38 * u;
    ctx.lineTo(x + (k % 2 ? 0.035 : -0.035), y);
  }
  ctx.stroke();
  // フレームとエンジン
  seg(piv, head, 0.05, '#3c4046');
  seg([0.05, 0.08], head, 0.05, '#3c4046');
  fillRr(ctx, -0.12, 0.08, 0.36, 0.3, 0.05, '#4a4e54');
  fillRr(ctx, 0.04, 0.32, 0.17, 0.26, 0.03, '#5a5f66');
  for (let y = 0.36; y < 0.56; y += 0.04) line(ctx, 0.05, y, 0.2, y, 0.012, '#3a3d42');
  disc(ctx, -0.04, 0.2, 0.07, '#2e3136');
  disc(ctx, -0.04, 0.2, 0.035, '#8e959b');
  // 排気管とマフラー
  limb(
    ctx,
    [
      [0.2, 0.42],
      [0.36, 0.3],
      [0.2, 0.12],
      [-0.25, 0.32],
      [-0.55, 0.62],
    ],
    0.05,
    '#7d6c5c',
  );
  fillPoly(
    ctx,
    [
      [-0.5, 0.58],
      [-0.98, 0.73],
      [-0.99, 0.82],
      [-0.52, 0.71],
    ],
    grad(ctx, 0, 0.82, 0, 0.58, [
      [0, '#d5dadd'],
      [1, '#8c9398'],
    ]),
  );
  // 後ろのフェンダー・ゼッケン・シート
  fillPoly(
    ctx,
    [
      [-0.55, 0.8],
      [-1.2, 0.98],
      [-1.18, 0.93],
      [-0.6, 0.72],
    ],
    plastic,
  );
  fillPoly(
    ctx,
    [
      [-0.62, 0.52],
      [-0.22, 0.56],
      [-0.2, 0.8],
      [-0.66, 0.76],
    ],
    '#f4f4ef',
  );
  text(ctx, '27', -0.42, 0.66, 0.2, '#1a1c20', 900, '"Arial Black", "Segoe UI", sans-serif');
  fillPoly(
    ctx,
    [
      [-0.78, 0.8],
      [0.14, 0.86],
      [0.18, 0.92],
      [-0.72, 0.88],
    ],
    '#1d1f24',
  );
  // タンクとシュラウド・ラジエーター
  fillPoly(
    ctx,
    [
      [-0.02, 0.84],
      [0.38, 0.92],
      [0.5, 0.78],
      [0.3, 0.52],
      [0.05, 0.56],
    ],
    plastic,
  );
  fillPoly(
    ctx,
    [
      [0.06, 0.6],
      [0.28, 0.57],
      [0.4, 0.74],
      [0.12, 0.76],
    ],
    '#ffffff',
  );
  line(ctx, 0.1, 0.68, 0.36, 0.7, 0.012, '#1a1c20');
  // フロントフォーク（上が金、下が黒）とフェンダー・ゼッケン・ハンドル
  seg(FH, [0.6, 0.48], 0.07, '#22252a');
  seg([0.6, 0.48], [0.43, 1.0], 0.06, '#d4a43a');
  seg([0.6, 0.48], [0.43, 1.0], 0.018, '#f2d27a');
  fillPoly(
    ctx,
    [
      [0.48, 0.5],
      [1.05, 0.47],
      [1.1, 0.52],
      [0.52, 0.56],
    ],
    plastic,
  );
  fillPoly(
    ctx,
    [
      [0.46, 0.84],
      [0.58, 0.86],
      [0.56, 1.06],
      [0.44, 1.04],
    ],
    '#f4f4ef',
  );
  seg([0.43, 1.02], [0.3, 1.06], 0.035, '#2a2d33');
  seg([0.3, 1.06], [0.26, 1.07], 0.04, '#1a1c20');
  // ステップとブーツ・脚
  seg([-0.08, 0.3], [0.04, 0.3], 0.04, '#9aa0a5');
  limb(
    ctx,
    [
      [-0.25, 0.98],
      [0.2, 0.7],
      [0.0, 0.34],
    ],
    0.15,
    '#f2f2ee',
  );
  line(ctx, 0.2, 0.7, 0.0, 0.36, 0.05, '#1a1c20');
  fillPoly(
    ctx,
    [
      [-0.08, 0.31],
      [0.13, 0.31],
      [0.1, 0.52],
      [-0.05, 0.55],
    ],
    '#f4f4f1',
  );
  fillPoly(
    ctx,
    [
      [-0.09, 0.28],
      [0.15, 0.28],
      [0.15, 0.33],
      [-0.09, 0.33],
    ],
    '#1a1c20',
  );
  // 胴（前かがみ）と腕
  limb(
    ctx,
    [
      [-0.27, 1.0],
      [0.06, 1.36],
    ],
    0.26,
    plastic,
  );
  line(ctx, -0.26, 1.0, 0.04, 1.34, 0.06, '#1a1c20');
  limb(
    ctx,
    [
      [0.07, 1.36],
      [0.3, 1.22],
      [0.34, 1.05],
    ],
    0.085,
    plastic,
  );
  disc(ctx, 0.33, 1.05, 0.045, '#1a1c20');
  // ヘルメット（ひさし・あご・ゴーグル）
  disc(ctx, 0.17, 1.55, 0.14, '#f4f4ef');
  fillPoly(
    ctx,
    [
      [0.12, 1.66],
      [0.42, 1.62],
      [0.4, 1.58],
      [0.14, 1.6],
    ],
    plastic,
  );
  fillPoly(
    ctx,
    [
      [0.22, 1.47],
      [0.37, 1.48],
      [0.33, 1.4],
      [0.2, 1.42],
    ],
    '#e2552b',
  );
  fillRr(ctx, 0.18, 1.5, 0.15, 0.07, 0.03, '#26c1d9');
  fillRr(ctx, 0.18, 1.5, 0.15, 0.07, 0.03, 'rgba(0,0,0,.25)');
  line(ctx, 0.04, 1.55, 0.2, 1.54, 0.025, '#1a1c20');
  return c;
}

/** モトクロスの車輪（ブロックタイヤ・スポーク 36 本・ブレーキディスク） */
export function motoWheel(): HTMLCanvasElement {
  const r = MOTO.wr * 1.05;
  const c = canvas(256, 256);
  const ctx = mctx(c, -r, -r, 2 * r);
  disc(ctx, 0, 0, 0.3, '#1b1c1d');
  for (let k = 0; k < 40; k++) {
    const a = (k * Math.PI) / 20;
    ctx.save();
    ctx.rotate(a);
    ctx.fillStyle = '#202122';
    ctx.fillRect(0.285, -0.022, 0.045, 0.044);
    ctx.restore();
  }
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  disc(ctx, 0, 0, 0.235, '#000');
  ctx.restore();
  ctx.strokeStyle = '#2a2c30';
  ctx.lineWidth = 0.022;
  ctx.beginPath();
  ctx.arc(0, 0, 0.226, 0, 7);
  ctx.stroke();
  ctx.strokeStyle = '#c4c9cd';
  ctx.lineWidth = 0.004;
  for (let k = 0; k < 36; k++) {
    const a = (k * Math.PI) / 18;
    const h = a + (k % 2 ? 0.45 : -0.45);
    ctx.beginPath();
    ctx.moveTo(0.05 * Math.cos(h), 0.05 * Math.sin(h));
    ctx.lineTo(0.215 * Math.cos(a), 0.215 * Math.sin(a));
    ctx.stroke();
  }
  // ブレーキディスク（穴あき）とハブ
  disc(ctx, 0, 0, 0.12, '#aab0b5');
  for (let k = 0; k < 10; k++) {
    const a = (k * Math.PI) / 5;
    disc(ctx, 0.095 * Math.cos(a), 0.095 * Math.sin(a), 0.01, '#3a3d42');
  }
  disc(ctx, 0, 0, 0.06, '#2b2e33');
  disc(ctx, 0, 0, 0.03, '#d4a43a');
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    disc(ctx, 0.045 * Math.cos(a), 0.045 * Math.sin(a), 0.006, '#c4c9cd');
  }
  return c;
}

/* ===================== ヘリコプター ===================== */
export function heliBg(): HTMLCanvasElement {
  const c = canvas(BG_W, BG_H);
  const ctx = mctx(c, HELI_VIEW[0], HELI_VIEW[1], HELI_VIEW[2]);
  const R = rng(61);
  sky(ctx, -9, -1.5, 18, 11, '#5b95cf', '#dbe7ee');
  for (let i = 0; i < 6; i++) cloud(ctx, R, -8 + R() * 16, 5.8 + R() * 2.4, 0.9 + R() * 1.0);
  ridge(ctx, -9, 9, 0, (x) => 1.9 + 0.5 * Math.sin(x * 0.31 + 1.2) + 0.25 * Math.sin(x * 0.9), '#9fb3bd');
  ridge(ctx, -9, 9, 0, (x) => 1.25 + 0.2 * Math.sin(x * 0.5 + 2), '#86a07e');
  for (let i = 0; i < 30; i++)
    tree(ctx, R, -9 + R() * 18, 1.0 + R() * 0.3, 0.3 + R() * 0.2, R() < 0.5 ? '#4b6b44' : '#5a7a4f');
  // 草地とヘリポートの印
  ctx.fillStyle = grad(ctx, 0, 1.1, 0, -0.3, [
    [0, '#86a865'],
    [1, '#6f9150'],
  ]);
  ctx.fillRect(-9, -1.5, 18, 2.6);
  speckle(ctx, R, -9, -1.5, 18, 2.6, 26000, ['#7a9c58', '#93b672', '#688a4b'], 0.03);
  ctx.save();
  ctx.translate(0.6, 0.15);
  ctx.scale(1, 0.18);
  ctx.strokeStyle = 'rgba(245,245,238,.85)';
  ctx.lineWidth = 0.25;
  ctx.beginPath();
  ctx.arc(0, 0, 3.2, 0, 7);
  ctx.stroke();
  ctx.restore();
  // 機体の影
  ctx.save();
  ctx.translate(-0.8, 0.2);
  ctx.scale(1, 0.12);
  disc(
    ctx,
    0,
    0,
    4.5,
    radial(ctx, 0, 0, 4.5, [
      [0.3, 'rgba(20,30,10,.35)'],
      [1, 'rgba(20,30,10,0)'],
    ]),
  );
  ctx.restore();
  return c;
}

/** 機体（ローターを除く）。範囲は HELI.body。前は +x */
export function heliBody(): HTMLCanvasElement {
  const [bx0, by0, bw] = HELI.body;
  const c = canvas(2048, 520);
  const ctx = mctx(c, bx0, by0, bw);
  const red = '#c9362b';
  // そり（奥と手前）と支柱
  const skid = (y: number, col: string, w: number) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(-1.9, y);
    ctx.lineTo(2.2, y);
    ctx.quadraticCurveTo(2.6, y, 2.7, y + 0.22);
    ctx.stroke();
  };
  skid(0.85, '#5c6166', 0.07);
  line(ctx, -1.1, 0.85, -0.9, 1.3, 0.07, '#6f7479');
  line(ctx, 1.3, 0.85, 1.1, 1.3, 0.07, '#6f7479');
  // テールブームと尾翼
  fillPoly(
    ctx,
    [
      [-1.4, 2.72],
      [-7.05, 2.62],
      [-7.05, 2.42],
      [-1.4, 2.05],
    ],
    grad(ctx, 0, 2.72, 0, 2.05, [
      [0, '#f2f2ee'],
      [1, '#c9cbcd'],
    ]),
  );
  line(ctx, -1.4, 2.4, -7.0, 2.53, 0.06, red);
  fillPoly(
    ctx,
    [
      [-6.55, 2.55],
      [-7.35, 3.55],
      [-7.65, 3.55],
      [-7.25, 2.45],
      [-7.4, 1.95],
      [-7.15, 1.95],
      [-6.75, 2.42],
    ],
    red,
  );
  fillPoly(
    ctx,
    [
      [-5.5, 2.52],
      [-6.2, 2.6],
      [-6.2, 2.5],
      [-5.5, 2.44],
    ],
    '#8f2219',
  );
  // 胴（キャビンとエンジン）
  ctx.beginPath();
  ctx.moveTo(-1.7, 2.75);
  ctx.lineTo(-1.6, 1.55);
  ctx.quadraticCurveTo(-1.5, 1.2, -0.9, 1.18);
  ctx.lineTo(2.6, 1.18);
  ctx.bezierCurveTo(3.6, 1.2, 4.2, 1.5, 4.25, 1.95);
  ctx.bezierCurveTo(4.25, 2.4, 3.6, 2.82, 2.4, 2.88);
  ctx.lineTo(-1.0, 2.9);
  ctx.closePath();
  ctx.fillStyle = grad(ctx, 0, 2.9, 0, 1.18, [
    [0, '#f4f4f0'],
    [0.5, '#e3e4e2'],
    [0.62, red],
    [1, '#9c2a21'],
  ]);
  ctx.fill();
  // 窓（前のバブルとドア）
  ctx.beginPath();
  ctx.moveTo(2.15, 2.78);
  ctx.bezierCurveTo(3.4, 2.74, 4.1, 2.35, 4.15, 1.95);
  ctx.bezierCurveTo(4.1, 1.65, 3.7, 1.45, 3.2, 1.5);
  ctx.lineTo(2.2, 1.85);
  ctx.closePath();
  ctx.fillStyle = grad(ctx, 2.2, 2.8, 4.1, 1.6, [
    [0, '#2e4a5e'],
    [0.5, '#5d8299'],
    [1, '#1f3443'],
  ]);
  ctx.fill();
  fillRr(
    ctx,
    0.5,
    1.95,
    1.45,
    0.78,
    0.12,
    grad(ctx, 0, 2.73, 0, 1.95, [
      [0, '#4d7189'],
      [1, '#22394a'],
    ]),
  );
  fillPoly(
    ctx,
    [
      [2.6, 2.7],
      [3.3, 2.62],
      [2.9, 1.9],
      [2.4, 2.0],
    ],
    'rgba(220,235,245,.18)',
  );
  line(ctx, 0.35, 1.2, 0.35, 2.85, 0.02, 'rgba(0,0,0,.3)');
  line(ctx, 2.05, 1.2, 2.05, 2.85, 0.02, 'rgba(0,0,0,.3)');
  fillRr(ctx, 1.75, 1.75, 0.18, 0.04, 0.02, '#9aa0a4');
  // エンジンのカウルと排気口・マスト
  fillRr(
    ctx,
    -1.25,
    2.82,
    2.3,
    0.3,
    0.12,
    grad(ctx, 0, 3.12, 0, 2.82, [
      [0, '#d9dad8'],
      [1, '#b7b9b8'],
    ]),
  );
  for (let x = -1.0; x < 0.8; x += 0.12) line(ctx, x, 2.88, x, 3.04, 0.02, 'rgba(60,64,66,.35)');
  fillRr(ctx, -1.55, 2.86, 0.32, 0.2, 0.06, '#2d2f31');
  line(ctx, HELI.mast[0], 3.05, HELI.mast[0], HELI.mast[1], 0.12, '#3b3f43');
  fillRr(ctx, HELI.mast[0] - 0.2, 3.02, 0.4, 0.08, 0.03, '#55595d');
  // 手前のそりと支柱
  line(ctx, -0.95, 0.8, -0.65, 1.25, 0.08, '#878c90');
  line(ctx, 1.45, 0.8, 1.2, 1.25, 0.08, '#878c90');
  skid(0.78, '#7d8287', 0.09);
  // テールローターの軸
  disc(ctx, HELI.tail[0], HELI.tail[1], 0.09, '#3b3f43');
  return c;
}
