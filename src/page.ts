export interface Page {
  id: string;
  title: string;
  menuTitle?: string;
  description?: string;
  path?: string;
  icon?: string;
}

export interface PageSection {
  id: string;
  name: string;
  pages: Page[];
}

export const PageList: PageSection[] = [
  {
    id: 'control',
    name: '制御',
    pages: [
      {
        id: 'control/pid',
        title: 'PID制御',
        icon: 'mdi-ship-wheel',
        description: 'フィードバック制御の一種であるPID制御を各項を調整しながらシミュレートします。',
      },
    ],
  },
  {
    id: 'electric',
    name: '電子回路',
    pages: [
      {
        id: 'electric/combination',
        title: '受動素子組み合わせ計算機',
        menuTitle: '受動素子組み合わせ',
        icon: 'mdi-resistor',
        description: '抵抗器、コンデンサ、インダクタについて、任意の値に近似できる組み合わせを探索します。',
      },
      {
        id: 'electric/timer555',
        title: 'タイマIC 555 シミュレータ',
        menuTitle: 'タイマIC 555',
        icon: 'mdi-chip',
        description: '抵抗器とコンデンサによってタイマICの出力の変化をシミュレートします。',
      },
    ],
  },
  {
    id: 'filter',
    name: 'デジタルフィルタ',
    pages: [
      {
        id: 'filter/biquad',
        title: '双2次フィルタ',
        icon: 'mdi-filter',
        description: '各種フィルタ特性に対応する双2次フィルタ（バイクアッドフィルタ）の係数を計算します。',
      },
    ],
  },
  {
    id: 'jjy',
    name: 'JJY',
    pages: [
      {
        id: 'jjy/simulator',
        title: 'JJY シミュレータ',
        menuTitle: 'シミュレータ',
        icon: 'mdi-alarm',
        description: '電波時計などで利用されているJJYの信号をシミュレートします。',
      },
    ],
  },
  {
    id: 'svg',
    name: 'SVG',
    pages: [
      {
        id: 'svg/theme-checker',
        title: 'SVG テーマスキーマチェッカー',
        menuTitle: 'テーマスキーマチェッカー',
        icon: 'mdi-theme-light-dark',
        description: 'ライトテーマとダークテーマによって、SVGの外観が意図したものになるかを確認できます。',
      },
    ],
  },
];
