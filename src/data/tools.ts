/** ツール一覧（ビルド時だけ使い、ブラウザへは送らない）。公開中のツールの id はページのパス（/tools/<id>/）を兼ねる */
export interface Tool {
  id: string;
  /** カテゴリ */
  c: string;
  t: string;
  d: string;
  /** カードの図柄（lib/card-art.ts の ART のキー） */
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
    d: '抵抗器とコンデンサを使ったタイマIC555の出力をシミュレートします。',
    ic: 'sq',
    k: 'ne555 発振 非安定 マルチバイブレータ timer シミュレータ simulator',
  },
  {
    id: 'passive-combination',
    c: '電子回路',
    t: '受動素子組み合わせ計算機',
    d: '抵抗器・コンデンサ・インダクタにおける最適な組み合わせを探索します。',
    ic: 'rr',
    k: '合成抵抗 直列 並列 e系列 resistor capacitor',
  },
  {
    id: 'pid',
    c: '制御',
    t: 'PID制御',
    d: 'フィードバック制御の一種であるPID制御の応答を計算します。',
    ic: 'pid',
    k: 'フィードバック 比例 積分 微分 control',
  },
  {
    id: 'pendulum',
    c: '制御',
    t: '倒立振子',
    d: '台車に立てた振子を PID・極配置・LQR を使って倒れないようにします。',
    ic: 'ip',
    k: 'inverted pendulum cart pole 倒立振り子 台車 振り上げ swing up エネルギー法 lqr リカッチ riccati 極配置 pole placement アッカーマン ackermann 状態フィードバック state feedback 可制御 controllability pid エンコーダ encoder quanser ip02 control',
  },
  {
    id: 'biquad',
    c: 'デジタルフィルタ',
    t: '双2次フィルタ',
    d: 'ローパスなど各種特性の双2次フィルタの係数を計算します。',
    ic: 'bq',
    k: 'biquad iir lpf hpf ローパス ハイパス',
  },
  {
    id: 'iir',
    c: 'デジタルフィルタ',
    t: 'IIR フィルタ',
    d: 'バターワース・チェビシェフなどの IIR フィルタを双一次変換で設計します。',
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
    d: '直線位相の FIR フィルタを設計し周波数特性・零点・係数を求めます。',
    ic: 'fir',
    k: 'fir finite impulse response 有限インパルス応答 窓関数 window カイザー kaiser ハミング hamming ハン hann ブラックマン blackman 等リップル equiripple parks-mcclellan remez 最小二乗 least squares 直線位相 linear phase タップ tap 係数 lpf hpf bpf bsf ローパス ハイパス',
  },
  {
    id: 'oscilloscope',
    c: '音響',
    t: 'オシロスコープ',
    d: 'マイクや音楽ファイルの音を波形やリサジューで表示します。',
    ic: 'os',
    k: 'oscilloscope 波形 トリガ リサジュー lissajous マイク 音声 オーディオ audio',
  },
  {
    id: 'spectrum',
    c: '音響',
    t: 'スペクトラムアナライザ',
    d: 'マイクや音楽ファイルの音をスペクトラムまたはスペクトログラムで表示します。',
    ic: 'sp',
    k: 'spectrum analyzer fft スペクトル スペクトログラム spectrogram 周波数 窓関数 メル mel マイク 音声 オーディオ audio',
  },
  {
    id: 'fm-synth',
    c: '音響',
    t: 'FM音源',
    d: '4 つのオペレータの FM 音源で波形と音を作ります。',
    ic: 'fm',
    k: 'fm synth synthesizer ヤマハ yamaha シンセサイザー 周波数変調 オペレータ アルゴリズム 変調指数 opn ym2612 ym2203 ym2608 ベッセル 音色 オーディオ audio',
  },
  {
    id: 'noise',
    c: '音響',
    t: 'ノイズジェネレータ',
    d: 'ホワイト・ピンクなどの色のノイズやLFSR のノイズを作って鳴らします。',
    ic: 'nz',
    k: 'noise generator 雑音 ノイズ white ホワイトノイズ 白色雑音 pink ピンクノイズ 1/f brown ブラウンノイズ red 赤色雑音 blue ブルー violet バイオレット grey gray グレー velvet ベルベット lfsr 線形帰還シフトレジスタ m系列 m-sequence prbs 疑似乱数 原始多項式 ファミコン nes ゲームボーイ gameboy sn76489 スペクトル スペクトログラム spectrogram オーディオ audio',
  },
  {
    id: 'guitar',
    c: '音響',
    t: 'ギター音響モデル',
    d: 'アコースティックギターの弦と胴の振動を物理モデルで計算して鳴らします。',
    ic: 'gt',
    k: 'guitar acoustic physical model 物理モデル 弦 string 張力 tension フレット fret 響板 表板 soundboard ヘルムホルツ helmholtz 撥弦 pluck 非調和性 inharmonicity 残響 reverb モード合成 modal synthesis 演奏 バッハ bach クラシック ナイロン スチール オーディオ audio',
  },
  {
    id: 'piano',
    c: '音響',
    t: 'ピアノ音響モデル',
    d: 'グランドピアノのハンマー・弦・響板を物理モデルで計算して鳴らします。',
    ic: 'pn',
    k: 'piano grand acoustic physical model 物理モデル 弦 string ハンマー hammer フェルト felt 響板 soundboard 非調和性 inharmonicity ユニゾン unison 二段減衰 double decay ダンパー damper ペダル pedal 共鳴 sympathetic 残響 reverb モード合成 modal synthesis 演奏 バッハ ベートーヴェン 月光 サティ オーディオ audio',
  },
  {
    id: 'violin',
    c: '音響',
    t: 'ヴァイオリン音響モデル',
    d: 'ヴァイオリンの弓・弦・胴を物理モデルで計算して鳴らします。',
    ic: 'vn',
    k: 'violin bowed string acoustic physical model 物理モデル 弓 bow 擦弦 弓圧 bow force 弓速 bow speed 駒 bridge ヘルムホルツ運動 helmholtz motion シェレンゲ schelleng 摩擦 friction 松脂 rosin 重音 double stop ビブラート vibrato 胴 body 弱音器 mute 残響 reverb モード合成 modal synthesis 演奏 バッハ bach シャコンヌ chaconne パルティータ partita エクルズ eccles オーディオ audio',
  },
  {
    id: 'svg-theme-checker',
    c: 'SVG',
    t: 'SVG テーマスキーマチェッカー',
    d: 'ライトテーマとダークテーマによってSVGの外観が意図したものになるかを確認できます。',
    ic: 'svg',
    k: 'dark light ダーク ライト テーマ',
  },
  {
    id: 'pole-zero',
    c: 'デジタルフィルタ',
    t: '極と零点',
    d: 'z 平面に極と零点を置いて周波数特性・インパルス応答・係数を求めます。',
    ic: 'pz',
    k: 'pole zero z平面 z-plane 伝達関数 transfer function 周波数特性 振幅 位相 群遅延 group delay 安定 stability 双2次 縦続 sos biquad iir fir 共振 resonator ノッチ notch オールパス allpass くし形 comb 移動平均',
  },
  {
    id: 'colorcode',
    c: '電子回路',
    t: '抵抗カラーコード',
    d: '4〜6 本帯のカラーコードと抵抗値を相互に求めます。',
    ic: 'cc',
    k: '色帯 color code e系列 許容差 resistor',
  },
  {
    id: 'pcb-coil',
    c: '電子回路',
    t: 'PCBコイル',
    d: '基板の配線で作るうずまき状のコイルのインダクタンス・抵抗・Q を求めます。',
    ic: 'pc',
    k: 'pcb 共振 コンデンサ スパイラル うずまき アンテナ インダクタンス nfc rfid spiral coil antenna inductor',
  },
  {
    id: 'jpeg',
    c: '画像・光学',
    t: 'JPEG',
    d: 'JPEG に符号化する過程を順に解説し、圧縮の結果と画質を比べます。',
    ic: 'jp',
    k: 'jpeg jpg 画像 圧縮 image compression dct 離散コサイン変換 量子化 quantization ハフマン huffman ジグザグ zigzag ycbcr 色差 間引き chroma subsampling 4:2:0 ブロックノイズ psnr',
  },
  {
    id: 'organ',
    c: '音響',
    t: 'オルガン音響モデル',
    d: 'パイプオルガンの管の発音と共鳴を物理モデルで計算して鳴らします。',
    ic: 'og',
    k: 'organ pipe organ パイプオルガン acoustic physical model 物理モデル フルー管 flue リード管 reed ジェット jet エッジトーン 共鳴管 resonator ストップ stop レジストレーション registration プリンシパル ゲダクト トランペット 風箱 wind トレモラント tremulant 調律 temperament 教会 残響 reverb 演奏 バッハ bach オーディオ audio',
  },
  {
    id: 'engine',
    c: '音響',
    t: 'エンジン音響モデル',
    d: 'CT125 をもとにした単気筒エンジンの排気音とトルク・出力を再現します。',
    ic: 'en',
    k: 'engine エンジン honda ホンダ 空冷 単気筒 single cylinder 4 stroke 4 ストローク ハンターカブ hunter cub ct125 スーパーカブ super cub ja65 ja55 排気音 exhaust マフラー muffler silencer 触媒 吸気 intake トルク torque 出力 power 回転数 rpm 空ぶかし アイドリング idle 燃焼 combustion wiebe 筒内圧 p-v 体積効率 導波管 waveguide 物理モデル physical model オーディオ audio',
  },
  {
    id: 'lens',
    c: '画像・光学',
    t: 'カメラレンズ',
    d: '実在のレンズのデータどおりに光線を追跡し、ボケや収差を映像で再現します。',
    ic: 'ln',
    k: 'lens camera optics レンズ カメラ 光学 光線追跡 ray tracing 絞り aperture f値 焦点距離 focal length ピント focus 被写界深度 depth of field ボケ bokeh 玉ボケ 収差 aberration ザイデル seidel 球面収差 コマ 非点収差 像面湾曲 歪曲 distortion 色収差 chromatic 周辺減光 vignetting ダブルガウス double gauss テッサー tessar トリプレット triplet アクロマート achromat 望遠 広角 webgl',
  },
  {
    id: 'solar-eclipse',
    c: '画像・光学',
    t: '日食',
    d: '過去と未来の日食を、選んだ地点から見た空と、宇宙から見た月の影で再現します。',
    ic: 'se',
    k: 'solar eclipse 日食 皆既日食 金環日食 部分日食 total annular hybrid partial 食分 面積比 magnitude obscuration コロナ corona ダイヤモンドリング diamond ring ベイリー baily 月の影 本影 半影 umbra penumbra 皆既帯 中心線 central line サロス saros ベッセル要素 besselian elements nasa 五千年正典 five millennium canon espenak meeus deltat δt 地方食 local circumstances 天文 astronomy 太陽 月',
  },
];
/** 準備中を後ろへ */
export const order = (L: Tool[]): Tool[] => L.slice().sort((a, b) => (a.s || 0) - (b.s || 0));
/** ツールのページの URL */
export const href = (t: Tool): string => `${import.meta.env.BASE_URL}${t.id}/`;
/** 絞り込み用の検索文字列 */
export const keys = (t: Tool): string => `${t.t} ${t.d} ${t.c} ${t.k}`.normalize('NFKC').toLowerCase();
