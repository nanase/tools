/** ローブ（入射面の断面）の図: 半円の上に BRDF の値を極座標で描く */
import { lobeValue, MODELS, type ModelId, type Shade } from './models';

const CX = 180,
  CY = 186,
  R = 166;
/** 対数の目盛りの桁数 */
const DECADES = 3;

export interface Scale {
  map(f: number): number;
  /** 目盛り: [半径の割合, 値] */
  rings: [number, number][];
}

export function scaleOf(fmax: number, log: boolean): Scale {
  if (!log) return { map: (f) => f / fmax, rings: [1, 0.75, 0.5, 0.25].map((k) => [k, fmax * k]) };
  const lo = fmax / 10 ** DECADES,
    top = Math.floor(Math.log10(fmax) + 1e-9);
  const map = (f: number): number => Math.min(1, Math.max(0, Math.log10(Math.max(f, lo) / lo) / DECADES));
  return { map, rings: [0, 1, 2].map((i) => [map(10 ** (top - i)), 10 ** (top - i)]) };
}

const fmtV = (v: number): string => {
  if (v >= 1000) return `${Number((v / 1000).toPrecision(2))}k`;
  return String(Number(v.toPrecision(2)));
};
const r1 = (v: number): string => v.toFixed(1);

/** 断面の SVG の中身。thetaI は入射角 [rad] */
export function polarSvg(ids: readonly ModelId[], s: Shade, thetaI: number, log: boolean): string {
  const lines = new Map<ModelId, [number, number][]>();
  let fmax = 1e-6;
  for (const id of ids) {
    const a: [number, number][] = [];
    for (let p = -89.5; p <= 89.5; p += 0.5) {
      const q = (p * Math.PI) / 180,
        f = lobeValue(id, s, thetaI, q);
      a.push([q, f]);
      if (f > fmax) fmax = f;
    }
    lines.set(id, a);
  }
  const sc = scaleOf(fmax, log);
  let o = '';
  for (const [k, val] of sc.rings) {
    const r = R * k,
      lx = CX + r * Math.sin((62 * Math.PI) / 180) + 3,
      ly = CY - r * Math.cos((62 * Math.PI) / 180) - 2;
    o += `<path class="gl" fill="none" d="M${r1(CX - r)} ${CY}A${r1(r)} ${r1(r)} 0 0 1 ${r1(CX + r)} ${CY}"/>`;
    o += `<text x="${r1(lx)}" y="${r1(ly)}">${fmtV(val)}</text>`;
  }
  o += `<path class="gb" d="M${CX - R - 6} ${CY}H${CX + R + 6}"/><path class="gl" d="M${CX} ${CY}V${CY - R}"/>`;
  for (const m of MODELS) {
    const a = lines.get(m.id);
    if (!a) continue;
    const pts = a.map(([q, f]) => {
      const r = R * sc.map(f);
      return `${r1(CX + r * Math.sin(q))} ${r1(CY - r * Math.cos(q))}`;
    });
    o += `<path class="sh-lobe" style="stroke:var(${m.color})" d="M${CX} ${CY}L${pts.join('L')}Z"/>`;
  }
  const ex = Math.sin(thetaI),
    ez = Math.cos(thetaI),
    lx = CX - (R + 2) * ex,
    ly = CY - (R + 2) * ez,
    mx = CX + (R + 2) * ex,
    my = CY - (R + 2) * ez;
  o += `<path class="sh-ray" d="M${r1(lx)} ${r1(ly)}L${CX} ${CY}"/><circle class="sh-sun" cx="${r1(lx)}" cy="${r1(ly)}" r="4"/>`;
  o += `<path class="sh-mir" d="M${CX} ${CY}L${r1(mx)} ${r1(my)}"/>`;
  o += `<text x="${r1(lx + 8)}" y="${r1(Math.max(ly - 4, 10))}">光</text>`;
  o += `<text x="${r1(Math.min(mx + 5, 332))}" y="${r1(Math.max(my - 2, 10))}">正反射</text>`;
  return o;
}
