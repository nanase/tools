/** 部品を追加する道具の絵（viewBox 0 0 24 24 の SVG の中身。線は currentColor） */
import type { PartType } from './optics';

export const ICON: Record<PartType, string> = {
  beam: '<rect x="2" y="6" width="8" height="12" rx="1"/><path d="M10 9h12M10 12h12M10 15h12"/>',
  laser: '<rect x="2" y="9" width="10" height="6" rx="1"/><path d="M12 12h10"/>',
  lamp: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/>',
  prism: '<path d="M12 3L21.5 20H2.5z"/>',
  penta: '<path d="M4 20H16L21 8L16 3L4 8Z"/><path d="M16 20L21 8M16 3L4 8" stroke-width="2.8"/>',
  convex: '<path d="M12 2c4.5 3 4.5 17 0 20c-4.5-3-4.5-17 0-20z"/>',
  concave: '<path d="M7.5 2h9c-3 5-3 15 0 20h-9c3-5 3-15 0-20z"/>',
  semi: '<path d="M8 3a9 9 0 0 1 0 18z"/>',
  plate: '<rect x="3" y="8" width="18" height="8"/>',
  drop: '<circle cx="12" cy="12" r="8"/>',
  mirror: '<path d="M11 2v20" stroke-width="2.6"/><path d="M13 5l3-3M13 10l3-3M13 15l3-3M13 20l3-3"/>',
  cmirror: '<path d="M10 2q8 10 0 20" stroke-width="2.6"/>',
  half: '<path d="M12 2v20" stroke-dasharray="3 2.4" stroke-width="2"/>',
  screen: '<rect x="10" y="2" width="4" height="20"/>',
};
