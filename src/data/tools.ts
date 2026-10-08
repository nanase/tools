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

export const CATS = ['電子回路', '制御', 'デジタルフィルタ', '信号・通信', '音響', '画像・光学', 'SVG'];
export const TOOLS: Tool[] = [
  {
    id: 'timer555',
    c: '電子回路',
    t: 'タイマIC 555',
    d: '抵抗器とコンデンサによってタイマICの出力の変化をシミュレートします。',
    ic: 'sq',
    k: 'ne555 発振 非安定 マルチバイブレータ timer シミュレータ simulator',
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
    id: 'pendulum',
    c: '制御',
    t: '倒立振子',
    d: '台車に立てた振子を PID・極配置・LQR で支え、エネルギー法で振り上げます。制御周期やエンコーダの分解能など実機の制約も再現します。',
    ic: 'ip',
    k: 'inverted pendulum cart pole 倒立振り子 台車 振り上げ swing up エネルギー法 lqr リカッチ riccati 極配置 pole placement アッカーマン ackermann 状態フィードバック state feedback 可制御 controllability pid エンコーダ encoder quanser ip02 control',
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
    id: 'iir',
    c: 'デジタルフィルタ',
    t: 'IIR フィルタ',
    d: 'バターワース・チェビシェフ・楕円・ベッセルのアナログ原型から、双一次変換で IIR フィルタを設計します。',
    ic: 'iir',
    k: 'iir butterworth chebyshev elliptic cauer bessel 楕円 チェビシェフ バターワース ベッセル 双一次変換 bilinear プリワーピング インパルス不変 sos 縦続 双2次 極 零点 群遅延 lpf hpf bpf bsf ローパス ハイパス バンドパス',
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
    id: 'fir',
    c: 'デジタルフィルタ',
    t: 'FIR フィルタ',
    d: '窓関数法や Parks–McClellan 法で直線位相の FIR フィルタを設計し、周波数特性・零点・係数を求めます。',
    ic: 'fir',
    k: 'fir finite impulse response 有限インパルス応答 窓関数 window カイザー kaiser ハミング hamming ハン hann ブラックマン blackman 等リップル equiripple parks-mcclellan remez 最小二乗 least squares 直線位相 linear phase タップ tap 係数 lpf hpf bpf bsf ローパス ハイパス',
  },
  {
    id: 'oscilloscope',
    c: '音響',
    t: 'オシロスコープ',
    d: 'マイクや音楽ファイルの音を波形で表示します。トリガと表示範囲を変えられ、リサジューも描けます。',
    ic: 'os',
    k: 'oscilloscope 波形 トリガ リサジュー lissajous マイク 音声 オーディオ audio',
  },
  {
    id: 'spectrum',
    c: '音響',
    t: 'スペクトラムアナライザ',
    d: 'マイクや音楽ファイルの音を FFT で周波数に分け、スペクトラムとスペクトログラムで表示します。',
    ic: 'sp',
    k: 'spectrum analyzer fft スペクトル スペクトログラム spectrogram 周波数 窓関数 メル mel マイク 音声 オーディオ audio',
  },
  {
    id: 'fm-synth',
    c: '音響',
    t: 'FM音源',
    d: 'ヤマハの FM 音源 IC のように 4 つのオペレータをアルゴリズムでつなぎ、波形とスペクトラムを表示して音でも鳴らします。',
    ic: 'fm',
    k: 'fm synth synthesizer シンセサイザー 周波数変調 オペレータ アルゴリズム 変調指数 opn ym2612 ym2203 ym2608 ベッセル 音色 オーディオ audio',
  },
  {
    id: 'noise',
    c: '音響',
    t: 'ノイズジェネレータ',
    d: 'ホワイト・ピンク・ブラウンなどの色のノイズや、線形帰還シフトレジスタ（LFSR）によるノイズを作り、波形とスペクトログラムで表示して音でも鳴らします。',
    ic: 'nz',
    k: 'noise generator 雑音 ノイズ white ホワイトノイズ 白色雑音 pink ピンクノイズ 1/f brown ブラウンノイズ red 赤色雑音 blue ブルー violet バイオレット grey gray グレー velvet ベルベット lfsr 線形帰還シフトレジスタ m系列 m-sequence prbs 疑似乱数 原始多項式 ファミコン nes ゲームボーイ gameboy sn76489 スペクトル スペクトログラム spectrogram オーディオ audio',
  },
  {
    id: 'guitar',
    c: '音響',
    t: 'ギター音響モデル',
    d: '弦の材質・太さ・張力、押さえるフレット、弾き方、表板と胴、部屋の残響から、アコースティックギターの振動と音を物理モデルで計算して鳴らします。',
    ic: 'gt',
    k: 'guitar acoustic physical model 物理モデル 弦 string 張力 tension フレット fret 響板 表板 soundboard ヘルムホルツ helmholtz 撥弦 pluck 非調和性 inharmonicity 残響 reverb モード合成 modal synthesis 演奏 バッハ bach クラシック ナイロン スチール オーディオ audio',
  },
  {
    id: 'piano',
    c: '音響',
    t: 'ピアノ音響モデル',
    d: 'ハンマーと弦の衝突、ユニゾンの弦と響板の結合、ダンパーとペダル、部屋の残響から、グランドピアノの振動と音を物理モデルで計算して鳴らします。',
    ic: 'pn',
    k: 'piano grand acoustic physical model 物理モデル 弦 string ハンマー hammer フェルト felt 響板 soundboard 非調和性 inharmonicity ユニゾン unison 二段減衰 double decay ダンパー damper ペダル pedal 共鳴 sympathetic 残響 reverb モード合成 modal synthesis 演奏 バッハ ベートーヴェン 月光 サティ オーディオ audio',
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
    id: 'pole-zero',
    c: 'デジタルフィルタ',
    t: '極と零点',
    d: 'z 平面に極と零点を置いて動かし、周波数特性・インパルス応答・係数を求めます。',
    ic: 'pz',
    k: 'pole zero z平面 z-plane 伝達関数 transfer function 周波数特性 振幅 位相 群遅延 group delay 安定 stability 双2次 縦続 sos biquad iir fir 共振 resonator ノッチ notch オールパス allpass くし形 comb 移動平均',
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
  {
    id: 'jpeg',
    c: '画像・光学',
    t: 'JPEG',
    d: '画像を JPEG に符号化する過程を、色の変換・DCT・量子化・ハフマン符号まで順に見せ、圧縮の結果と画質を比べます。',
    ic: 'jp',
    k: 'jpeg jpg 画像 圧縮 image compression dct 離散コサイン変換 量子化 quantization ハフマン huffman ジグザグ zigzag ycbcr 色差 間引き chroma subsampling 4:2:0 ブロックノイズ psnr',
  },
  {
    id: 'organ',
    c: '音響',
    t: 'オルガン音響モデル',
    d: 'エアジェットとリードの自励振動、管の共鳴、風箱の風、教会の残響から、パイプオルガンの音を物理モデルで計算して鳴らします。',
    ic: 'og',
    k: 'organ pipe organ パイプオルガン acoustic physical model 物理モデル フルー管 flue リード管 reed ジェット jet エッジトーン 共鳴管 resonator ストップ stop レジストレーション registration プリンシパル ゲダクト トランペット 風箱 wind トレモラント tremulant 調律 temperament 教会 残響 reverb 演奏 バッハ bach オーディオ audio',
  },
  {
    id: 'lens',
    c: '画像・光学',
    t: 'カメラレンズ',
    d: '実在のレンズの処方（面の曲率・間隔・硝材）のとおりに光線を追跡し、絞り・焦点距離・ピントで変わるボケや被写界深度、収差を 3D の被写体の映像で再現します。',
    ic: 'ln',
    k: 'lens camera optics レンズ カメラ 光学 光線追跡 ray tracing 絞り aperture f値 焦点距離 focal length ピント focus 被写界深度 depth of field ボケ bokeh 玉ボケ 収差 aberration ザイデル seidel 球面収差 コマ 非点収差 像面湾曲 歪曲 distortion 色収差 chromatic 周辺減光 vignetting ダブルガウス double gauss テッサー tessar トリプレット triplet アクロマート achromat 望遠 広角 webgl',
  },
];
export const IC: Record<string, string> = {
  sq: '<path class="a" d="M4 38H16V10H40V38H52V10H76V38H88V10H112V38H116"/><path class="b" d="M16 31C24 22 32 18 40 17C44 24 48 29 52 31C60 22 68 18 76 17C80 24 84 29 88 31C96 22 104 18 112 17"/>',
  rr: '<path class="c" d="M4 24H22M46 24H60M60 12V36M60 12H70M94 12H106M60 36H70M94 36H106M106 12V36M106 24H116"/><rect class="a" x="22" y="18" width="24" height="12"/><rect class="a" x="70" y="6" width="24" height="12"/><rect class="b" x="70" y="30" width="24" height="12"/>',
  pid: '<path class="c d" d="M4 17H116"/><path class="a" d="M4 40H18C26 40 28 6 40 8S54 22 64 18S84 16 116 17"/>',
  ip: '<path class="c" d="M4 42H116"/><path class="c" d="M46 30H74V38H46Z"/><path class="c d" d="M60 30V4"/><path class="a" d="M60 30L71 7"/><path class="b" d="M82 18C85 9 88 9 91 18S97 25 100 18S105 14 108 18S113 20 116 18"/>',
  bq: '<path class="c d" d="M4 24H116"/><path class="a" d="M4 12H46C60 12 66 12 72 20S92 40 116 44"/><path class="b" d="M4 30H36C54 30 62 36 70 40S100 44 116 44"/>',
  iir: '<path class="c d" d="M4 16H58V44M66 4V34H116"/><path class="a" d="M4 11C9 11 11 14 16 14S24 10 30 10S38 14 44 14S52 10 56 11C59 12 60 26 64 44C66 38 68 35 72 35S78 40 80 44C82 39 85 35 92 35S104 37 116 38"/>',
  jjy: '<path class="a" d="M4 38V10H7V38H16V10H26V38H28V10H34V38H40V10H50V38H52V10H58V38H64V10H74V38H76V10H79V38H88V10H91V38H100V10H110V38H116"/>',
  jjyd: '<path class="b" d="M4 16L5 7L7 25L9 7L11 25L13 7L15 25L17 7L19 25L21 7L23 25L25 7L27 17.5L29 14.5L31 17.5L33 7L35 25L37 7L39 25L41 7L43 25L45 7L47 17.5L49 14.5L51 17.5L53 14.5L55 17.5L57 14.5L59 17.5L61 7L63 25L65 7L67 17.5L69 14.5L71 17.5L73 14.5L75 17.5L77 14.5L79 17.5L81 14.5L83 17.5L85 14.5L87 17.5L89 7L91 25L93 7L95 25L97 7L99 25L101 7L103 17.5L105 14.5L107 17.5L109 14.5L111 17.5L113 14.5L115 17.5"/><path class="a" d="M4 43V33H26V43H32V33H46V43H60V33H66V43H88V33H102V43H116"/>',
  fir: '<path class="c d" d="M4 34H116"/><path class="b" d="M8 34C28 34 40 6 60 6S92 34 112 34"/><path class="a" d="M12 34V32.7M28 34V37.4M36 34V37.4M44 34V28.5M52 34V14.8M60 34V8M68 34V14.8M76 34V28.5M84 34V37.4M92 34V37.4M108 34V32.7"/>',
  svg: '<circle class="a" cx="42" cy="24" r="12"/><path class="a" d="M42 4V7M42 41V44M22 24H25M59 24H62"/><path class="b" d="M80 10A15 15 0 1 0 96 36A12 12 0 0 1 80 10Z"/>',
  pz: '<path class="c d" d="M32 24H88M60 2V46"/><circle class="c" cx="60" cy="24" r="18"/><path class="a" d="M66 12L72 18M66 18L72 12M66 30L72 36M66 36L72 30"/><circle class="b" cx="47.3" cy="11.3" r="3.5"/><circle class="b" cx="47.3" cy="36.7" r="3.5"/>',
  cc: '<path class="c" d="M4 24H30M90 24H116"/><rect class="c" x="30" y="14" width="60" height="20" rx="8"/><path class="a" d="M42 14V34M52 14V34M62 14V34"/><path class="b" d="M78 14V34"/>',
  os: '<path class="c d" d="M4 24H116"/><path class="a" d="M4 24C10 9 16 9 22 24S34 39 40 24S52 9 58 24S70 39 76 24S88 9 94 24S106 39 112 24"/><path class="b" d="M4 30C12 17 19 17 27 30S43 43 51 30S67 17 75 30S91 43 99 30S112 21 116 26"/>',
  sp: '<path class="c d" d="M4 44H116"/><path class="a" d="M4 41L12 40L18 33L22 9L26 34L34 38L40 37L44 22L48 37L58 39L64 38L67 30L70 39L82 41L88 40L91 35L94 41L116 43"/>',
  fm: '<path class="c d" d="M4 24H116"/><path class="a" d="M4 24L6 13.5L8 8.2L10 9.8L12 16L14 23.4L16 29.5L18 33.4L20 35.5L22 36.1L24 35.7L26 34.3L28 31.8L30 28.2L32 24L34 19.8L36 16.2L38 13.7L40 12.3L42 11.9L44 12.5L46 14.6L48 18.5L50 24.6L52 32L54 38.2L56 39.8L58 34.5L60 24L62 13.5L64 8.2L66 9.8L68 16L70 23.4L72 29.5L74 33.4L76 35.5L78 36.1L80 35.7L82 34.3L84 31.8L86 28.2L88 24L90 19.8L92 16.2L94 13.7L96 12.3L98 11.9L100 12.5L102 14.6L104 18.5L106 24.6L108 32L110 38.2L112 39.8L114 34.5L116 24"/>',
  nz: '<path class="a" d="M4 16L6 17L8 12L10 13L12 9L14 17L16 20L18 14L20 25L22 26L24 16L26 14L28 8L30 11L32 16L34 11L36 17L38 14L40 20L42 19L44 15L46 18L48 11L50 15L52 10L54 17L56 16L58 10L60 25L62 15L64 18L66 16L68 15L70 22L72 8L74 17L76 16L78 12L80 13L82 18L84 21L86 15L88 14L90 26L92 18L94 7L96 18L98 13L100 11L102 14L104 17L106 12L108 10L110 14L112 22L114 19L116 12"/><path class="b" d="M4 43H8V33H32V43H36V33H56V43H64V33H80V43H84V33H88V43H92V33H104V43H116"/>',
  gt: '<path class="c" d="M4 10H116M4 38H116"/><path class="a" d="M4 24C16 24 20 13 34 13S52 35 66 35S84 13 98 13S110 24 116 24"/><path class="b" d="M4 24C16 24 20 17 34 17S52 31 66 31S84 17 98 17S110 24 116 24"/>',
  pn: '<path class="c" d="M4 44H116"/><path class="c" d="M10 44V30M24 44V30M38 44V30M52 44V30M66 44V30M80 44V30M94 44V30M108 44V30"/><path class="a" d="M8 4V30M16 8V30M24 12V30M32 15V30M40 18V30M48 20V30M56 22V30M64 24V30M72 25V30M80 26V30M88 27V30M96 28V30M104 28.5V30"/><path class="b" d="M4 30C20 30 22 22 36 22S60 34 76 30S104 26 116 28"/>',
  pc: '<path class="c" d="M4 6H42"/><path class="a" d="M42 6H78V42H42V10H74V38H46V14H70V34H50V18H66V30H54V22H62"/><path class="c d" d="M62 22H116"/>',
  jp: '<path class="c" d="M4 4H44V44H4Z"/><path class="a" d="M9 9H19L9 19V29L29 9H39L9 39H19L39 19V29L29 39H39"/><path class="c d" d="M52 44H116"/><path class="b" d="M56 44V6M64 44V18M72 44V27M80 44V33M88 44V37M96 44V40M104 44V41.5M112 44V42.5"/>',
  og: '<path class="c" d="M4 44H116"/><path class="a" d="M14 44V8M26 44V14M38 44V19M50 44V23M62 44V26M74 44V29M86 44V31M98 44V33M110 44V35"/><path class="b" d="M11 38H17M23 39H29M35 40H41M47 40H53M59 41H65M71 41H77M83 42H89M95 42H101M107 42H113"/>',
  ln: '<path class="c d" d="M4 24H116"/><path class="c" d="M40 5C49 14 49 34 40 43C31 34 31 14 40 5ZM100 6V42"/><path class="a" d="M4 13H40L100 24M4 35H40L100 24"/><path class="b" d="M4 12L40 16L100 30M4 26L40 30L100 30"/>',
};

/** 準備中を後ろへ */
export const order = (L: Tool[]): Tool[] => L.slice().sort((a, b) => (a.s || 0) - (b.s || 0));
/** ツールのページの URL */
export const href = (t: Tool): string => `${import.meta.env.BASE_URL}${t.id}/`;
/** 絞り込み用の検索文字列 */
export const keys = (t: Tool): string => `${t.t} ${t.d} ${t.c} ${t.k}`.normalize('NFKC').toLowerCase();
