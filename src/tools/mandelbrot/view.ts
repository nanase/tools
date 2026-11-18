/**
 * 見ている範囲。中心は固定小数点、倍率は倍精度で持つ。
 * 画面の座標 (u, v) は図の中心を 0、高さの半分を 1 とし、v は下向き。虚軸も下向きに描くので、点は中心 + (u, v) × span になる
 */
import { fromFix, toFix } from './fixed';

/** 倍率 1 で図の高さの半分に入る長さ */
const SPAN1 = 1.5;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 1e30;
/** 目標の倍率へ寄せる速さ [1/s] */
const RATE = 10;

interface Anim {
  ax: bigint;
  ay: bigint;
  /** 動き始めの中心の、錨の点からのずれ */
  ox: number;
  oy: number;
  z0: number;
  /** 目標の倍率の自然対数 */
  tgt: number;
}

export class View {
  /** 倍率の上限（べきが整数でない間は小さくする） */
  max = ZOOM_MAX;
  private anim: Anim | null = null;

  constructor(
    public cx: bigint,
    public cy: bigint,
    public zoom: number,
  ) {}

  span(): number {
    return SPAN1 / this.zoom;
  }

  pointAt(u: number, v: number): [bigint, bigint] {
    const s = this.span();
    return [this.cx + toFix(u * s), this.cy + toFix(v * s)];
  }

  private clamp(z: number): number {
    return Math.min(this.max, Math.max(ZOOM_MIN, z));
  }

  /** 倍率を f 倍にする目標を置く。(u, v) の点を動かさない（省けば中心） */
  zoomBy(f: number, u = 0, v = 0): void {
    const [ax, ay] = this.pointAt(u, v);
    const from = this.anim ? Math.exp(this.anim.tgt) : this.zoom;
    this.anim = {
      ax,
      ay,
      ox: fromFix(this.cx - ax),
      oy: fromFix(this.cy - ay),
      z0: this.zoom,
      tgt: Math.log(this.clamp(from * f)),
    };
  }

  /** 目標へ寄せる。動いたら true */
  step(dt: number): boolean {
    const a = this.anim;
    if (!a) return false;
    const c = Math.log(this.zoom),
      nz = c + (a.tgt - c) * Math.min(1, dt * RATE),
      end = Math.abs(a.tgt - nz) < 1e-3;
    this.zoom = Math.exp(end ? a.tgt : nz);
    const k = a.z0 / this.zoom;
    this.cx = a.ax + toFix(a.ox * k);
    this.cy = a.ay + toFix(a.oy * k);
    if (end) this.anim = null;
    return true;
  }

  get moving(): boolean {
    return this.anim !== null;
  }

  /** 中身を (du, dv) だけ動かす（ドラッグ） */
  pan(du: number, dv: number): void {
    const s = this.span(),
      dx = toFix(-du * s),
      dy = toFix(-dv * s);
    this.cx += dx;
    this.cy += dy;
    if (this.anim) {
      this.anim.ax += dx;
      this.anim.ay += dy;
    }
  }

  /** (u0, v0) にあった点を (u1, v1) へ移しながら倍率を ratio 倍にする（2 本指） */
  pinch(u0: number, v0: number, u1: number, v1: number, ratio: number): void {
    const [px, py] = this.pointAt(u0, v0);
    this.zoom = this.clamp(this.zoom * ratio);
    const s = this.span();
    this.cx = px - toFix(u1 * s);
    this.cy = py - toFix(v1 * s);
    this.anim = null;
  }

  jump(cx: bigint, cy: bigint, zoom: number): void {
    this.cx = cx;
    this.cy = cy;
    this.zoom = this.clamp(zoom);
    this.anim = null;
  }

  /** 上限を変え、超えていれば戻す */
  setMax(max: number): void {
    this.max = max;
    if (this.zoom > max) this.zoom = max;
    if (this.anim && this.anim.tgt > Math.log(max)) this.anim.tgt = Math.log(max);
  }

  save(): { cx: string; cy: string; z: number } {
    return { cx: this.cx.toString(), cy: this.cy.toString(), z: this.zoom };
  }
}

/** 保存した範囲を読む。壊れていれば null */
export function parseView(o: unknown): { cx: bigint; cy: bigint; zoom: number } | null {
  if (!o || typeof o !== 'object') return null;
  const { cx, cy, z } = o as Record<string, unknown>;
  if (typeof cx !== 'string' || typeof cy !== 'string' || typeof z !== 'number') return null;
  if (!/^-?\d+$/.test(cx) || !/^-?\d+$/.test(cy) || !(z >= ZOOM_MIN && z <= ZOOM_MAX)) return null;
  return { cx: BigInt(cx), cy: BigInt(cy), zoom: z };
}

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (n: number): string =>
  (n < 0 ? '⁻' : '') +
  String(Math.abs(n))
    .split('')
    .map((d) => SUP[+d])
    .join('');

/** 倍率の表示（×1.00・×180・×3.00×10¹³） */
export function fmtZoom(z: number): string {
  if (z < 1000) return `×${z < 10 ? z.toFixed(2) : z < 100 ? z.toFixed(1) : z.toFixed(0)}`;
  let e = Math.floor(Math.log10(z)),
    m = z / 10 ** e;
  if (m >= 9.995) {
    m /= 10;
    e++;
  }
  return `×${m.toFixed(2)}×10${sup(e)}`;
}

/** べきの表示（整数は z の右肩、それ以外は小数 2 桁） */
export const fmtPower = (p: number): string =>
  Math.abs(p - Math.round(p)) < 1e-9 ? `z${sup(Math.round(p))}` : `z^${p.toFixed(2)}`;
