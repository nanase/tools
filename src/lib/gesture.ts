/**
 * 利用者の操作で音を鳴らし始めるときの判定。ブラウザは、利用者の操作の処理の中でないと AudioContext を動かさない。
 * HTML の決まりで、その操作になるのはマウスは押したとき（pointerdown）、指とペンは離したとき（pointerup）、
 * キーは Esc 以外を押したとき（keydown）。指で押したときの pointerdown では動かないので、離したときに鳴らし始める
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
