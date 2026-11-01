/**
 * ゴルフの絵: 背景（動かない）と、腕を除いた体（動かない。クラブが体の後ろを通るときのために別の層）。
 * 腕・クラブ・球はシェーダが式で描く。単位は m、y は上向き、地面が y = 0
 */
import { GOLF, GOLF_BALL0, GOLF_VIEW } from '../motion';
import {
  canvas,
  cloud,
  disc,
  ellipse,
  fillPoly,
  fillRr,
  grad,
  limb,
  line,
  mctx,
  radial,
  rng,
  sky,
  speckle,
  tree,
} from '../paint';

/** 体の層の範囲（背景と同じ。体だけを描いて残りは透明） */
const BG_W = 2048;
const BG_H = 1152;

/* 腕の色（シェーダと合わせる） */
export const GOLF_SHIRT = '#d8443a';
export const SKIN = '#e2ae8a';

/* ===================== ゴルフ（正面から） ===================== */
export function golfBg(): HTMLCanvasElement {
  const c = canvas(BG_W, BG_H);
  let ctx = mctx(c, GOLF_VIEW[0], GOLF_VIEW[1], GOLF_VIEW[2]);
  const R = rng(31);
  sky(ctx, -2.2, -0.3, 4.4, 2.6, '#6fa3d6', '#dfe9ee');
  for (let i = 0; i < 4; i++) cloud(ctx, R, -2 + R() * 4, 1.6 + R() * 0.5, 0.25 + R() * 0.2);
  // 遠くの丘と木立
  ctx.fillStyle = '#9db7a8';
  ctx.beginPath();
  ctx.moveTo(-2.2, 0.6);
  for (let x = -2.2; x <= 2.21; x += 0.05)
    ctx.lineTo(x, 0.98 + 0.08 * Math.sin(x * 2.1 + 0.5) + 0.04 * Math.sin(x * 5.3));
  ctx.lineTo(2.2, 0.6);
  ctx.fill();
  for (let i = 0; i < 70; i++) {
    const x = -2.2 + R() * 4.4;
    tree(ctx, R, x, 0.68 + R() * 0.12, 0.09 + R() * 0.07, R() < 0.5 ? '#3f6440' : '#4d7548');
  }
  // フェアウェイ（刈り目の帯）
  for (let k = 0; k < 14; k++) {
    const y0 = 0.72 - 0.97 * (1 - Math.exp(-k * 0.14));
    const y1 = 0.72 - 0.97 * (1 - Math.exp(-(k + 1) * 0.14));
    ctx.fillStyle = k % 2 ? '#6f9a4c' : '#7ea957';
    ctx.fillRect(-2.2, y1, 4.4, y0 - y1);
  }
  ctx.fillStyle = '#6f9a4c';
  ctx.fillRect(-2.2, -0.3, 4.4, 0.06);
  speckle(ctx, R, -2.2, -0.3, 4.4, 1.0, 9000, ['#5f8a40', '#86b25e', '#6d9649'], 0.006);
  // 人物を目立たせるため、背景はぼかして淡くする（ぼかしの効かないブラウザでは淡くするだけ）
  const soft = canvas(BG_W, BG_H);
  const sc = soft.getContext('2d');
  if (!sc) return c;
  sc.filter = 'blur(9px) saturate(0.6)';
  sc.drawImage(c, -24, -24, BG_W + 48, BG_H + 48);
  sc.filter = 'none';
  sc.fillStyle = 'rgba(238,242,244,.42)';
  sc.fillRect(0, 0, BG_W, BG_H);
  ctx = mctx(soft, GOLF_VIEW[0], GOLF_VIEW[1], GOLF_VIEW[2]);
  // ティーグラウンドの影と、ティー（木）
  ctx.save();
  ctx.translate(0, 0.01);
  ctx.scale(1, 0.12);
  disc(
    ctx,
    0,
    0,
    0.55,
    radial(ctx, 0, 0, 0.55, [
      [0.2, 'rgba(0,0,0,.22)'],
      [1, 'rgba(0,0,0,0)'],
    ]),
  );
  ctx.restore();
  const bx = GOLF_BALL0[0];
  fillPoly(
    ctx,
    [
      [bx - 0.004, -0.01],
      [bx + 0.004, -0.01],
      [bx + 0.003, 0.01],
      [bx + 0.01, 0.014],
      [bx - 0.01, 0.014],
      [bx - 0.003, 0.01],
    ],
    '#e9d7b0',
  );
  return soft;
}

/** 正面から見たゴルファー（腕なし）。帽子のつばはボールへ向く */
export function golfBody(): HTMLCanvasElement {
  const c = canvas(BG_W, BG_H);
  const ctx = mctx(c, GOLF_VIEW[0], GOLF_VIEW[1], GOLF_VIEW[2]);
  const [sl, sr] = GOLF.shoulders;
  // 脚（ズボン）と靴
  const pants = '#2f3d57';
  limb(
    ctx,
    [
      [-0.12, 0.9],
      [-0.19, 0.5],
      [-0.25, 0.09],
    ],
    0.16,
    pants,
  );
  limb(
    ctx,
    [
      [0.12, 0.9],
      [0.19, 0.5],
      [0.25, 0.09],
    ],
    0.16,
    pants,
  );
  line(ctx, -0.16, 0.86, -0.21, 0.2, 0.01, 'rgba(255,255,255,.12)');
  line(ctx, 0.16, 0.86, 0.21, 0.2, 0.01, 'rgba(0,0,0,.2)');
  for (const s of [-1, 1]) {
    ellipse(ctx, s * 0.27, 0.035, 0.12, 0.045, 0, '#f2f2ef');
    ellipse(ctx, s * 0.27, 0.012, 0.125, 0.018, 0, '#2a2c2e');
  }
  // 腰とベルト
  fillRr(ctx, -0.17, 0.82, 0.34, 0.16, 0.05, pants);
  ctx.fillStyle = '#1b1c1e';
  ctx.fillRect(-0.165, 0.93, 0.33, 0.04);
  ctx.fillStyle = '#c9b37a';
  ctx.fillRect(-0.025, 0.935, 0.05, 0.03);
  // 胴（ポロシャツ）
  ctx.beginPath();
  ctx.moveTo(-0.16, 0.95);
  ctx.lineTo(0.16, 0.95);
  ctx.bezierCurveTo(0.19, 1.15, 0.21, 1.3, sr[0] + 0.04, sr[1] - 0.02);
  ctx.quadraticCurveTo(sr[0], sr[1] + 0.05, 0.07, sr[1] + 0.05);
  ctx.lineTo(-0.07, sl[1] + 0.05);
  ctx.quadraticCurveTo(sl[0], sl[1] + 0.05, sl[0] - 0.04, sl[1] - 0.02);
  ctx.bezierCurveTo(-0.21, 1.3, -0.19, 1.15, -0.16, 0.95);
  ctx.fillStyle = grad(ctx, -0.22, 0, 0.22, 0, [
    [0, '#b8342c'],
    [0.45, GOLF_SHIRT],
    [1, '#a92f28'],
  ]);
  ctx.fill();
  // 襟と首と頭
  fillPoly(
    ctx,
    [
      [-0.07, 1.49],
      [0.07, 1.49],
      [0.05, 1.42],
      [0, 1.39],
      [-0.05, 1.42],
    ],
    '#f1f1ee',
  );
  ctx.fillStyle = SKIN;
  ctx.fillRect(-0.04, 1.46, 0.08, 0.07);
  ellipse(ctx, 0, 1.6, 0.085, 0.105, 0, SKIN);
  ellipse(ctx, -0.085, 1.6, 0.018, 0.03, 0, '#d39a77');
  ellipse(ctx, 0.085, 1.6, 0.018, 0.03, 0, '#d39a77');
  // 帽子（うつむいているので上が見える）とつば
  ctx.fillStyle = '#1f2e4a';
  ctx.beginPath();
  ctx.ellipse(0, 1.64, 0.092, 0.085, 0, 0, Math.PI);
  ctx.fill();
  ellipse(ctx, 0, 1.635, 0.1, 0.03, 0, '#17233a');
  ellipse(ctx, 0, 1.55, 0.03, 0.012, 0, '#c9906f');
  return c;
}
