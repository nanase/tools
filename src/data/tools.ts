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
    id: 'jjy-decoder',
    c: '信号・通信',
    t: 'JJY デコーダ',
    d: '音声から JJY の信号を読み取り、信号が表す時刻とフラグに復号します。',
    ic: 'jjyd',
    k: '電波時計 標準電波 タイムコード 復号 デコード 受信 マイク decoder',
  },
  {
    id: 'oscilloscope',
    c: '信号・通信',
    t: 'オシロスコープ',
    d: 'マイクや音楽ファイルの音を波形で表示します。トリガと表示範囲を変えられ、リサジューも描けます。',
    ic: 'os',
    k: 'oscilloscope 波形 トリガ リサジュー lissajous マイク 音声 オーディオ audio',
  },
  {
    id: 'spectrum',
    c: '信号・通信',
    t: 'スペクトラムアナライザ',
    d: 'マイクや音楽ファイルの音を FFT で周波数に分け、スペクトラムとスペクトログラムで表示します。',
    ic: 'sp',
    k: 'spectrum analyzer fft スペクトル スペクトログラム spectrogram 周波数 窓関数 メル mel マイク 音声 オーディオ audio',
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
    id: 'colorcode',
    c: '電子回路',
    t: '抵抗カラーコード',
    d: '4〜6 本帯のカラーコードを読み取り、抵抗値から色の並びも逆引きします。',
    ic: 'cc',
    k: '色帯 color code e系列 許容差 resistor',
  },
  {
    id: 'pcb-coil',
    c: '電子回路',
    t: 'PCBコイル',
    d: 'プリント基板上のうずまき状の配線で作るコイルについて、インダクタンス・抵抗・Q と共振用のコンデンサを求めます。',
    ic: 'pc',
    k: 'pcb スパイラル うずまき アンテナ インダクタンス nfc rfid spiral coil antenna inductor',
  },
];
export const IC: Record<string, string> = {
  sq: '<path class="a" d="M4 38H16V10H40V38H52V10H76V38H88V10H112V38H116"/><path class="b" d="M16 31C24 22 32 18 40 17C44 24 48 29 52 31C60 22 68 18 76 17C80 24 84 29 88 31C96 22 104 18 112 17"/>',
  rr: '<path class="c" d="M4 24H22M46 24H60M60 12V36M60 12H70M94 12H106M60 36H70M94 36H106M106 12V36M106 24H116"/><rect class="a" x="22" y="18" width="24" height="12"/><rect class="a" x="70" y="6" width="24" height="12"/><rect class="b" x="70" y="30" width="24" height="12"/>',
  pid: '<path class="c d" d="M4 17H116"/><path class="a" d="M4 40H18C26 40 28 6 40 8S54 22 64 18S84 16 116 17"/>',
  bq: '<path class="c d" d="M4 24H116"/><path class="a" d="M4 12H46C60 12 66 12 72 20S92 40 116 44"/><path class="b" d="M4 30H36C54 30 62 36 70 40S100 44 116 44"/>',
  jjy: '<path class="a" d="M4 38V10H7V38H16V10H26V38H28V10H34V38H40V10H50V38H52V10H58V38H64V10H74V38H76V10H79V38H88V10H91V38H100V10H110V38H116"/>',
  jjyd: '<path class="b" d="M4 16L5 7L7 25L9 7L11 25L13 7L15 25L17 7L19 25L21 7L23 25L25 7L27 17.5L29 14.5L31 17.5L33 7L35 25L37 7L39 25L41 7L43 25L45 7L47 17.5L49 14.5L51 17.5L53 14.5L55 17.5L57 14.5L59 17.5L61 7L63 25L65 7L67 17.5L69 14.5L71 17.5L73 14.5L75 17.5L77 14.5L79 17.5L81 14.5L83 17.5L85 14.5L87 17.5L89 7L91 25L93 7L95 25L97 7L99 25L101 7L103 17.5L105 14.5L107 17.5L109 14.5L111 17.5L113 14.5L115 17.5"/><path class="a" d="M4 43V33H26V43H32V33H46V43H60V33H66V43H88V33H102V43H116"/>',
  svg: '<circle class="a" cx="42" cy="24" r="12"/><path class="a" d="M42 4V7M42 41V44M22 24H25M59 24H62"/><path class="b" d="M80 10A15 15 0 1 0 96 36A12 12 0 0 1 80 10Z"/>',
  cc: '<path class="c" d="M4 24H30M90 24H116"/><rect class="c" x="30" y="14" width="60" height="20" rx="8"/><path class="a" d="M42 14V34M52 14V34M62 14V34"/><path class="b" d="M78 14V34"/>',
  os: '<path class="c d" d="M4 24H116"/><path class="a" d="M4 24C10 9 16 9 22 24S34 39 40 24S52 9 58 24S70 39 76 24S88 9 94 24S106 39 112 24"/><path class="b" d="M4 30C12 17 19 17 27 30S43 43 51 30S67 17 75 30S91 43 99 30S112 21 116 26"/>',
  sp: '<path class="c d" d="M4 44H116"/><path class="a" d="M4 41L12 40L18 33L22 9L26 34L34 38L40 37L44 22L48 37L58 39L64 38L67 30L70 39L82 41L88 40L91 35L94 41L116 43"/>',
  pc: '<path class="c" d="M4 6H42"/><path class="a" d="M42 6H78V42H42V10H74V38H46V14H70V34H50V18H66V30H54V22H62"/><path class="c d" d="M62 22H116"/>',
};

/** 準備中を後ろへ */
export const order = (L: Tool[]): Tool[] => L.slice().sort((a, b) => (a.s || 0) - (b.s || 0));
/** ツールのページの URL */
export const href = (t: Tool): string => `${import.meta.env.BASE_URL}${t.id}/`;
/** 絞り込み用の検索文字列 */
export const keys = (t: Tool): string => `${t.t} ${t.d} ${t.c} ${t.k}`.normalize('NFKC').toLowerCase();
