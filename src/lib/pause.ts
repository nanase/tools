/**
 * 楽器のページ（ピアノ・オルガン・ギター・ヴァイオリン・トランペット）の演奏の自動の一時停止と、画面が隠れている間の予約。
 * 一時停止は曲の演奏を止めるだけで、AudioContext は止めない（一時停止の間も手で弾ける）。鳴っている音は楽器ごとに自然に離し、
 * 再開すると止めた拍から弾く（lib/transport.ts と各ページ）
 */

/**
 * スマートフォンとタブレットか（おもな入力が指であることで見分ける）。画面が隠れるとブラウザごとすぐ止められ、
 * PC より計算も遅い。PC は、隠れたタブでも音が鳴り続け、タイマーが間引かれるだけなので当たらない
 */
export const handheld = (): boolean => matchMedia('(pointer: coarse)').matches;

/** 画面が隠れていて、演奏を一時停止しておくときか（スマートフォンとタブレット） */
export const asleep = (): boolean => document.hidden && handheld();

/** 画面が隠れている間に、先に予約する時間 [s]。隠れたタブのタイマーは、1 秒に 1 回までに間引かれる */
const HIDDEN_AHEAD = 2;

/** 演奏で先に予約する時間 [s]。s は画面が見えている間の値 */
export const lookahead = (s: number): number => (document.hidden ? Math.max(s, HIDDEN_AHEAD) : s);

/**
 * AudioContext の時計が、出力している音より何秒先にあるか（測れないときは null）。
 * 音の計算が間に合わないと、Android の Chrome は遅れた分を後でまとめて計算し、時計だけが先へ進む（その分の音は出ない）
 */
export function clockLead(ac: AudioContext | null): number | null {
  if (ac?.state !== 'running' || !ac.getOutputTimestamp) return null;
  const t = ac.getOutputTimestamp().contextTime;
  return t ? ac.currentTime - t : null;
}

/** 時計の先走りが、いちばん小さかったときからこれだけ増えたら、計算が間に合っていないとみなす [s] */
const LEAD_MAX = 0.5;
/** 先走りを確かめる間隔 [ms] */
const LEAD_CHECK = 500;

/**
 * 演奏の自動の一時停止。スマートフォンやタブレットで画面が隠れたとき（スリープ、ほかのタブやアプリへの切り替え）と、
 * ブラウザや OS が AudioContext を止めたとき（画面のロック、電話の着信など）に pause を呼ぶ（再開は自動ではしない）。
 * PC では、画面が隠れても（ほかのタブへの切り替え、ウィンドウの最小化）演奏を続け、hidden を呼ぶ
 * （タイマーが間引かれる前に、先の分まで予約する）。
 * 音の計算が間に合わず、時計が出力より先へ進み始めたときも pause を呼び（曲が音のないまま速く進まないように）、msg で知らせる。
 * pause は、演奏していて一時停止したときに true を返す
 */
export function autoPause(
  audio: { onLost: (() => void) | null; lead(): number | null },
  opt: { pause: () => boolean; hidden: () => void; msg: (s: string) => void },
): void {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    if (handheld()) opt.pause();
    else opt.hidden();
  });
  audio.onLost = opt.pause;
  /* 先走りには出力の遅れの分がもとから含まれるので、いちばん小さかったときからの増え方を見る */
  let base = Infinity;
  setInterval(() => {
    const g = audio.lead();
    if (g === null) {
      base = Infinity;
      return;
    }
    base = Math.min(base, g);
    if (g - base <= LEAD_MAX) return;
    base = g;
    opt.msg(
      opt.pause()
        ? '音の計算が間に合わないため、曲を一時停止しました'
        : '音の計算が間に合っていません（音が途切れます）',
    );
  }, LEAD_CHECK);
}
