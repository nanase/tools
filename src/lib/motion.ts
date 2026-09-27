/** 開閉の動き。動きを減らす設定では即座に切り替える */
export const RM = matchMedia('(prefers-reduced-motion: reduce)');

export function fx(el: HTMLElement, frames: Keyframe[], ms: number, done?: () => void): void {
  if (RM.matches || !el.animate) {
    done?.();
    return;
  }
  el.animate(frames, { duration: ms, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = done ?? null;
}

export const POP_IN: Keyframe[] = [
  { opacity: 0, transform: 'translateY(-6px)' },
  { opacity: 1, transform: 'none' },
];
export const POP_OUT: Keyframe[] = [
  { opacity: 1, transform: 'none' },
  { opacity: 0, transform: 'translateY(-6px)' },
];
export const FADE_IN: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
export const FADE_OUT: Keyframe[] = [{ opacity: 1 }, { opacity: 0 }];
