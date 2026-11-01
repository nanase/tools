/**
 * 画像ファイルの読み込み（ファイルを選ぶ・枠へ落とす）。画素は RGBA 8 ビットで返す。
 * JPEG・PNG・GIF・画像の破損のページで使う
 */

/** 読み込んだ画像 */
export interface LoadedImage {
  w: number;
  h: number;
  rgba: Uint8ClampedArray;
  /** 元の大きさ（縮小する前） */
  W: number;
  H: number;
  /** 拡張子を除いたファイル名（保存するファイル名の元） */
  name: string;
  /** ファイルのバイト列 */
  bytes: Uint8Array;
}

export interface LoadOpts {
  /** 長い辺がこれを超えるなら縮小する */
  maxSide: number;
  /** 透明な所を塗る色（省けば透明のまま） */
  bg?: string;
}

/** ファイルを画像として読む。読めなければ例外 */
export async function loadImage(f: File, o: LoadOpts): Promise<LoadedImage> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  const bmp = await createImageBitmap(new Blob([bytes]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const W = bmp.width,
    H = bmp.height,
    s = Math.min(1, o.maxSide / Math.max(W, H)),
    w = Math.max(1, Math.round(W * s)),
    h = Math.max(1, Math.round(H * s));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  if (!x) throw new Error('canvas を使えません');
  if (o.bg) {
    x.fillStyle = o.bg;
    x.fillRect(0, 0, w, h);
  }
  x.imageSmoothingQuality = 'high';
  x.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return { w, h, W, H, rgba: x.getImageData(0, 0, w, h).data, name: f.name.replace(/\.[^.]*$/, '') || 'image', bytes };
}

/** ファイルの選択とドロップをつなぐ。ドロップの間は枠に .drop を付ける */
export function bindFileInput(
  btn: HTMLElement,
  input: HTMLInputElement,
  panels: readonly HTMLElement[],
  onFile: (f: File) => void,
): void {
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    input.value = '';
    if (f) onFile(f);
  });
  for (const p of panels) {
    p.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      p.classList.add('drop');
    });
    p.addEventListener('dragleave', (e) => {
      if (!p.contains(e.relatedTarget as Node | null)) p.classList.remove('drop');
    });
    p.addEventListener('drop', (e) => {
      e.preventDefault();
      p.classList.remove('drop');
      const f = e.dataTransfer?.files[0];
      if (f) onFile(f);
    });
  }
}

/** バイト列をファイルとして保存させる */
export function saveBytes(b: Uint8Array, type: string, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([b as Uint8Array<ArrayBuffer>], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
