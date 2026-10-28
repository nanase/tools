/** 例の SVG（一覧の順）。初期表示は先頭。それぞれのねらいは各ファイルの先頭のコメントに書く */
import badges from './samples/badges.svg?raw';
import calendar from './samples/calendar.svg?raw';
import diagram from './samples/diagram.svg?raw';
import logo from './samples/logo.svg?raw';
import ngLineart from './samples/ng-lineart.svg?raw';
import ngPartial from './samples/ng-partial.svg?raw';
import ngWhiteBg from './samples/ng-white-bg.svg?raw';
import postcard from './samples/sanitize.svg?raw';
import scenery from './samples/scenery.svg?raw';

export const SAMPLE_GROUPS = ['良い書き方', 'よくある失敗', '無害化の確認'] as const;

export interface Sample {
  id: string;
  name: string;
  group: (typeof SAMPLE_GROUPS)[number];
  svg: string;
}

export const SAMPLES: Sample[] = [
  { id: 'logo', name: 'ロゴ（CSS 変数）', group: '良い書き方', svg: logo },
  { id: 'scenery', name: '昼と夜の景色（light-dark）', group: '良い書き方', svg: scenery },
  { id: 'calendar', name: 'カレンダー（media 属性）', group: '良い書き方', svg: calendar },
  { id: 'badges', name: 'バッジ', group: '良い書き方', svg: badges },
  { id: 'diagram', name: '構成図', group: '良い書き方', svg: diagram },
  { id: 'ng-lineart', name: '色を決めていない線画', group: 'よくある失敗', svg: ngLineart },
  { id: 'ng-white-bg', name: '白い背景を敷いたグラフ', group: 'よくある失敗', svg: ngWhiteBg },
  { id: 'ng-partial', name: '背景だけ対応したカード', group: 'よくある失敗', svg: ngPartial },
  { id: 'sanitize', name: 'script を含む絵はがき', group: '無害化の確認', svg: postcard },
];
