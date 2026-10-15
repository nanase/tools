/**
 * 地上から見た空を描く: 望遠（太陽のまわり数度）と、地平線を入れた広角の 2 つ
 *
 * 太陽面は周辺減光（Hestroffer & Magnan 1998 のべき乗則、RGB の 3 波長）、
 * コロナは Baumbach (1937) の動径の輝度に、筋と扁平（Ludendorff の扁平率）を掛けた手続き的な合成。
 * 明るさは対数で表示する（10⁻⁹·³〜10⁻⁵ を 0〜1 に。太陽面の中心 = 1）
 */
import type { Disks } from './local';
import { limbAlpha } from './shade';

const ALPHA_RGB = [limbAlpha(0.61), limbAlpha(0.55), limbAlpha(0.465)];

/** Baumbach (1937) の K + F コロナの輝度（太陽面の中心 = 1）。r は太陽半径を単位とした距離 */
export const baumbach = (r: number) => 1e-6 * (0.0532 * r ** -2.5 + 1.425 * r ** -7 + 2.565 * r ** -17);

/** 決まった種から作る擬似乱数（日食ごとに同じコロナにするため） */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export interface Corona {
  /** 太陽の自転軸の位置角（北から東へ）[rad] */
  axis: number;
  /** 太陽活動の位相: 0 で極小（扁平で赤道に筋）、1 で極大（丸く全方位に筋） */
  activity: number;
  /** 筋（ストリーマ）: 位置角 [rad]、幅 [rad]、強さ */
  streamers: { pa: number; w: number; a: number }[];
  /** 細かい放射状の筋の位相 */
  rays: { k: number; ph: number; a: number }[];
  /** 紅炎: 位置角、幅 [rad]、高さ（太陽半径） */
  proms: { pa: number; w: number; h: number }[];
}

export function makeCorona(seed: number, axis: number, activity: number): Corona {
  const r = rng(seed);
  const streamers: Corona['streamers'] = [];
  const n = 4 + Math.round(activity * 4);
  for (let k = 0; k < n; k++) {
    // 極小期は赤道（自転軸から ±90°）の近くに集まる
    const side = k % 2 === 0 ? Math.PI / 2 : -Math.PI / 2;
    const spread = 0.35 + activity * 1.1;
    streamers.push({ pa: axis + side + (r() - 0.5) * 2 * spread, w: 0.12 + r() * 0.2, a: 1.2 + r() * 2.5 });
  }
  const rays: Corona['rays'] = [];
  for (let k = 0; k < 10; k++) rays.push({ k: 5 + Math.floor(r() * 40), ph: r() * 2 * Math.PI, a: 0.02 + r() * 0.04 });
  const proms: Corona['proms'] = [];
  for (let k = 0; k < 3 + Math.round(activity * 3); k++)
    proms.push({ pa: r() * 2 * Math.PI, w: 0.03 + r() * 0.05, h: 0.05 + r() * 0.08 });
  return { axis, activity, streamers, rays, proms };
}

/** 位置角 pa・距離 r（太陽半径）でのコロナの輝度 */
export function coronaAt(c: Corona, r: number, pa: number): number {
  // 扁平: 極の向きの距離を伸ばして測る（極小期ほど強い）
  const lat = pa - c.axis;
  const flat = 0.24 * (1 - c.activity) + 0.06;
  const cl = Math.cos(lat);
  const re = r * (1 + flat * 1.6 * cl * cl);
  let s = 1;
  for (const st of c.streamers) {
    let d = Math.abs(pa - st.pa) % (2 * Math.PI);
    if (d > Math.PI) d = 2 * Math.PI - d;
    // 筋は外ほど細く尖る
    const wr = st.w / Math.sqrt(r);
    s += st.a * Math.exp(-((d / wr) ** 2)) * Math.min(1, (r - 1) * 1.5);
  }
  let ray = 1;
  for (const q of c.rays) ray += q.a * Math.sin(q.k * pa + q.ph);
  // 極小期の極の羽毛（プルーム）
  const plume = (1 - c.activity) * 0.5 * Math.max(0, cl * cl * cl * cl) * (0.6 + 0.4 * Math.sin(40 * pa));
  return baumbach(re) * s * ray * (1 + plume);
}

const LOG_LO = -9.1;
const LOG_HI = -5.1;
const toneLog = (v: number) =>
  Math.max(0, Math.min(1, (Math.log10(Math.max(v, 1e-12)) - LOG_LO) / (LOG_HI - LOG_LO))) ** 1.35;

export interface SunScene {
  w: number;
  h: number;
  /** 画面の短い辺の半分が表す角度 [rad] */
  half: number;
  disks: Disks;
  /** 天頂の位置角 [rad]（画面の上を天頂にする） */
  zen: number;
  /** 周辺減光を入れた残光 F */
  flux: number;
  corona: Corona;
  /** 減光フィルターを使う境目の F（これより明るいとフィルター越しに描く） */
  filterAbove?: number;
}

/** 望遠の眺め。部分食は減光フィルター越し、皆既の前後は肉眼（コロナ・彩層・紅炎・ダイヤモンドリング） */
export function drawSun(ctx: CanvasRenderingContext2D, sc: SunScene): { filtered: boolean } {
  const { w, h, disks: dk } = sc;
  const R = Math.min(w, h) / 2;
  const pxPerRad = R / sc.half;
  const rs = dk.sun * dk.scale * pxPerRad;
  const rm = dk.moon * dk.scale * pxPerRad;
  // 月の中心の画面での位置（天頂が上、東が左）
  const ang = dk.pa - sc.zen;
  const mx = w / 2 - Math.sin(ang) * dk.sep * dk.scale * pxPerRad;
  const my = h / 2 - Math.cos(ang) * dk.sep * dk.scale * pxPerRad;
  const filtered = sc.flux > (sc.filterAbove ?? 2e-3);
  const img = ctx.createImageData(w, h);
  const px = img.data;
  // ダイヤモンドリングのぎらつき: 残った光球の重心のあたりから広がる
  let gx = 0;
  let gy = 0;
  if (!filtered && sc.flux > 0) {
    const d = Math.hypot(mx - w / 2, my - h / 2) || 1;
    gx = w / 2 - ((mx - w / 2) / d) * rs;
    gy = h / 2 - ((my - h / 2) / d) * rs;
  }
  const sky = filtered ? 0 : 6e-10 + sc.flux * 3e-6;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const dx = x + 0.5 - w / 2;
      const dy = y + 0.5 - h / 2;
      const r = Math.hypot(dx, dy) / rs;
      const inMoon = Math.hypot(x + 0.5 - mx, y + 0.5 - my) < rm;
      let R0 = 0;
      let G0 = 0;
      let B0 = 0;
      if (filtered) {
        // フィルター越し: 光球だけが見える
        if (r < 1 && !inMoon) {
          const mu = Math.sqrt(1 - r * r);
          R0 = 255 * mu ** ALPHA_RGB[0];
          G0 = 236 * mu ** ALPHA_RGB[1];
          B0 = 205 * mu ** ALPHA_RGB[2];
        }
        px[o] = R0;
        px[o + 1] = G0;
        px[o + 2] = B0;
        px[o + 3] = 255;
        continue;
      }
      // 肉眼: 輝度を足してから対数で表示する
      let I = sky;
      let pink = 0;
      if (!inMoon) {
        if (r < 1) I += 1;
        else {
          // 天頂の向きを上にした画面の角度から、天の北から東への位置角へ
          const pa = Math.atan2(-dx, -dy) + sc.zen;
          I += coronaAt(sc.corona, r, pa);
          // 彩層（厚さ約 3″ ＝ 太陽半径の 0.3 %）と紅炎
          const rr = r - 1;
          if (rr < 0.012) pink += 2e-4 * Math.exp(-rr / 0.004);
          for (const p of sc.corona.proms) {
            let d = Math.abs(pa - p.pa) % (2 * Math.PI);
            if (d > Math.PI) d = 2 * Math.PI - d;
            if (d < p.w && rr < p.h) pink += 6e-5 * (1 - d / p.w) * (1 - rr / p.h) ** 0.5;
          }
        }
      } else I = sky * 0.4;
      if (sc.flux > 0) {
        // 残った光球の光を、目やカメラのにじみ（Moffat 型）で広げる。太陽面の明るさで規格化
        const dg = Math.hypot(x + 0.5 - gx, y + 0.5 - gy) / rs;
        I += sc.flux * (0.5 * (1 + (dg / 0.04) ** 2) ** -1.5 + 0.02 * (1 + (dg / 0.5) ** 2) ** -1.5);
      }
      const v = toneLog(I);
      const vp = toneLog(pink + I) - v;
      // 空は青、コロナは白、彩層と紅炎は Hα の赤
      const blue = Math.max(0, 1 - toneLog(I) * 2.2);
      px[o] = 255 * Math.min(1, v * (1 - 0.55 * blue) + vp * 1.0);
      px[o + 1] = 255 * Math.min(1, v * (1 - 0.35 * blue) + vp * 0.25);
      px[o + 2] = 255 * Math.min(1, v + vp * 0.45);
      px[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { filtered };
}

export interface SkyScene {
  w: number;
  h: number;
  /** 画面の左右の方位 [rad]（北から東へ）と、上下の高度 [rad] */
  az0: number;
  az1: number;
  alt0: number;
  alt1: number;
  sunAlt: number;
  sunAz: number;
  /** 見かけの太陽の半径 [rad]、月の中心のずれ（画面の右・上へ）[rad]、月の半径 [rad] */
  sunR: number;
  moonDx: number;
  moonDy: number;
  moonR: number;
  flux: number;
  /** 本影の中にいるか */
  total: boolean;
  /** 地平線の山の形の種 */
  seed: number;
}

/** 広角の空: 空の明るさは残光 F（皆既では 10⁻⁴ の底と 360° の地平の夕焼け）を対数で表示する */
export function drawSky(ctx: CanvasRenderingContext2D, sc: SkyScene) {
  const { w, h } = sc;
  const img = ctx.createImageData(w, h);
  const px = img.data;
  // 目の順応を考えて、空の明るさ B（昼 = 1）を対数で表示の明るさ e に直す
  const B = sc.total ? 1e-4 : Math.max(sc.flux, 1e-4);
  const e = Math.max(0.05, Math.min(1, 1 + Math.log10(B) / 4.6));
  const m = sc.total ? 1 : Math.max(0, 1 - sc.flux / 0.01);
  const r = rng(sc.seed);
  const ridge = (n: number, amp: number, base: number) => {
    const ph = [r() * 6, r() * 6, r() * 6, r() * 6];
    const out: number[] = [];
    for (let x = 0; x < w; x++) {
      const u = (sc.az0 + ((x + 0.5) / w) * (sc.az1 - sc.az0)) * n;
      out.push(
        base +
          amp *
            (Math.sin(u * 3 + ph[0]) +
              0.6 * Math.sin(u * 7 + ph[1]) +
              0.3 * Math.sin(u * 17 + ph[2]) +
              0.12 * Math.sin(u * 41 + ph[3])),
      );
    }
    return out;
  };
  const far = ridge(1, 0.008, 0.02);
  const near = ridge(1.7, 0.006, 0.006);
  const altAt = (y: number) => sc.alt1 - ((y + 0.5) / h) * (sc.alt1 - sc.alt0);
  const azAt = (x: number) => sc.az0 + ((x + 0.5) / w) * (sc.az1 - sc.az0);
  const kx = w / (sc.az1 - sc.az0);
  const ky = h / (sc.alt1 - sc.alt0);
  const sx = (sc.sunAz - sc.az0) * kx;
  const sy = (sc.alt1 - sc.sunAlt) * ky;
  for (let y = 0; y < h; y++) {
    const alt = altAt(y);
    const a = Math.max(0, alt) / (Math.PI / 2);
    const glow = Math.exp(-Math.max(0, alt) / (9 * (Math.PI / 180)));
    // 昼の空（天頂は青、地平は白っぽい）と皆既の空（天頂は濃い藍、地平の 10° ほどが橙）
    const day = [70 + 116 * (1 - a) ** 3, 118 + 90 * (1 - a) ** 3, 196 + 36 * (1 - a) ** 2];
    const tot = [34 + 200 * glow, 52 + 110 * glow, 110 - 30 * glow];
    const kd = e * (1 - m);
    const kt = m * (0.42 + 0.58 * glow);
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      px[o + 3] = 255;
      if (alt < near[x] || alt < far[x]) {
        // 山: 遠い稜線は空に溶け、手前は暗い
        const g = alt < near[x] ? 0.2 : 0.42;
        const lum = e * (1 - m) + m * 0.3;
        px[o] = (60 + 40 * g) * g * lum * 1.6;
        px[o + 1] = (74 + 40 * g) * g * lum * 1.6;
        px[o + 2] = (80 + 60 * g) * g * lum * 1.6;
        continue;
      }
      let R0 = day[0] * kd + tot[0] * kt;
      let G0 = day[1] * kd + tot[1] * kt;
      let B0 = day[2] * kd + tot[2] * kt;
      const d = Math.hypot((azAt(x) - sc.sunAz) * Math.cos(sc.sunAlt), alt - sc.sunAlt);
      const dr = d / sc.sunR;
      if (!sc.total) {
        // 部分食の太陽はまぶしく、欠けは目では見えない
        const f = Math.max(0, Math.min(1, 0.4 + 0.6 * (1 + Math.log10(Math.max(sc.flux, 1e-6)) / 3)));
        const glare = f * (1.2 / (1 + (dr / 2.5) ** 2) + 0.35 / (1 + (dr / 14) ** 2));
        R0 += 255 * glare;
        G0 += 252 * glare;
        B0 += 240 * glare;
      } else if (dr > 1.02) {
        const cor = Math.min(1, 1.3 * dr ** -2.4);
        R0 += 236 * cor;
        G0 += 238 * cor;
        B0 += 246 * cor;
      }
      px[o] = Math.min(255, R0);
      px[o + 1] = Math.min(255, G0);
      px[o + 2] = Math.min(255, B0);
    }
  }
  ctx.putImageData(img, 0, 0);
  // 方位と高度の目盛り
  ctx.save();
  ctx.font = '500 11px "Fira Mono", ui-monospace, monospace';
  ctx.fillStyle = sc.total || sc.flux < 0.2 ? 'rgba(230,232,228,0.75)' : 'rgba(20,28,36,0.7)';
  ctx.strokeStyle = sc.total || sc.flux < 0.2 ? 'rgba(230,232,228,0.14)' : 'rgba(20,28,36,0.10)';
  ctx.lineWidth = 1;
  const names = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
  for (let az = 0; az < 360; az += 15) {
    const x = (az * (Math.PI / 180) - sc.az0) * kx;
    if (x < 0 || x > w) continue;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, (sc.alt1 - 0) * ky);
    ctx.stroke();
    const label = az % 45 === 0 ? `${names[az / 45]} ${az}°` : `${az}°`;
    ctx.fillText(label, x + 4, (sc.alt1 - 0) * ky - 30);
  }
  for (let alt = 10; alt * (Math.PI / 180) < sc.alt1; alt += 10) {
    const y = (sc.alt1 - alt * (Math.PI / 180)) * ky;
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
    ctx.stroke();
    ctx.fillText(`${alt}°`, 6, y - 4);
  }
  ctx.restore();
  if (sc.total) {
    // 皆既: 月の黒い円盤
    ctx.beginPath();
    ctx.arc(sx + sc.moonDx * kx, sy - sc.moonDy * ky, Math.max(2, sc.moonR * kx), 0, 2 * Math.PI);
    ctx.fillStyle = '#05070c';
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(2.4, sc.sunR * kx), 0, 2 * Math.PI);
    ctx.fillStyle = '#fffef8';
    ctx.fill();
  }
}
