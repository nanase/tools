/**
 * 見本の画像（試験図）を canvas に描く。JPEG が苦手なもの・得意なものを 1 枚に並べる:
 * なめらかな面（空のグラデーションと肌色の球）、色の境目（カラーバー、青地に赤い文字）、灰色の階調、
 * 文字、細かい模様（ゾーンプレート、ジーメンススター、1 画素の縞と市松、細い線）
 */
export const SAMPLE_W = 512;
export const SAMPLE_H = 384;
/** 初めに選ぶブロック（Y のブロックの位置）: 「JPEG」の J の縦線の左の縁（縦の境目なので、係数は横の周波数だけに出る） */
export const SAMPLE_BLOCK: readonly [number, number] = [5, 28];

const FONT =
  'system-ui,"Segoe UI","Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic UI",Meiryo,sans-serif';

/** 画素ごとに決める模様（w×h の領域に v(x, y) の灰色） */
function gray(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  w: number,
  h: number,
  v: (x: number, y: number) => number,
): void {
  const im = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const g = v(x, y),
        i = (y * w + x) * 4;
      im.data[i] = im.data[i + 1] = im.data[i + 2] = g;
      im.data[i + 3] = 255;
    }
  ctx.putImageData(im, x0, y0);
}

export function drawSample(ctx: CanvasRenderingContext2D): void {
  const W = SAMPLE_W,
    H = SAMPLE_H;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  /* 左上: 空のグラデーション、雲、肌色の球 */
  const sky = ctx.createLinearGradient(0, 0, 0, 192);
  sky.addColorStop(0, '#2c6bb8');
  sky.addColorStop(0.65, '#9cc5e8');
  sky.addColorStop(1, '#dcebf5');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 256, 192);
  for (const [cx, cy, r, a] of [
    [60, 48, 34, 0.75],
    [92, 40, 28, 0.7],
    [118, 54, 24, 0.6],
    [200, 30, 20, 0.45],
  ] as const) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  }
  const skin = ctx.createRadialGradient(150, 112, 6, 168, 132, 62);
  skin.addColorStop(0, '#fbe3d0');
  skin.addColorStop(0.45, '#eebc98');
  skin.addColorStop(0.85, '#c98563');
  skin.addColorStop(1, '#a8654a');
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(168, 132, 54, 0, Math.PI * 2);
  ctx.fill();

  /* 右上: カラーバー（境目は 8 の倍数にそろえない） */
  const bars = ['#ffffff', '#ffff00', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#0000ff', '#000000'],
    widths = [36, 30, 34, 28, 34, 30, 32, 32];
  let bx = 256;
  bars.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(bx, 0, widths[i], 96);
    bx += widths[i];
  });
  /* その下: なめらかな灰色の階調と、8 段の階段 */
  gray(ctx, 256, 96, 256, 48, (x) => x);
  for (let i = 0; i < 8; i++) {
    const v = Math.round((i * 255) / 7);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(256 + i * 32, 144, 32, 48);
  }

  /* 左下: 文字 */
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 192, 256, 192);
  ctx.fillStyle = '#111111';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 64px ${FONT}`;
  ctx.fillText('JPEG', 14, 254);
  ctx.font = `500 28px ${FONT}`;
  ctx.fillText('画像の圧縮', 14, 292);
  ctx.fillStyle = '#1d3fbf';
  ctx.fillRect(0, 304, 256, 34);
  ctx.fillStyle = '#ff2a2a';
  ctx.font = `700 22px ${FONT}`;
  ctx.fillText('色の境目 RGB', 12, 329);
  ctx.fillStyle = '#111111';
  ctx.font = `400 13px ${FONT}`;
  ctx.fillText('8×8 DCT・量子化・ハフマン符号', 12, 358);
  ctx.font = `400 10px ${FONT}`;
  ctx.fillText('The quick brown fox jumps 0123456789', 12, 376);

  /* 右下: ゾーンプレート（端でナイキスト周波数に近づく）とジーメンススター */
  gray(ctx, 256, 192, 128, 128, (x, y) => {
    const dx = x - 63.5,
      dy = y - 63.5;
    return Math.round(127.5 + 127.5 * Math.cos((Math.PI * (dx * dx + dy * dy)) / 180));
  });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(384, 192, 128, 128);
  ctx.fillStyle = '#000000';
  const n = 24;
  for (let i = 0; i < n; i += 2) {
    ctx.beginPath();
    ctx.moveTo(448, 256);
    ctx.arc(448, 256, 60, (i * 2 * Math.PI) / n, ((i + 1) * 2 * Math.PI) / n);
    ctx.closePath();
    ctx.fill();
  }
  /* 最下段: 1 画素の縦縞、2 画素の横縞、1 画素の市松、細い線の扇 */
  gray(ctx, 256, 320, 64, 64, (x) => (x % 2 ? 0 : 255));
  gray(ctx, 320, 320, 64, 64, (_x, y) => ((y >> 1) % 2 ? 0 : 255));
  gray(ctx, 384, 320, 64, 64, (x, y) => ((x + y) % 2 ? 0 : 255));
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(448, 320, 64, 64);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(450, 382);
    ctx.lineTo(450 + 62 * Math.cos(a), 382 - 62 * Math.sin(a));
    ctx.stroke();
  }
  ctx.restore();
}
