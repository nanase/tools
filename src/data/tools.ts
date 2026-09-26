/** ツール一覧（ビルド時だけ使い、ブラウザへは送らない）。公開中のツールの id はページのパス（/tools/<id>/）を兼ねる */
export interface Tool {
  id: string;
  /** カテゴリ */
  c: string;
  t: string;
  d: string;
  /** カードの図柄（IC のキー） */
  ic: string;
  /** 絞り込み用の追加語 */
  k: string;
  /** 準備中 */
  s?: 1;
}

export const CATS = ['電子回路', '制御', 'デジタルフィルタ', '信号・通信', 'SVG'];
export const TOOLS: Tool[] = [
  {
    id: 'timer555',
    c: '電子回路',
    t: 'タイマIC 555 シミュレータ',
    d: '抵抗器とコンデンサによってタイマICの出力の変化をシミュレートします。',
    ic: 'sq',
    k: 'ne555 発振 非安定 マルチバイブレータ timer',
  },
  {
    id: 'passive-combination',
    c: '電子回路',
    t: '受動素子組み合わせ計算機',
    d: '抵抗器、コンデンサ、インダクタについて、任意の値に近似できる組み合わせを探索します。',
    ic: 'rr',
    k: '合成抵抗 直列 並列 e系列 resistor capacitor',
  },
  {
    id: 'pid',
    c: '制御',
    t: 'PID制御',
    d: 'フィードバック制御の一種であるPID制御を各項を調整しながらシミュレートします。',
    ic: 'pid',
    k: 'フィードバック 比例 積分 微分 control',
  },
  {
    id: 'biquad',
    c: 'デジタルフィルタ',
    t: '双2次フィルタ',
    d: '各種フィルタ特性に対応する双2次フィルタ（バイクアッドフィルタ）の係数を計算します。',
    ic: 'bq',
    k: 'biquad iir lpf hpf ローパス ハイパス',
  },
  {
    id: 'jjy',
    c: '信号・通信',
    t: 'JJY シミュレータ',
    d: '電波時計などで利用されているJJYの信号をシミュレートします。',
    ic: 'jjy',
    k: '電波時計 標準電波 タイムコード',
  },
  {
    id: 'svg-theme-checker',
    c: 'SVG',
    t: 'SVG テーマスキーマチェッカー',
    d: 'ライトテーマとダークテーマによって、SVGの外観が意図したものになるかを確認できます。',
    ic: 'svg',
    k: 'dark light ダーク ライト テーマ',
  },
  {
    s: 1,
    id: 'colorcode',
    c: '電子回路',
    t: '抵抗カラーコード',
    d: '4 本帯・5 本帯のカラーコードを読み取り、抵抗値から色の並びも逆引きします。',
    ic: 'cc',
    k: '色帯 color code',
  },
  {
    s: 1,
    id: 'led',
    c: '電子回路',
    t: 'LED 電流制限抵抗',
    d: '電源電圧・Vf・If から抵抗値と損失を求め、E 系列の推奨値を示します。',
    ic: 'led',
    k: '発光ダイオード 順方向電圧 vf if',
  },
  {
    s: 1,
    id: 'divider',
    c: '電子回路',
    t: '分圧回路',
    d: '目標の分圧比に近い E 系列の抵抗ペアを探索します。',
    ic: 'dv',
    k: '分圧 抵抗比 divider',
  },
  {
    s: 1,
    id: 'rc',
    c: '電子回路',
    t: 'RC フィルタ',
    d: 'カットオフ周波数を求め、ボード線図を描きます。',
    ic: 'rc',
    k: 'ローパス ハイパス カットオフ bode lpf hpf',
  },
  {
    s: 1,
    id: 'lc',
    c: '電子回路',
    t: 'LC 共振周波数',
    d: 'インダクタとコンデンサの値から共振周波数を求めます。',
    ic: 'lc',
    k: '共振 タンク resonance',
  },
  {
    s: 1,
    id: 'opamp',
    c: '電子回路',
    t: 'オペアンプ増幅回路',
    d: '反転・非反転増幅回路のゲインを抵抗値から計算します。',
    ic: 'oa',
    k: 'op amp 反転 非反転 ゲイン',
  },
  {
    s: 1,
    id: 'db',
    c: '信号・通信',
    t: 'dB 換算',
    d: '電圧比・電力比・dBm・dBV を相互に換算します。',
    ic: 'db',
    k: 'デシベル dbm dbv 換算',
  },
  {
    s: 1,
    id: 'uart',
    c: '信号・通信',
    t: 'UART ボーレート誤差',
    d: 'クロック周波数と分周比から、実際のボーレートと誤差を求めます。',
    ic: 'ua',
    k: 'シリアル baud 分周 serial',
  },
];
export const IC: Record<string, string> = {
  sq: '<path class="a" d="M4 38H16V10H40V38H52V10H76V38H88V10H112V38H116"/><path class="b" d="M16 31C24 22 32 18 40 17C44 24 48 29 52 31C60 22 68 18 76 17C80 24 84 29 88 31C96 22 104 18 112 17"/>',
  rr: '<path class="c" d="M4 24H22M46 24H60M60 12V36M60 12H70M94 12H106M60 36H70M94 36H106M106 12V36M106 24H116"/><rect class="a" x="22" y="18" width="24" height="12"/><rect class="a" x="70" y="6" width="24" height="12"/><rect class="b" x="70" y="30" width="24" height="12"/>',
  pid: '<path class="c d" d="M4 17H116"/><path class="a" d="M4 40H18C26 40 28 6 40 8S54 22 64 18S84 16 116 17"/>',
  bq: '<path class="c d" d="M4 24H116"/><path class="a" d="M4 12H46C60 12 66 12 72 20S92 40 116 44"/><path class="b" d="M4 30H36C54 30 62 36 70 40S100 44 116 44"/>',
  jjy: '<path class="a" d="M4 38V10H7V38H16V10H26V38H28V10H34V38H40V10H50V38H52V10H58V38H64V10H74V38H76V10H79V38H88V10H91V38H100V10H110V38H116"/>',
  svg: '<circle class="a" cx="42" cy="24" r="12"/><path class="a" d="M42 4V7M42 41V44M22 24H25M59 24H62"/><path class="b" d="M80 10A15 15 0 1 0 96 36A12 12 0 0 1 80 10Z"/>',
  cc: '<path class="c" d="M4 24H30M90 24H116"/><rect class="c" x="30" y="14" width="60" height="20" rx="8"/><path class="a" d="M42 14V34M52 14V34M62 14V34"/><path class="b" d="M78 14V34"/>',
  led: '<path class="c" d="M4 24H44M76 24H116M76 12V36"/><path class="a" d="M44 12V36L76 24Z"/><path class="b" d="M62 10L70 3M70 14L78 7"/>',
  dv: '<path class="c" d="M30 2V8M30 22V34M30 48V46M30 28H60"/><rect class="a" x="24" y="8" width="12" height="14"/><rect class="a" x="24" y="34" width="12" height="12"/><path class="b" d="M60 28H116"/>',
  lc: '<path class="a" d="M4 42C36 42 48 40 54 26S58 6 60 6S64 22 68 30S86 42 116 42"/><path class="c d" d="M60 6V46"/>',
  oa: '<path class="c" d="M40 8V40L80 24ZM4 16H40M4 32H40M45 16H51M48 13V19M45 32H51"/><path class="a" d="M80 24H116"/>',
  rc: '<path class="c d" d="M4 16H116M60 4V46"/><path class="a" d="M4 12H40C54 12 58 16 64 22S90 40 116 44"/><circle class="b" cx="60" cy="16" r="3"/>',
  ua: '<path class="a" d="M4 12H14V36H26V12H38V36H62V12H86V36H98V12H116"/>',
  db: '<path class="c" d="M4 38H116"/><path class="a" d="M8 38V16M40 38V26M58 38V29M70 38V31M78 38V32M84 38V33M112 38V16"/><path class="b d" d="M8 10L112 10"/>',
};

/** 準備中を後ろへ */
export const order = (L: Tool[]): Tool[] => L.slice().sort((a, b) => (a.s || 0) - (b.s || 0));
/** ツールのページの URL */
export const href = (t: Tool): string => `${import.meta.env.BASE_URL}${t.id}/`;
/** 絞り込み用の検索文字列 */
export const keys = (t: Tool): string => `${t.t} ${t.d} ${t.c} ${t.k}`.normalize('NFKC').toLowerCase();
