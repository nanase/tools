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
    id: 'electric',
    pages: [
      {
        id: 'electric/timer555',
        title: 'タイマIC 555 計算機',
        icon: 'mdi-chip',
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
];
