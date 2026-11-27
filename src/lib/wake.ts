/**
 * 楽器のページの AudioContext を、指で押したときにも動かす。
 * ブラウザは指（pointerType が touch・pen）の pointerdown を利用者の操作として扱わず、その中で resume しても止まったままになる。
 * 利用者の操作になるのは、指を離したとき（pointerup）・click・keydown なので、動いていなければそこでもう一度 resume する
 */

/** 利用者の操作として扱われるイベント */
const EVENTS = ['pointerup', 'click', 'keydown'] as const;
/** 待っている AudioContext（同じものへは 1 組だけ受け口を置く） */
const waiting = new WeakSet<BaseAudioContext>();

/** ac が動いていなければ、次に指を離したとき（か click・keydown）に resume する。1 回で受け口を外す */
export function wakeOnRelease(ac: AudioContext): void {
  if (ac.state === 'running' || ac.state === 'closed' || waiting.has(ac)) return;
  waiting.add(ac);
  const go = () => {
    for (const t of EVENTS) document.removeEventListener(t, go, true);
    waiting.delete(ac);
    if (ac.state !== 'running') void ac.resume().catch(() => undefined);
  };
  for (const t of EVENTS) document.addEventListener(t, go, true);
}
