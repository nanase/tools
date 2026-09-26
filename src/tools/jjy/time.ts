/** 日本標準時（JST）の暦と、時刻の表記（DOM に依存しない） */

/** JST は UTC + 9 時間。夏時間は実施していないので固定 */
const OFFSET = 9 * 3600e3;
export const WD = ['日', '月', '火', '水', '木', '金', '土'] as const;

export const p2 = (n: number): string => String(n).padStart(2, '0');

export interface Jst {
  y: number;
  /** 月（1〜12） */
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  /** 曜日（日曜 = 0） */
  wd: number;
  /** 年の通算日（1 月 1 日 = 1） */
  doy: number;
}

/** UTC のミリ秒を JST の暦に分ける */
export function jst(ms: number): Jst {
  const t = new Date(ms + OFFSET),
    y = t.getUTCFullYear(),
    mo = t.getUTCMonth(),
    d = t.getUTCDate();
  return {
    y,
    mo: mo + 1,
    d,
    h: t.getUTCHours(),
    mi: t.getUTCMinutes(),
    s: t.getUTCSeconds(),
    wd: t.getUTCDay(),
    doy: (Date.UTC(y, mo, d) - Date.UTC(y, 0, 1)) / 864e5 + 1,
  };
}

/** 次にコールサインを送る時刻（毎時 15 分と 45 分）の「HH:MM」 */
export function nextCallSign({ h, mi }: Pick<Jst, 'h' | 'mi'>): string {
  return mi < 15 ? `${p2(h)}:15` : mi < 45 ? `${p2(h)}:45` : `${p2((h + 1) % 24)}:15`;
}

/**
 * 現在時刻との差（表示時刻 − 実時刻、ミリ秒）の HTML。
 * 0.05 秒未満は 0、1 分未満は小数 1 桁の秒、それ以上は時:分:秒
 */
export function diffHtml(ms: number): string {
  const d = ms / 1000,
    a = Math.abs(d),
    sg = d < -0.05 ? '−' : d > 0.05 ? '+' : '';
  if (a < 0.05) return '0<span class="u">s</span>';
  if (a < 60) return `${sg}${a.toFixed(1)}<span class="u">s</span>`;
  const s = Math.floor(a);
  return `${sg}${Math.floor(s / 3600)}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}`;
}
