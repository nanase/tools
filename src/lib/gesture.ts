/**
 * 利用者の操作で音を鳴らす（design/page.md）。ブラウザは、利用者の操作の処理の中でないと AudioContext を動かさない。
 * HTML の決まりで、その操作になるのはマウスは押したとき（pointerdown）、指とペンは離したとき（pointerup）、
 * キーは Esc 以外を押したとき（keydown）と click。指で押したときの pointerdown では動かない
 * - activates: そのイベントで鳴らし始めてよいか
 * - pickAct・onPick: 止まっている間に音源・種類・試聴の鍵などを選んだら鳴らし始める（保存した設定の復元や初期化では鳴らさない）
 * - wakeOnRelease: 指で押して動かなかった AudioContext を、指を離したときに動かす
 */

/** 判定に使うイベントの部分（試験では素のオブジェクトを渡す） */
export interface GestureLike {
  readonly isTrusted: boolean;
  readonly type: string;
  readonly pointerType?: string;
  readonly key?: string;
}

/** 音を鳴らし始めてよい、利用者の操作のイベントか。スクリプトから送ったイベント（isTrusted が偽）は当たらない */
export function activates(e: GestureLike): boolean {
  if (!e.isTrusted) return false;
  switch (e.type) {
    case 'pointerdown':
    case 'mousedown':
      return (e.pointerType ?? 'mouse') === 'mouse';
    case 'pointerup':
      return e.pointerType !== 'mouse';
    case 'keydown':
      return e.key !== 'Escape';
    case 'click':
    case 'touchend':
      return true;
    default:
      return false;
  }
}

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

/** 指を離したときの、利用者の操作として扱われるイベント */
const WAKE_EVENTS = ['pointerup', 'click', 'keydown'] as const;
/** 待っている AudioContext（同じものへは 1 組だけ受け口を置く） */
const waiting = new WeakSet<BaseAudioContext>();

/** ac が動いていなければ、次に指を離したとき（か click・keydown）に resume する。1 回で受け口を外す */
export function wakeOnRelease(ac: AudioContext): void {
  if (ac.state === 'running' || ac.state === 'closed' || waiting.has(ac)) return;
  waiting.add(ac);
  const go = () => {
    for (const t of WAKE_EVENTS) document.removeEventListener(t, go, true);
    waiting.delete(ac);
    if (ac.state !== 'running') void ac.resume().catch(() => undefined);
  };
  for (const t of WAKE_EVENTS) document.addEventListener(t, go, true);
}
