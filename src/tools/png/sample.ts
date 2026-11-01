/**
 * PNG のページの見本「イラスト」: 色の少ない平らな塗りと透明・半透明の所がある絵を、画素ごとの式で描く。
 * ぼかしを入れないので色は 256 色に収まり、パレットにできる。写真風の見本は JPEG のページの試験図を使う
 */
export const ILLUST_W = 256;
export const ILLUST_H = 192;

type C = readonly [number, number, number, number];
const SKY: C = [0, 0, 0, 0];
const SUN: C = [255, 196, 46, 255];
const RAY: C = [255, 220, 120, 255];
const HILL1: C = [92, 170, 76, 255];
const HILL2: C = [58, 128, 64, 255];
const WALL: C = [236, 228, 210, 255];
const ROOF: C = [196, 64, 52, 255];
const DOOR: C = [110, 72, 40, 255];
const WIN: C = [120, 196, 236, 255];
const LINE: C = [32, 36, 40, 255];
const SHADOW: C = [0, 0, 0, 96];
const CLOUD: C = [255, 255, 255, 200];
const GLASS: C = [80, 140, 255, 128];

/** 画素 (x, y) の色 */
function pix(x: number, y: number): C {
  const cx = x + 0.5,
    cy = y + 0.5;
  /* 半透明の青い板（右上）: 透明度の段階 */
  if (cx > 196 && cx < 244 && cy > 12 && cy < 60) {
    const k = Math.floor((cx - 196) / 12);
    if ((Math.floor(cx) + Math.floor(cy)) % 2 === 0 || k > 1) return [GLASS[0], GLASS[1], GLASS[2], 64 + k * 48];
  }
  /* 太陽と光線 */
  const dx = cx - 52,
    dy = cy - 44,
    r = Math.hypot(dx, dy);
  if (r < 20) return r > 18 ? LINE : SUN;
  if (r > 24 && r < 34) {
    const a = Math.atan2(dy, dx) / (Math.PI / 6);
    if (Math.abs(a - Math.round(a)) < 0.16) return RAY;
  }
  /* 雲（半透明の白） */
  for (const [ox, oy, rr] of [
    [120, 36, 12],
    [134, 30, 15],
    [150, 38, 11],
  ])
    if (Math.hypot(cx - ox, cy - oy) < rr && cy < 44) return CLOUD;
  /* 家 */
  if (cx >= 150 && cx < 214 && cy >= 108 && cy < 160) {
    if (cx < 151 || cx >= 213 || cy >= 159) return LINE;
    if (cx >= 172 && cx < 190 && cy >= 128) return DOOR;
    if ((cx >= 156 && cx < 168 && cy >= 118 && cy < 130) || (cx >= 196 && cx < 208 && cy >= 118 && cy < 130))
      return Math.floor(cx) === 161 || Math.floor(cy) === 123 || Math.floor(cx) === 201 ? LINE : WIN;
    return WALL;
  }
  if (cy >= 80 && cy < 108 && Math.abs(cx - 182) < (cy - 80) * 1.3 + 2)
    return Math.abs(cx - 182) > (cy - 80) * 1.3 - 1 ? LINE : ROOF;
  /* 家の影（半透明の黒） */
  if (cx >= 214 && cx < 236 && cy >= 112 && cy < 160 && cx - 214 < (cy - 112) * 0.6) return SHADOW;
  /* 丘 2 つ */
  const h1 = 150 - 22 * Math.sin((cx / 256) * Math.PI * 1.3),
    h2 = 168 - 14 * Math.cos((cx / 256) * Math.PI * 2.2);
  if (cy > h2) return Math.floor(cx / 8 + cy / 8) % 2 ? HILL2 : [HILL2[0] + 8, HILL2[1] + 10, HILL2[2] + 6, 255];
  if (cy > h1) return HILL1;
  return SKY;
}

/** 見本「イラスト」の RGBA */
export function illust(): Uint8ClampedArray {
  const d = new Uint8ClampedArray(ILLUST_W * ILLUST_H * 4);
  for (let y = 0; y < ILLUST_H; y++) for (let x = 0; x < ILLUST_W; x++) d.set(pix(x, y), (y * ILLUST_W + x) * 4);
  return d;
}
