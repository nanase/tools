/**
 * 地点の時間帯（DOM に依存しない）。座標から IANA の時間帯の名前を引き（@photostructure/tz-lookup、
 * 境界は timezone-boundary-builder）、UTC との差はブラウザの Intl で求める。
 * 名前が引けないときは経度から割り出した差（15° で 1 時間）を使う
 */

type Lookup = (lat: number, lon: number) => string;
let lookup: Promise<Lookup> | null = null;

/** 座標の時間帯の名前。データを読めないときは null（海の上は Etc/GMT±N が返る） */
export async function lookupZone(lat: number, lon: number): Promise<string | null> {
  try {
    lookup ??= import('@photostructure/tz-lookup').then((m) => (m.default ?? m) as Lookup);
    return (await lookup)(lat, lon);
  } catch {
    lookup = null;
    return null;
  }
}

const fmts = new Map<string, Intl.DateTimeFormat | null>();
function fmtOf(zone: string): Intl.DateTimeFormat | null {
  let f = fmts.get(zone);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
      });
    } catch {
      f = null;
    }
    fmts.set(zone, f);
  }
  return f;
}

/** 時刻 ms での UTC との差 [ms]。zone が null か知らない名前なら経度から */
export function zoneOffset(zone: string | null, lon: number, ms: number): number {
  const f = zone ? fmtOf(zone) : null;
  if (!f) return Math.round(lon / 15) * 36e5;
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
  return Math.round((local - Math.floor(ms / 6e4) * 6e4) / 6e4) * 6e4;
}

/** 差が経度からの概算か（引けなかったか、海の上の Etc/GMT±N） */
export const approx = (zone: string | null): boolean => !zone || zone.startsWith('Etc/');

/** UTC との差の表示: UTC+9・UTC−5・UTC+5:30 */
export function offText(off: number): string {
  const m = Math.round(Math.abs(off) / 6e4);
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `UTC${off < 0 ? '−' : '+'}${h}${r ? `:${String(r).padStart(2, '0')}` : ''}`;
}

/** 現地の暦の 0 時 u（UTC で数えた値）にあたる瞬間 */
function midnight(u: number, off: (ms: number) => number, near: number): number {
  const t = u - off(near);
  return u - off(t);
}

/** 時刻 ms を含む現地の日の 0 時と翌日の 0 時。夏時間の切り替わる日は 23・25 時間になる */
export function localDay(ms: number, off: (ms: number) => number): [number, number] {
  const u = Math.floor((ms + off(ms)) / 864e5) * 864e5;
  const d0 = midnight(u, off, ms);
  return [d0, midnight(u + 864e5, off, d0 + 864e5)];
}

/** 暦の日時（壁の時計の読み）を、UTC で数えた値にする。1〜99 年も Date.UTC のように 1900 年代へ寄せない */
export function wallMs(v: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}): number {
  const d = new Date(0);
  d.setUTCFullYear(v.year, v.month - 1, v.day);
  d.setUTCHours(v.hour, v.minute, v.second, 0);
  return d.getTime();
}

/** 壁の時計の読み wall（UTC で数えた値）にあたる瞬間。その瞬間の時差で引き直すので、夏時間の向こう側でもずれない */
export function fromWall(wall: number, off: (ms: number) => number): number {
  const t = wall - off(wall);
  return wall - off(t);
}

/** 時刻 ms を sec 秒ずらす。日の倍数のときは現地の時計の読みを保つ（夏時間をまたいでも 12:00 は 12:00） */
export function shiftTime(ms: number, sec: number, off: (ms: number) => number): number {
  if (sec % 86400 !== 0) return ms + sec * 1000;
  return fromWall(ms + off(ms) + sec * 1000, off);
}
