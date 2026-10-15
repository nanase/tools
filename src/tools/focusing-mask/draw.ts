/**
 * マスクの正面の図（SVG の文字列、DOM に依存しない）。座標は開口の半径を 1、y は上。
 * 板（.mk-p）の上に、開いている所（.mk-o）を描き、副鏡とスパイダー（.mk-s）を重ねる
 */
import type { Mask, Scope } from './mask';

const f3 = (v: number) => String(Math.round(v * 1000) / 1000);

/** 法線 (nx, ny)・周期 p・開きの割合 d の格子の、開いた帯の多角形（半径 1.2 の範囲） */
function slits(nx: number, ny: number, p: number, d: number): string {
  const tx = -ny,
    ty = nx,
    L = 1.3,
    out: string[] = [];
  for (let k = Math.floor(-L / p) - 1; k <= Math.ceil(L / p); k++) {
    const a = k * p,
      b = (k + d) * p,
      pt = (s: number, t: number) => `${f3(s * nx + t * tx)} ${f3(s * ny + t * ty)}`;
    out.push(`M${pt(a, -L)}L${pt(b, -L)}L${pt(b, L)}L${pt(a, L)}Z`);
  }
  return out.join('');
}

/** 半平面などの区画（多角形の頂点の並び）を clipPath にする */
const poly = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${f3(x)} ${f3(y)}`).join('L')}Z`;

/** バーティノフの 3 区画: [区画の多角形, 格子の法線] */
function bahtinovParts(m: Mask): [string, number, number][] {
  const b = m.bar / 2,
    c = Math.cos(m.th),
    s = Math.sin(m.th),
    L = 1.3;
  return [
    [
      poly([
        [-L, -b],
        [L, -b],
        [L, -L],
        [-L, -L],
      ]),
      1,
      0,
    ],
    [
      poly([
        [-L, b],
        [-b, b],
        [-b, L],
        [-L, L],
      ]),
      c,
      s,
    ],
    [
      poly([
        [b, b],
        [L, b],
        [L, L],
        [b, L],
      ]),
      c,
      -s,
    ],
  ];
}

/** マスクの正面の図。id は clipPath の名前の接頭辞（同じページに複数置くとき分ける） */
export function maskSvg(sc: Scope, m: Mask, id = 'mk'): string {
  const rot = (m.rot * 180) / Math.PI,
    defs: string[] = [`<clipPath id="${id}-a"><circle r="1"/></clipPath>`],
    body: string[] = [];
  const grating = (k: number, clip: string, nx: number, ny: number, tf = '') => {
    defs.push(`<clipPath id="${id}-${k}"><path d="${clip}"${tf ? ` transform="${tf}"` : ''}/></clipPath>`);
    body.push(
      `<g clip-path="url(#${id}-${k})"><path class="mk-o" d="${slits(nx, ny, m.p, m.duty)}"${tf ? ` transform="${tf}"` : ''}/></g>`,
    );
  };
  switch (m.kind) {
    case 'none':
      body.push('<circle class="mk-o" r="1"/>');
      break;
    case 'bahtinov':
      bahtinovParts(m).forEach(([clip, nx, ny], k) => {
        grating(k, clip, nx, ny);
      });
      break;
    case 'hartmann':
    case 'scheiner': {
      const n = m.kind === 'scheiner' ? 2 : m.holes;
      for (let i = 0; i < n; i++) {
        const a = Math.PI / 2 + (2 * Math.PI * i) / n;
        body.push(
          `<circle class="mk-o" cx="${f3(m.hr * Math.cos(a))}" cy="${f3(m.hr * Math.sin(a))}" r="${f3(m.hd / 2)}"/>`,
        );
      }
      break;
    }
    default:
      body.push('<circle class="mk-o" r="1"/>');
  }
  /* 副鏡とスパイダー（マスクと一緒に回さない） */
  const sec: string[] = [];
  if (sc.obs > 0) sec.push(`<circle class="mk-s" r="${f3(sc.obs)}"/>`);
  for (let i = 0; i < sc.vanes; i++) {
    const a = Math.PI / 2 + (2 * Math.PI * i) / sc.vanes;
    sec.push(
      `<path class="mk-v" d="M${f3(sc.obs * Math.cos(a))} ${f3(sc.obs * Math.sin(a))}L${f3(Math.cos(a))} ${f3(Math.sin(a))}" stroke-width="${f3(sc.vw)}"/>`,
    );
  }
  return (
    `<defs>${defs.join('')}</defs>` +
    `<g transform="scale(1 -1)"><circle class="mk-p" r="1.08"/>` +
    `<g clip-path="url(#${id}-a)"><g transform="rotate(${f3(-rot)})">${body.join('')}</g>${sec.join('')}</g>` +
    `<circle class="mk-r" r="1"/></g>`
  );
}
