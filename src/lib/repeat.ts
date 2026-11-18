/**
 * 押し続けると繰り返すボタン: 押した瞬間に 1 回、delay ms 押し続けると every ms ごとに繰り返す。
 * 離す・外へ出る・取り消されると止まる。キーボードで決定したとき（click の detail が 0）は 1 回だけ。
 * fn の引数は Shift を押していたか（数値欄の大きな刻み）
 */
export function bindRepeat(
  btn: HTMLElement,
  fn: (big: boolean) => void,
  { delay = 420, every = 90 }: { delay?: number; every?: number } = {},
): void {
  let t1: ReturnType<typeof setTimeout> | undefined;
  let t2: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    clearTimeout(t1);
    clearInterval(t2);
  };
  btn.addEventListener('pointerdown', (e) => {
    if ((e as PointerEvent).button !== 0) return;
    stop();
    fn(!!(e as PointerEvent).shiftKey);
    t1 = setTimeout(() => {
      t2 = setInterval(() => fn(false), every);
    }, delay);
  });
  for (const n of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(n, stop);
  addEventListener('pointerup', stop);
  btn.addEventListener('click', (e) => {
    if ((e as MouseEvent).detail === 0) fn(!!(e as MouseEvent).shiftKey);
  });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}
