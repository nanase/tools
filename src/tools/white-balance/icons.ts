/** ホワイトバランスのボタンのアイコン（viewBox 0 0 24 24 の中身。線は currentColor） */
import type { WbKey } from './wb';

export const WB_ICON: Record<WbKey, string> = {
  auto: '<rect x="2.5" y="5.5" width="19" height="13" rx="2"/><text x="12" y="15.3" text-anchor="middle">AWB</text>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  shadow:
    '<path d="M3 11l9-7 9 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M8 20l6-6M11.5 20l5-5M15 20l3.5-3.5M8 16.5l4-4"/>',
  cloud: '<path d="M7 18h10.5a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 18z"/>',
  bulb: '<path d="M9 17.5h6M9.5 20.5h5M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
  fl: '<rect x="3" y="9.5" width="18" height="5" rx="2.5"/><path d="M6 6.5l-1-2M12 6V3.5M18 6.5l1-2M6 17.5l-1 2M12 18v2.5M18 17.5l1 2"/>',
  temp: '<circle cx="12" cy="12" r="9"/><text x="12" y="16.2" text-anchor="middle" class="k">K</text>',
  pick: '<path d="M14.5 4.5l5 5M17 2.8a2.3 2.3 0 0 1 3.2 3.2l-2.4 2.4-3.2-3.2zM15 7.5L5.5 17l-1 3.5 3.5-1L17.5 10"/>',
};
