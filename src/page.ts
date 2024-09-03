export interface Page {
  id: string;
  title: string;
  path?: string;
  icon?: string;
}

export interface PageSection {
  id: string;
  pages: Page[];
}

export const PageList: PageSection[] = [
  {
    id: 'control',
    pages: [
      {
        id: 'control/pid',
        title: 'PID制御',
        icon: 'mdi-ship-wheel',
      },
    ],
  },
  {
    id: 'electric',
    pages: [
      {
        id: 'electric/combination',
        title: '受動素子 組み合わせ',
        icon: 'mdi-resistor',
      },
      {
        id: 'electric/timer555',
        title: 'タイマIC 555',
        icon: 'mdi-chip',
      },
    ],
  },
  {
    id: 'filter',
    pages: [
      {
        id: 'filter/biquad',
        title: '双2次フィルタ',
        icon: 'mdi-filter',
      },
    ],
  },
  {
    id: 'jjy',
    pages: [
      {
        id: 'jjy/simulator',
        title: 'JJY シミュレータ',
        icon: 'mdi-alarm',
      },
    ],
  },
  {
    id: 'svg',
    pages: [
      {
        id: 'svg/theme-checker',
        title: 'SVG テーマスキーマチェッカー',
        icon: 'mdi-theme-light-dark',
      },
    ],
  },
];
