/**
 * 楽器のページ（ピアノ・オルガン・ギター・ヴァイオリン・トランペット）の演奏の自動の一時停止と、画面が隠れている間の予約。
 * 一時停止は曲の演奏を止めるだけで、AudioContext は止めない（一時停止の間も手で弾ける）。鳴っている音は楽器ごとに自然に離し、
 * 再開すると止めた拍から弾く（lib/transport.ts と各ページ）
 */

/**
 * 画面が隠れると、ブラウザごとすぐ止められる機器か（スマートフォンとタブレット。おもな入力が指であることで見分ける）。
 * PC は、隠れたタブでも音が鳴り続け、タイマーが間引かれるだけなので当たらない
 */
const sleeps = (): boolean => matchMedia('(pointer: coarse)').matches;

/** 画面が隠れていて、演奏を一時停止しておくときか（スマートフォンとタブレット） */
export const asleep = (): boolean => document.hidden && sleeps();

/** 画面が隠れている間に、先に予約する時間 [s]。隠れたタブのタイマーは、1 秒に 1 回までに間引かれる */
const HIDDEN_AHEAD = 2;

/** 演奏で先に予約する時間 [s]。s は画面が見えている間の値 */
export const lookahead = (s: number): number => (document.hidden ? Math.max(s, HIDDEN_AHEAD) : s);

/**
 * 演奏の自動の一時停止。スマートフォンやタブレットで画面が隠れたとき（スリープ、ほかのタブやアプリへの切り替え）と、
 * ブラウザや OS が AudioContext を止めたとき（画面のロック、電話の着信など）に pause を呼ぶ（再開は自動ではしない）。
 * PC では、画面が隠れても（ほかのタブへの切り替え、ウィンドウの最小化）演奏を続け、hidden を呼ぶ
 * （タイマーが間引かれる前に、先の分まで予約する）
 */
export function autoPause(
  audio: { onLost: (() => void) | null },
  opt: { pause: () => void; hidden: () => void },
): void {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    if (sleeps()) opt.pause();
    else opt.hidden();
  });
  audio.onLost = opt.pause;
}
