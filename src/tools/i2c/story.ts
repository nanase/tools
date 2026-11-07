/** 今の位置で起きていることの一言（配線図の下に出す）。w は色分けの送り手（x は失敗） */
import { DEVS, frameAt, hex, type Role, type Sim, SLAVE0 } from './bus';

export interface Say {
  t: string;
  w: Role | 'x';
}

const devName = (i: number): string => (i === 0 ? 'マスタ' : i === 1 ? 'マスタ 2' : (DEVS[i - SLAVE0]?.name ?? ''));
/** 機器の集合の名前 */
const names = (mask: number, multi: boolean): string => {
  const n: string[] = [];
  for (let i = 0; i < SLAVE0 + DEVS.length; i++)
    if (mask & (1 << i)) n.push(i === 0 && multi ? 'マスタ 1' : devName(i));
  return n.join('・');
};

export function say(s: Sim, pt: number): Say {
  const { frames, notes, c, E } = s;
  for (const e of notes)
    if (e.kind === 'lost' && pt >= e.t && pt < e.t + 1.5 * s.T)
      return { t: `調停 ― ${e.i ? 'マスタ 2' : 'マスタ 1'}の負け、送信を中止`, w: e.i ? 'm2' : 'm' };
  for (const e of notes) {
    if (e.kind !== 'stretch' || e.t > pt) continue;
    const end = notes.find((u) => u.kind === 'unstretch' && u.i === e.i && u.t >= e.t)?.t ?? Infinity;
    if (pt < end) return { t: `クロックストレッチ ― ${devName(e.i)}が SCL を Low に保持`, w: 's' };
  }
  if (!frames.length)
    return E.vol > E.vil
      ? { t: `Low にならない ― ${E.vol.toFixed(2)} V は VIL ${E.vil.toFixed(2)} V より上`, w: 'x' }
      : { t: '待機 ― 2 本とも High', w: null };
  const f = frameAt(s, pt);
  if (!f) return { t: '待機 ― 2 本とも High', w: null };
  if (!frames.some((x) => x.k === 'addr') && pt > frames[0].t0 + s.T)
    return { t: 'SCL が VIH に届かない ― ビットを読めない', w: 'x' };
  switch (f.k) {
    case 'S':
      return { t: '開始 ― SCL が High のまま SDA ↓', w: 'm' };
    case 'Sr':
      return { t: '再開始 ― SCL が High のまま SDA ↓', w: 'm' };
    case 'P':
      return pt < f.t0 + 1.5 * s.T
        ? { t: '終了 ― SCL が High のまま SDA ↑', w: 'm' }
        : { t: '待機 ― 2 本とも High', w: null };
    case 'A':
      return { t: `ACK ― ${names(f.by ?? 0, c.multi)}が SDA ↓`, w: f.role ?? 's' };
    case 'N':
      return f.of === 'addr' ? { t: 'NACK ― 応答なし', w: 'x' } : { t: 'NACK ― 読み出しの終わり', w: 'm' };
    default: {
      const got = (f.bits ?? []).filter((b) => b.t <= pt).map((b) => b.v),
        dots = got.join('') + '·'.repeat(Math.max(0, 8 - got.length)),
        w = f.role ?? 'm';
      if (f.k === 'addr') {
        if (got.length === 8) return { t: `読み書き ${got[7]} ＝ ${got[7] ? '読み出し' : '書き込み'}`, w };
        return {
          t: `アドレス ${dots.slice(0, 7)}${got.length === 7 ? ` ＝ ${hex(Number.parseInt(dots.slice(0, 7), 2))}` : ''}`,
          w,
        };
      }
      if (f.k === 'junk') return { t: `途中のビット ${dots}`, w: 'x' };
      return { t: `データ ${dots}${got.length === 8 ? ` ＝ ${hex(f.v ?? 0)}` : ''}`, w };
    }
  }
}
