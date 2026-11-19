/**
 * しくみの枠の 5 つの図。止まっているときは完成した絵で、工程のカードに指を乗せると初めから順に進む（lib/how-anim.ts）。
 * 図の数値は本物の計算（spectrum.ts）から取る
 */
import { type HowFig, mountHowAnim } from '../../lib/how-anim';
import { gainsFrom } from './scene';
import { arr, CAM, cctSpec, daylight, enc, KX, mv, NL, NM, ONE, planck, rawOf, type Spec, sg } from './spectrum';

type G = CanvasRenderingContext2D;
const CW = 172,
  CH = 104;
const C = { a: '', b: '', ink: '', grid: '', r: '#d0342c', g: '#2f9e44', bl: '#2f6fd0' };

const BULB = planck(2700),
  CLOUD = daylight(6500),
  APPLE = arr((l) => 0.045 + 0.6 * sg(l, 602, 9));
/** 図の左右の余白と、波長 → x */
const X0 = 8,
  X1 = CW - 8,
  YB = CH - 16;
const xl = (i: number): number => X0 + ((X1 - X0) * i) / (NL - 1);

function axis(c: G): void {
  c.strokeStyle = C.grid;
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(X0, YB + 0.5);
  c.lineTo(X1, YB + 0.5);
  c.stroke();
  c.font = '11px "Fira Mono",ui-monospace,Consolas,monospace';
  c.fillStyle = C.ink;
  c.textAlign = 'center';
  for (const l of [400, 500, 600, 700]) c.fillText(String(l), xl((l - 380) / 5), CH - 3);
}
/** 分光の曲線（最大 top で描く）。n は描く点の数（左から） */
function curve(c: G, s: Spec, top: number, col: string, n = NL, dash: number[] = [], fill = ''): void {
  let m = 0;
  for (let i = 0; i < NL; i++) m = Math.max(m, s[i] as number);
  const y = (i: number) => YB - ((s[i] as number) / m) * top;
  c.setLineDash(dash);
  c.strokeStyle = col;
  c.lineWidth = 1.6;
  c.beginPath();
  for (let i = 0; i < n; i++) (i ? c.lineTo : c.moveTo).call(c, xl(i), y(i));
  if (fill && n > 1) {
    c.lineTo(xl(n - 1), YB);
    c.lineTo(xl(0), YB);
    c.closePath();
    c.fillStyle = fill;
    c.fill();
  }
  c.stroke();
  c.setLineDash([]);
}
function label(c: G, s: string, x: number, y: number, col: string, al: CanvasTextAlign = 'left'): void {
  c.font = '500 11px system-ui,sans-serif';
  c.textAlign = al;
  c.fillStyle = col;
  c.fillText(s, x, y);
}
/** R・G・B の棒（v は 0〜1 の高さ） */
function bars(c: G, x: number, v: readonly number[], w = 12, top = 60): void {
  [C.r, C.g, C.bl].forEach((col, i) => {
    const h = Math.max(1, (v[i] as number) * top);
    c.fillStyle = col;
    c.fillRect(x + i * (w + 4), YB - h, w, h);
  });
  c.strokeStyle = C.grid;
  c.beginPath();
  c.moveTo(x - 4, YB + 0.5);
  c.lineTo(x + 3 * (w + 4), YB + 0.5);
  c.stroke();
}
const steps = (k: number, n: number): number => Math.min(n, Math.floor(k * n + 1e-9));

/* 1 光の色: 電球と曇天の分光を左から描く */
const F1: HowFig = {
  dur: 2,
  draw(c, k) {
    axis(c);
    const n = Math.max(2, Math.round(k * NL));
    curve(c, BULB, 70, C.a, n);
    curve(c, CLOUD, 70, C.b, n);
    label(c, '電球', X0 + 2, 14, C.a);
    label(c, '曇天', X0 + 34, 14, C.b);
  },
};

/* 2 物の色: 電球の光 × リンゴの反射率 = 届く光 */
const F2: HowFig = {
  dur: 2,
  draw(c, k) {
    axis(c);
    const n = Math.max(2, Math.round(k * NL)),
      prod = arr((_, i) => (BULB[i] as number) * (APPLE[i] as number));
    curve(c, BULB, 70, C.a, NL, [3, 3]);
    curve(c, APPLE, 70, C.ink, NL, [1, 2]);
    curve(c, prod, 60, C.r, n, [], 'rgba(208,52,44,.25)');
    label(c, '光', X0 + 2, 14, C.a);
    label(c, '反射率', X0 + 22, 14, C.ink);
    label(c, '届く光', X0 + 66, 14, C.r);
  },
};

/* 3 カメラの R・G・B: 感度の山と、白い紙を電球で写した RAW の棒 */
const RAW_BULB = (() => {
  const w = rawOf(ONE, BULB),
    m = Math.max(...w);
  return w.map((v) => v / m);
})();
const F3: HowFig = {
  dur: 1.6,
  draw(c, k) {
    const sx = (i: number) => X0 + ((96 - X0) * i) / (NL - 1);
    c.strokeStyle = C.grid;
    c.beginPath();
    c.moveTo(X0, YB + 0.5);
    c.lineTo(96, YB + 0.5);
    c.stroke();
    let m = 0;
    for (const s of CAM) for (let i = 0; i < NL; i++) m = Math.max(m, s[i] as number);
    [C.r, C.g, C.bl].forEach((col, j) => {
      const s = CAM[j] as Spec;
      c.strokeStyle = col;
      c.lineWidth = 1.5;
      c.beginPath();
      for (let i = 0; i < NL; i++) (i ? c.lineTo : c.moveTo).call(c, sx(i), YB - ((s[i] as number) / m) * 60);
      c.stroke();
    });
    label(c, '感度', X0 + 2, 14, C.ink);
    const t = steps(k, 4) / 4;
    bars(
      c,
      116,
      RAW_BULB.map((v) => v * t),
      10,
    );
    label(c, 'RAW', 116, 14, C.ink);
  },
};

/* 4 ゲインで白をそろえる: R と B に倍率を掛けて G にそろえる */
const F4: HowFig = {
  dur: 1.8,
  draw(c, k) {
    const s = 0.75 / (RAW_BULB[1] as number),
      before = RAW_BULB.map((v) => v * s),
      t = steps(k, 5) / 5,
      after = before.map((v) => v + ((before[1] as number) - v) * t);
    bars(c, 14, before, 12);
    bars(c, 108, after, 12);
    c.strokeStyle = C.ink;
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(70, 50);
    c.lineTo(98, 50);
    c.moveTo(92, 45);
    c.lineTo(98, 50);
    c.lineTo(92, 55);
    c.stroke();
    const g = gainsFrom(rawOf(ONE, BULB));
    label(c, `R ×${g[0].toFixed(1)}`, 84, 38, C.r, 'center');
    label(c, `B ×${g[2].toFixed(1)}`, 84, 70, C.bl, 'center');
    label(c, '前', 14, 14, C.ink);
    label(c, '後', 108, 14, C.ink);
  },
};

/* 5 表示の色へ: 電球の下の白い紙を、太陽光の設定と電球の設定で現像した色。2 枚を並べて比べる絵で、動かさない */
function paperCss(set: Spec): string {
  const w = rawOf(ONE, BULB),
    g = gainsFrom(rawOf(ONE, set)),
    lin = mv(NM, [(w[0] * (g[0] as number) * KX) / w[1], KX, (w[2] * (g[2] as number) * KX) / w[1]]),
    m = Math.max(...lin);
  return `rgb(${lin.map((v) => enc((Math.max(0, v) / m) * 0.88)).join(',')})`;
}
const SUN_SET = paperCss(cctSpec(5200)),
  BULB_SET = paperCss(cctSpec(2700));
const F5: HowFig = {
  dur: 1,
  draw(c) {
    const sq = (x: number, col: string, txt: string): void => {
      c.fillStyle = col;
      c.fillRect(x, 26, 64, 52);
      c.strokeStyle = C.grid;
      c.strokeRect(x + 0.5, 26.5, 63, 51);
      label(c, txt, x + 32, 18, C.ink, 'center');
    };
    sq(10, SUN_SET, '設定 太陽光');
    sq(98, BULB_SET, '設定 電球');
    label(c, '光はどちらも電球', CW / 2, CH - 6, C.ink, 'center');
  },
};

/** しくみの図を動かす */
export function mountHow(host: HTMLElement): void {
  mountHowAnim(host, [F1, F2, F3, F4, F5], {
    w: CW,
    h: CH,
    prepare() {
      const css = getComputedStyle(document.documentElement),
        v = (n: string): string => css.getPropertyValue(n).trim();
      Object.assign(C, { a: v('--ch1'), b: v('--ch2'), ink: v('--screen-ink'), grid: v('--grid-2') });
    },
  });
}
