/**
 * 音のページで、止まっている間に音源・種類・試聴の鍵などを押したら鳴らし始める（design/page.md）。
 * 始めるのは利用者の操作（isTrusted のイベント）のときだけ。保存した設定の復元、URL の値、初期化の中で
 * 選択が変わっても鳴らさない。止めるのは再生ボタン
 */

/** 選んだあとにすること。start: 鳴らし始める、restart: 鳴らし直す（1 回鳴って終わる音）、none: 何もしない */
export type PickAct = 'start' | 'restart' | 'none';

/**
 * 選んだあとにすること。e は選択のきっかけのイベント（ないときはプログラムからの選択）、playing は鳴っているか、
 * once は 1 回鳴って終わる音か。鳴り続ける音は、鳴っていれば選択の処理が音を変えるので何もしない
 */
export function pickAct(e: { isTrusted: boolean } | null | undefined, playing: boolean, once = false): PickAct {
  if (!e?.isTrusted) return 'none';
  if (!playing) return 'start';
  return once ? 'restart' : 'none';
}

/**
 * root の中の sel に合う要素を利用者が押したら fn を呼ぶ（無効の要素は除く）。Choice の群には、Choice を作ったあとに
 * 付ける（選択の処理のあとに呼ぶため）
 */
export function onPick(root: Element, fn: (e: Event) => void, sel = 'button[data-v]'): void {
  root.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    const b = (e.target as Element | null)?.closest?.(sel);
    if (!b || !root.contains(b) || (b as HTMLButtonElement).disabled) return;
    fn(e);
  });
}
