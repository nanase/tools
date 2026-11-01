/** 材質のプリセットと色の変換 */
import { METALS, type Vec3 } from '../../lib/brdf';

export function hexToLinear(hex: string): Vec3 {
  const c = (i: number): number => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return [c(1), c(3), c(5)];
}

export function linearToHex(v: Vec3): string {
  const c = (x: number): string => {
    const t = Math.min(1, Math.max(0, x)),
      s = t <= 0.0031308 ? 12.92 * t : 1.055 * t ** (1 / 2.4) - 0.055;
    return Math.round(s * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${c(v[0])}${c(v[1])}${c(v[2])}`;
}

export interface MatPreset {
  id: string;
  name: string;
  hex: string;
  metal: number;
  f0: number;
  rough: number;
}

export const DEFAULT_HEX = '#c4372e';

export const PRESETS: readonly MatPreset[] = [
  { id: 'plastic', name: '赤いプラスチック', hex: DEFAULT_HEX, metal: 0, f0: 0.04, rough: 0.35 },
  { id: 'ceramic', name: '白い陶器', hex: '#e4e4dd', metal: 0, f0: 0.05, rough: 0.2 },
  { id: 'rubber', name: '黒いゴム', hex: '#262627', metal: 0, f0: 0.04, rough: 0.6 },
  { id: 'gold', name: '金', hex: linearToHex(METALS.gold), metal: 1, f0: 0.04, rough: 0.3 },
  { id: 'silver', name: '銀', hex: linearToHex(METALS.silver), metal: 1, f0: 0.04, rough: 0.2 },
  { id: 'copper', name: '銅', hex: linearToHex(METALS.copper), metal: 1, f0: 0.04, rough: 0.3 },
];
