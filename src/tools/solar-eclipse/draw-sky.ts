/**
 * 地上から見た空を描く: 望遠（太陽のまわり数度）と、地平線を入れた広角の 2 つ
 *
 * 太陽面は周辺減光（Hestroffer & Magnan 1998 のべき乗則、RGB の 3 波長）、
 * コロナは Baumbach (1937) の動径の輝度に、筋と扁平（Ludendorff の扁平率）を掛けた手続き的な合成。
 * コロナの明るさは対数で表示する（10⁻⁹·¹〜10⁻⁵·¹ を 0〜1 に。太陽面の中心 = 1）。
 * 太陽面・コロナ・彩層は日食ごとに 1 度だけ画像にし、毎回は回して重ねるだけにする
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
  /** 作った種（同じ種なら同じ画像を使い回す） */
  seed: number;
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
  return { seed, axis, activity, streamers, rays, proms };
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

type Canvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function canvas(w: number, h: number): Canvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
const ctxOf = (c: Canvas) => c.getContext('2d') as Ctx2D;

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
export class SunPainter {
  private key = '';
  private disk: Canvas | null = null;
  private corona: Canvas | null = null;
  private chromo: Canvas | null = null;

  /** 太陽面（周辺減光）、コロナと彩層・紅炎（天の北が上）の画像を作る */
  private build(sc: SunScene, rs: number) {
    const key = `${sc.w}x${sc.h}:${rs}:${sc.corona.seed}`;
    if (key === this.key) return;
    this.key = key;
    const n = Math.ceil(rs) * 2 + 2;
    this.disk = canvas(n, n);
    {
      const c = ctxOf(this.disk);
      const img = c.createImageData(n, n);
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const o = (y * n + x) * 4;
          const r = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / rs;
          if (r >= 1) continue;
          const mu = Math.sqrt(1 - r * r);
          img.data[o] = 255 * mu ** ALPHA_RGB[0];
          img.data[o + 1] = 240 * mu ** ALPHA_RGB[1];
          img.data[o + 2] = 214 * mu ** ALPHA_RGB[2];
          // 縁の画素は覆う割合で薄くする
          img.data[o + 3] = 255 * Math.min(1, (1 - r) * rs + 0.5);
        }
      c.putImageData(img, 0, 0);
    }
    // 回しても角が欠けないよう、対角の長さの正方形に描く
    const d = Math.ceil(Math.hypot(sc.w, sc.h));
    this.corona = canvas(d, d);
    this.chromo = canvas(d, d);
    const cc = ctxOf(this.corona);
    const ch = ctxOf(this.chromo);
    const ci = cc.createImageData(d, d);
    const hi = ch.createImageData(d, d);
    for (let y = 0; y < d; y++)
      for (let x = 0; x < d; x++) {
        const dx = x + 0.5 - d / 2;
        const dy = y + 0.5 - d / 2;
        const r = Math.hypot(dx, dy) / rs;
        if (r < 0.98) continue;
        const o = (y * d + x) * 4;
        const pa = Math.atan2(-dx, -dy);
        const v = toneLog(coronaAt(sc.corona, Math.max(r, 1), pa));
        ci.data[o] = 248 * v;
        ci.data[o + 1] = 246 * v;
        ci.data[o + 2] = 255 * v;
        ci.data[o + 3] = 255;
        // 彩層（厚さ約 3″ ＝ 太陽半径の 0.3 %）と紅炎。Hα の赤
        const rr = r - 1;
        let pink = rr < 0.012 && rr > -0.02 ? Math.exp(-Math.max(0, rr) / 0.004) : 0;
        for (const p of sc.corona.proms) {
          let a = Math.abs(pa - p.pa) % (2 * Math.PI);
          if (a > Math.PI) a = 2 * Math.PI - a;
          if (a < p.w && rr < p.h && rr > -0.02) pink += 0.8 * (1 - a / p.w) * (1 - Math.max(0, rr) / p.h) ** 0.5;
        }
        if (pink > 0) {
          const k = Math.min(1, pink);
          hi.data[o] = 255 * k;
          hi.data[o + 1] = 70 * k;
          hi.data[o + 2] = 120 * k;
          hi.data[o + 3] = 255;
        }
      }
    cc.putImageData(ci, 0, 0);
    ch.putImageData(hi, 0, 0);
  }

  draw(ctx: CanvasRenderingContext2D, sc: SunScene): { filtered: boolean } {
    const { w, h, disks: dk } = sc;
    const R = Math.min(w, h) / 2;
    const pxPerRad = R / sc.half;
    // 太陽の見かけの半径は食の間ほとんど変わらないので、0.5 px に丸めて画像を使い回す
    const rs = Math.round(dk.sun * dk.scale * pxPerRad * 2) / 2;
    const rm = (dk.moon / dk.sun) * rs;
    this.build(sc, rs);
    // 月の中心の画面での位置（天頂が上、東が左）
    const ang = dk.pa - sc.zen;
    const mx = w / 2 - Math.sin(ang) * (dk.sep / dk.sun) * rs;
    const my = h / 2 - Math.cos(ang) * (dk.sep / dk.sun) * rs;
    const filtered = sc.flux > (sc.filterAbove ?? 2e-3);
    const disk = this.disk as Canvas;
    const sunDisk = () => ctx.drawImage(disk, w / 2 - disk.width / 2, h / 2 - disk.height / 2);
    const moon = new Path2D();
    moon.arc(mx, my, rm, 0, 2 * Math.PI);
    ctx.save();
    if (filtered) {
      // フィルター越し: 光球だけが見える
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      sunDisk();
      ctx.fillStyle = '#000';
      ctx.fill(moon);
      ctx.restore();
      return { filtered };
    }
    // 肉眼: 空の地、コロナ、彩層・紅炎、月、残った光球とぎらつき
    const g = Math.max(0, Math.min(1, (Math.log10(Math.max(sc.flux, 1e-9)) + 6) / 3));
    ctx.fillStyle = `rgb(${8 + 40 * g},${11 + 55 * g},${26 + 80 * g})`;
    ctx.fillRect(0, 0, w, h);
    const sky = 6e-10 + sc.flux * 3e-6;
    const vis = Math.max(0, Math.min(1, (-5.5 - Math.log10(sky)) / 3));
    const rot = (img: Canvas, alpha: number) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(w / 2, h / 2);
      ctx.rotate(sc.zen);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();
    };
    rot(this.corona as Canvas, vis);
    rot(this.chromo as Canvas, 1);
    ctx.fillStyle = '#05070c';
    ctx.fill(moon);
    if (sc.flux > 0) {
      // 残った光球（月の外の細い光）
      ctx.save();
      const outside = new Path2D();
      outside.rect(0, 0, w, h);
      outside.arc(mx, my, rm, 0, 2 * Math.PI, true);
      ctx.clip(outside, 'evenodd');
      sunDisk();
      ctx.restore();
      // ぎらつき: 残った光球の重心のあたりから広がる
      const dd = Math.hypot(mx - w / 2, my - h / 2) || 1;
      const gx = w / 2 - ((mx - w / 2) / dd) * rs;
      const gy = h / 2 - ((my - h / 2) / dd) * rs;
      ctx.globalCompositeOperation = 'lighter';
      for (const [rad, a] of [
        [rs * (0.15 + 0.5 * g), 0.95 * g],
        [rs * (0.6 + 2.6 * g), 0.45 * g],
      ]) {
        const gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, rad);
        gr.addColorStop(0, `rgba(255,252,240,${a})`);
        gr.addColorStop(0.25, `rgba(255,250,235,${a * 0.45})`);
        gr.addColorStop(1, 'rgba(255,250,235,0)');
        ctx.fillStyle = gr;
        ctx.fillRect(0, 0, w, h);
      }
    }
    ctx.restore();
    return { filtered };
  }
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
  /** 周辺減光を入れた残光 F。食のない時刻は 1 */
  flux: number;
  /** 本影の中にいるか */
  total: boolean;
  /** 地平線の山の形の種 */
  seed: number;
}

const NAMES = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];

/**
 * 広角の空: 空の明るさは残光 F（皆既では 10⁻⁴ の底と 360° の地平の夕焼け）を、目の順応を考えて対数で表示する。
 * 太陽が地平線の下なら薄明から夜の空にする。空は半分の解像度で塗って引き伸ばす
 */
export function drawSky(ctx: CanvasRenderingContext2D, sc: SkyScene) {
  const { w, h } = sc;
  const hw = Math.ceil(w / 2);
  const hh = Math.ceil(h / 2);
  const off = canvas(hw, hh);
  const oc = ctxOf(off);
  const img = oc.createImageData(hw, hh);
  const px = img.data;
  // 太陽の高度で昼の明るさを決める（−6° で夜、+3° で昼）
  const sa = Math.sin(sc.sunAlt);
  const dayA = Math.max(0, Math.min(1, (sa + 0.105) / 0.157));
  const B = sc.total ? 1e-4 : Math.max(sc.flux * dayA, 1e-4);
  const e = Math.max(0.04, Math.min(1, 1 + Math.log10(B) / 4.6));
  const m = sc.total ? 1 : Math.max(0, 1 - sc.flux / 0.01);
  const r = rng(sc.seed);
  const ridge = (n: number, amp: number, base: number) => {
    const ph = [r() * 6, r() * 6, r() * 6, r() * 6];
    const out: number[] = [];
    for (let x = 0; x < hw; x++) {
      const u = (sc.az0 + ((x + 0.5) / hw) * (sc.az1 - sc.az0)) * n;
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
  const altAt = (y: number) => sc.alt1 - ((y + 0.5) / hh) * (sc.alt1 - sc.alt0);
  const azAt = (x: number) => sc.az0 + ((x + 0.5) / hw) * (sc.az1 - sc.az0);
  for (let y = 0; y < hh; y++) {
    const alt = altAt(y);
    const a = Math.max(0, alt) / (Math.PI / 2);
    const glow = Math.exp(-Math.max(0, alt) / (9 * (Math.PI / 180)));
    // 昼の空（天頂は青、地平は白っぽい）と皆既の空（天頂は濃い藍、地平の 10° ほどが橙）
    const day = [70 + 116 * (1 - a) ** 3, 118 + 90 * (1 - a) ** 3, 196 + 36 * (1 - a) ** 2];
    const tot = [34 + 200 * glow, 52 + 110 * glow, 110 - 30 * glow];
    const kd = e * (1 - m);
    const kt = m * (0.42 + 0.58 * glow);
    for (let x = 0; x < hw; x++) {
      const o = (y * hw + x) * 4;
      px[o + 3] = 255;
      if (alt < near[x] || alt < far[x]) {
        // 山: 遠い稜線は空に溶け、手前は暗い
        const g = alt < near[x] ? 0.2 : 0.42;
        const lum = (e * (1 - m) + m * 0.3) * 1.6 * g;
        px[o] = (60 + 40 * g) * lum;
        px[o + 1] = (74 + 40 * g) * lum;
        px[o + 2] = (80 + 60 * g) * lum;
        continue;
      }
      let R0 = day[0] * kd + tot[0] * kt;
      let G0 = day[1] * kd + tot[1] * kt;
      let B0 = day[2] * kd + tot[2] * kt;
      if (sc.sunAlt > -sc.sunR * 2) {
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
      }
      px[o] = Math.min(255, R0);
      px[o + 1] = Math.min(255, G0);
      px[o + 2] = Math.min(255, B0);
    }
  }
  oc.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, 0, 0, w, h);
  const kx = w / (sc.az1 - sc.az0);
  const ky = h / (sc.alt1 - sc.alt0);
  // 方位と高度の目盛り
  const darkSky = e * (1 - m) < 0.55;
  ctx.font = '500 11px "Fira Mono", ui-monospace, monospace';
  ctx.fillStyle = darkSky ? 'rgba(230,232,228,0.75)' : 'rgba(20,28,36,0.7)';
  ctx.strokeStyle = darkSky ? 'rgba(230,232,228,0.14)' : 'rgba(20,28,36,0.10)';
  ctx.lineWidth = 1;
  const yHor = sc.alt1 * ky;
  for (let az = -360; az < 720; az += 15) {
    const x = (az * (Math.PI / 180) - sc.az0) * kx;
    if (x < -1 || x > w) continue;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, yHor);
    ctx.stroke();
    const a = ((az % 360) + 360) % 360;
    ctx.fillText(a % 45 === 0 ? `${NAMES[a / 45]} ${a}°` : `${a}°`, x + 4, yHor - 30);
  }
  for (let alt = 10; alt * (Math.PI / 180) < sc.alt1; alt += 10) {
    const y = (sc.alt1 - alt * (Math.PI / 180)) * ky;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(w, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.fillText(`${alt}°`, 6, y - 4);
  }
  // 太陽（皆既なら月の黒い円盤）
  if (sc.sunAlt > -sc.sunR) {
    const sx = (sc.sunAz - sc.az0) * kx;
    const sy = (sc.alt1 - sc.sunAlt) * ky;
    ctx.beginPath();
    if (sc.total) {
      ctx.arc(sx + sc.moonDx * kx, sy - sc.moonDy * ky, Math.max(2, sc.moonR * kx), 0, 2 * Math.PI);
      ctx.fillStyle = '#05070c';
    } else {
      ctx.arc(sx, sy, Math.max(2.4, sc.sunR * kx), 0, 2 * Math.PI);
      ctx.fillStyle = '#fffef8';
    }
    ctx.fill();
  }
  ctx.restore();
}
