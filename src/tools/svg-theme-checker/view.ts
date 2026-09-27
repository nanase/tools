/** テーマの再現（CSS の書き換え）、SVG の大きさ、プレビューの位置と倍率。DOM に依存しない */

export type Theme = 'light' | 'dark';

/* ---------- テーマの再現 ---------- */
const MQ_T = '(min-width:0px)',
  MQ_F = '(not (min-width:0px))';
/** メディアクエリの prefers-color-scheme を、th に合わせて常に真・常に偽の条件に置き換える */
export const themeMq = (p: string, th: Theme): string =>
  p.replace(/\(\s*prefers-color-scheme\s*(?::\s*([a-z]+)\s*)?\)/gi, (_m, v?: string) =>
    !v || v.toLowerCase() === th ? MQ_T : MQ_F,
  );
/** CSS の @media の条件を置き換え、light と dark の両方を挙げた color-scheme を th に固定する */
export const themeCss = (css: string, th: Theme): string =>
  css
    .replace(/@media\b([^{;]*)\{/gi, (_m, p: string) => `@media${themeMq(p, th)}{`)
    .replace(/(^|[^\w-])(color-scheme\s*:\s*)([^;}]*)/gi, (m, p: string, k: string, v: string) =>
      /light/i.test(v) && /dark/i.test(v) ? p + k + th : m,
    );

/* ---------- 大きさ ---------- */
const UNIT: Record<string, number> = { '': 1, px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 4 / 3, pc: 16 };
/** 長さ（単位つき可、% は不可）を px で。読めなければ NaN */
export function len(v: string | null): number {
  const m = /^\s*([+]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|in|cm|mm|pt|pc)?\s*$/i.exec(v ?? '');
  return m ? +(m[1] ?? '') * (UNIT[(m[2] ?? '').toLowerCase()] ?? 1) : NaN;
}

export interface Size {
  w: number;
  h: number;
  /** width・height から決まらず、既定の大きさにした */
  auto: boolean;
  vb: number[] | null;
}
/** <img> で描いたときの大きさ。width・height がなければ viewBox の比で長辺 300、それもなければ 300 × 150 */
export function sizeOf(viewBox: string | null, width: string | null, height: string | null): Size {
  const vb = (viewBox ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const [, , vw = 0, vh = 0] = vb;
  const hasVb = vb.length === 4 && vb.every(Number.isFinite) && vw > 0 && vh > 0;
  let w = len(width),
    h = len(height),
    auto = false;
  if (!(w > 0) && h > 0 && hasVb) w = (h * vw) / vh;
  if (!(h > 0) && w > 0 && hasVb) h = (w * vh) / vw;
  if (!(w > 0) || !(h > 0)) {
    auto = true;
    if (hasVb) {
      const k = 300 / Math.max(vw, vh);
      w = vw * k;
      h = vh * k;
    } else {
      w = 300;
      h = 150;
    }
  }
  return { w, h, auto, vb: hasVb ? vb : null };
}
/** 大きさ・viewBox の表示用（有効 5 桁） */
export const n4 = (v: number): string => String(Number(v.toPrecision(5)));

/* ---------- プレビューの位置と倍率 ---------- */
export interface View {
  x: number;
  y: number;
  s: number;
}
/** 全体を表示: 枠に収まるなら等倍、収まらなければ 9 割に縮めて中央へ */
export function fitView(W: number, H: number, w: number, h: number): View {
  const s = W <= w && H <= h ? 1 : Math.min(w / W, h / H) * 0.9;
  return { s, x: (w - W * s) / 2, y: (h - H * s) / 2 };
}
/** 等倍で中央へ */
export const actualView = (W: number, H: number, w: number, h: number): View => ({
  s: 1,
  x: (w - W) / 2,
  y: (h - H) / 2,
});
/** 点 (px, py) を動かさずに f 倍する（2 %〜6400 %） */
export function zoomView(v: View, px: number, py: number, f: number): View {
  const s = Math.min(64, Math.max(0.02, v.s * f)),
    k = s / v.s;
  return { s, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
}
/** 倍率の表示。100 % 以上は整数、未満は有効 2 桁 */
export function zoomText(s: number): string {
  const p = s * 100;
  return `${p >= 100 ? Math.round(p) : Number(p.toPrecision(2))} %`;
}
