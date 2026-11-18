/**
 * 回路図の SVG と電流の通り道。.astro（ビルド時の最初の図）とブラウザの両方で使う。
 * 配線は data-n（電圧の名前）で色を、部品の地は両端の電圧のグラデーションで塗る（lib は flow.ts）。
 * 電流の通り道（枝）は VCC から GND までの折れ線で、同じ線を通る枝の電流は flow.ts で足し合わせる
 */
import type { CirId, Vals } from './circuits';

export type Pt = [number, number];
/** 電流の枝: k は circuits.ts の state().I の名前。p は折れ線の並び（555 の中は描かないので途切れる） */
export interface Branch {
  k: string;
  p: Pt[][];
}
/** 図の上でつまみを動かせる可変抵抗 */
export interface PotHit {
  k: 'pos' | 'cv' | 'vin';
  /** 動かす向きと、値 0〜1 に当たる座標の範囲 */
  axis: 'x' | 'y';
  a: number;
  b: number;
}
export interface Drawing {
  svg: string;
  branches: Branch[];
  pot?: PotHit;
}

/* ---------- 部品 ---------- */
const wire = (n: string, d: string) => `<path class="t5-w" data-n="${n}" d="${d}"/>`;
const grad = (id: string, x1: number, y1: number, x2: number, y2: number, a: string, b: string) =>
  `<linearGradient id="t5g-${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" data-n="${a}"/><stop offset="1" data-n="${b}"/></linearGradient>`;
/** 縦の抵抗器（上 a・下 b） */
const res = (id: string, x: number, y1: number, y2: number, a: string, b: string) =>
  `${grad(id, x, y1, x, y2, a, b)}<rect class="t5-b" x="${x - 6}" y="${y1}" width="12" height="${y2 - y1}" fill="url(#t5g-${id})"/>`;
/** 横の抵抗器（左 a・右 b） */
const resH = (id: string, x1: number, x2: number, y: number, a: string, b: string) =>
  `${grad(id, x1, y, x2, y, a, b)}<rect class="t5-b" x="${x1}" y="${y - 6}" width="${x2 - x1}" height="12" fill="url(#t5g-${id})"/>`;
/** コンデンサ（上の極板 y・下の極板 y + 8）。極板は各電圧の色、間は電位差のグラデーション */
const cap = (id: string, x: number, y: number, a: string, b: string) =>
  `${grad(id, x, y, x, y + 8, a, b)}<rect x="${x - 12}" y="${y}" width="24" height="8" fill="url(#t5g-${id})" opacity=".55"/><path class="t5-w t5-pl" data-n="${a}" d="M${x - 13} ${y}H${x + 13}"/><path class="t5-w t5-pl" data-n="${b}" d="M${x - 13} ${y + 8}H${x + 13}"/>`;
/** LED（下向き。中心 y、上 a・下 b） */
const led = (id: string, x: number, y: number, a: string, b: string) =>
  `${grad(id, x, y - 11, x, y + 11, a, b)}<circle class="t5-led" id="${id}" cx="${x}" cy="${y}" r="11" stroke="url(#t5g-${id})"/><path class="t5-ln" d="M${x - 5} ${y - 4}H${x + 5}L${x} ${y + 4}ZM${x - 5} ${y + 4}H${x + 5}"/>`;
/** ダイオード（down: 上が陽極、up: 下が陽極）。y は上端、長さ 12 */
const diode = (x: number, y: number, dir: 'down' | 'up') =>
  dir === 'down'
    ? `<path class="t5-d" d="M${x - 7} ${y}H${x + 7}L${x} ${y + 12}Z"/><path class="t5-ln" d="M${x - 7} ${y + 12}H${x + 7}"/>`
    : `<path class="t5-d" d="M${x - 7} ${y + 12}H${x + 7}L${x} ${y}Z"/><path class="t5-ln" d="M${x - 7} ${y}H${x + 7}"/>`;
const gnd = (x: number, y: number) =>
  `<path class="t5-ln" d="M${x} ${y}V${y + 8}M${x - 9} ${y + 8}H${x + 9}M${x - 6} ${y + 12}H${x + 6}M${x - 3} ${y + 16}H${x + 3}"/>`;
const vccSym = (x: number, y: number) =>
  `${wire('rail', `M${x - 7} ${y}H${x + 7}M${x} ${y}V${y + 10}`)}<text class="s-t" x="${x}" y="${y - 4}" text-anchor="middle">VCC</text>`;
const jn = (...p: Pt[]) => p.map(([x, y]) => `<circle class="t5-j" cx="${x}" cy="${y}" r="2.6"/>`).join('');
/** 押しボタン（縦）。押すと棒が接点に触れる。図をクリック・タップしている間押す */
const btn = (k: 'trig' | 'rst', x: number, y1: number, y2: number, label: string) => {
  const m = (y1 + y2) / 2;
  return `<path class="t5-ln" d="M${x} ${y1}V${y1 + 6}M${x} ${y2 - 6}V${y2}"/><circle class="t5-c" cx="${x}" cy="${y1 + 6}" r="2"/><circle class="t5-c" cx="${x}" cy="${y2 - 6}" r="2"/>
<g class="t5-bar" data-bar="${k}"><path class="t5-ln t5-bw" d="M${x - 3} ${y1 + 4}V${y2 - 4}M${x - 3} ${m}H${x - 12}M${x - 12} ${m - 5}V${m + 5}"/></g>
<text class="t5-act" x="${x + 9}" y="${m + 4}">${label}</text>
<rect class="t5-hit" data-btn="${k}" x="${x - 18}" y="${y1 - 4}" width="${label.length > 2 ? 54 : 48}" height="${y2 - y1 + 8}" rx="4" tabindex="0" role="button" aria-label="${label}"/>`;
};
const lbl = (x: number, y: number, sym: string, id: string, anchor = 'end') =>
  `<text class="s-l" x="${x}" y="${y}" text-anchor="${anchor}">${sym}</text><text class="s-v" id="${id}" x="${x}" y="${y + 17}" text-anchor="${anchor}"></text>`;
const sub = (s: string) => `<tspan font-size="9" dy="3">${s}</tspan>`;

/* ---------- 電流の通り道の部品 ---------- */
const PIN1: Pt[] = [
  [210, 232],
  [210, 272],
  [210, 280],
];
const PIN8: Pt[] = [
  [21.5, 24],
  [210, 24],
  [210, 90],
];
const OUT: Pt[] = [
  [280, 156],
  [344, 156],
  [344, 272],
  [210, 272],
  [210, 280],
];
/** GND の線から C1 の下の極板へ戻る（放電の電流が DIS → 1 番ピン → C1 と回る） */
const back = (x: number, y: number): Pt[] => [
  [210, 232],
  [210, 272],
  [x, 272],
  [x, y],
];
const down = (x: number, y: number): Pt[] => [
  [x, y],
  [x, 272],
  [210, 272],
  [210, 280],
];

/* ---------- 共通: 電源・555・CV・出力の LED ---------- */
function common(o: { cv?: boolean; out?: boolean }): string {
  let s = `${wire('src', 'M21.5 24H30')}<circle class="t5-c" cx="18" cy="24" r="3.5"/>
<text class="s-t" x="18" y="12" text-anchor="middle">VCC</text><text class="s-v" id="s-vcc" x="18" y="46" text-anchor="middle"></text>
<circle class="t5-j" cx="30" cy="24" r="2"/><circle class="t5-j" cx="54" cy="24" r="2"/><path class="t5-ln t5-bw" id="t5-sw" d="M30 24L54 24"/>
<text class="t5-act" x="42" y="12" text-anchor="middle">電源</text>
<rect class="t5-hit" data-btn="pw" x="24" y="2" width="38" height="32" rx="4" tabindex="0" role="button" aria-label="電源"/>
${wire('gnd', 'M210 232V272M100 272H344')}${gnd(210, 272)}
<rect class="t5-ic" x="180" y="90" width="100" height="142" rx="3"/><text class="s-ic-t" x="230" y="166" text-anchor="middle">555</text>
<text class="s-t" x="186" y="120">DIS</text><text class="s-t" x="186" y="160">THR</text><text class="s-t" x="186" y="200">TRIG</text><text class="s-t" x="274" y="160" text-anchor="end">OUT</text>
<text class="s-t" x="210" y="106" text-anchor="middle">VCC</text><text class="s-t" x="254" y="106" text-anchor="middle">RST</text><text class="s-t" x="210" y="226" text-anchor="middle">GND</text><text class="s-t" x="254" y="226" text-anchor="middle">CV</text>
<text class="s-n" x="176" y="111" text-anchor="end">7</text><text class="s-n" x="176" y="151" text-anchor="end">6</text><text class="s-n" x="176" y="191" text-anchor="end">2</text><text class="s-n" x="285" y="151">3</text>
<text class="s-n" x="214" y="84">8</text><text class="s-n" x="258" y="84">4</text><text class="s-n" x="214" y="246">1</text><text class="s-n" x="258" y="246">5</text>`;
  if (o.cv !== false)
    s += `${wire('cv', 'M254 232V248')}${cap('ccv', 254, 248, 'cv', 'gnd')}${wire('gnd', 'M254 256V272')}<text class="s-n" x="270" y="256">10 nF</text>`;
  if (o.out !== false)
    s += `${wire('out', 'M280 156H344V166')}${res('rl', 344, 166, 196, 'out', 'la')}${wire('la', 'M344 196V206')}${led('led', 344, 217, 'la', 'gnd')}${wire('gnd', 'M344 228V272')}
<text class="s-n" x="354" y="185">1 kΩ</text><text class="s-t" x="359" y="221">LED</text>`;
  return s;
}
const outBranch: Branch = { k: 'out', p: [PIN8, OUT] };

/* ---------- 標準の左側（R1・R2・C1） ---------- */
function stdLeft(diodeOn: boolean): string {
  return `${wire('dis', `M100 80V126M100 116H180${diodeOn ? 'M130 116V128' : ''}`)}
${wire('c', `M100 166V206M100 176H158M158 156V196M158 156H180M158 196H180${diodeOn ? 'M130 140V176' : ''}`)}
${wire('gnd', 'M100 214V272')}
${res('r1', 100, 40, 80, 'rail', 'dis')}${res('r2', 100, 126, 166, 'dis', 'c')}${cap('c1', 100, 206, 'c', 'gnd')}
${diodeOn ? `${diode(130, 128, 'down')}<text class="s-l" x="139" y="140">D</text>${jn([130, 116], [130, 176])}` : ''}
${jn([100, 116], [100, 176], [158, 176])}
${lbl(86, 56, `R${sub('1')}`, 's-r1')}${lbl(86, 142, `R${sub('2')}`, 's-r2')}${lbl(84, 210, `C${sub('1')}`, 's-c1')}`;
}
const stdBranches = (diodeOn: boolean): Branch[] => [
  {
    k: 'ch',
    p: [
      diodeOn
        ? [
            [21.5, 24],
            [100, 24],
            [100, 116],
            [130, 116],
            [130, 176],
            [100, 176],
            [100, 206],
          ]
        : [
            [21.5, 24],
            [100, 24],
            [100, 206],
          ],
      down(100, 214),
    ],
  },
  {
    k: 'dr1',
    p: [
      [
        [21.5, 24],
        [100, 24],
        [100, 116],
        [180, 116],
      ],
      PIN1,
    ],
  },
  {
    k: 'dc',
    p: [
      [
        [100, 206],
        [100, 116],
        [180, 116],
      ],
      back(100, 214),
    ],
  },
  {
    k: 'off',
    p: [
      [
        [100, 206],
        [100, 24],
        [210, 24],
        [210, 90],
      ],
      back(100, 214),
    ],
  },
];

const RAIL_STD = 'M54 24H254V90M210 24V90M100 24V40';

function astable(diodeOn: boolean): Drawing {
  return {
    svg: wire('rail', RAIL_STD) + stdLeft(diodeOn) + common({}),
    branches: [...stdBranches(diodeOn), outBranch],
  };
}

function alt(): Drawing {
  return {
    svg:
      wire('rail', 'M54 24H344V34M254 24V90M210 24V90M100 24V40') +
      stdLeft(false) +
      common({ out: false }) +
      `${res('rl1', 344, 34, 64, 'rail', 'a1')}${wire('a1', 'M344 64V89')}${led('led1', 344, 100, 'a1', 'out')}
${wire('out', 'M344 111V189M280 156H344')}${led('led2', 344, 200, 'out', 'b2')}${wire('b2', 'M344 211V222')}${res('rl2', 344, 222, 252, 'b2', 'gnd')}${wire('gnd', 'M344 252V272')}${jn([344, 156])}
<text class="s-n" x="354" y="53">1 kΩ</text><text class="s-t" x="359" y="104">LED1</text><text class="s-t" x="359" y="204">LED2</text><text class="s-n" x="354" y="241">1 kΩ</text>`,
    branches: [
      ...stdBranches(false),
      {
        k: 'l1',
        p: [
          [
            [21.5, 24],
            [344, 24],
            [344, 156],
            [280, 156],
          ],
          PIN1,
        ],
      },
      { k: 'l2', p: [PIN8, OUT] },
    ],
  };
}

/** デューティ比可変: VR のつまみ（左端 80・右端 140）が DIS につながり、左は D1 で充電、右は D2 で放電 */
function pwm(v: Vals): Drawing {
  const xw = Math.round((80 + (60 * v.pos) / 100) * 10) / 10,
    xl = Math.min(xw, 100);
  const svg = `${wire('rail', RAIL_STD)}
${wire('dis', `M100 80V116M${xl} 116H180M${xw} 116V140`)}<path class="t5-ln" d="M${xw - 4} 137L${xw} 143L${xw + 4} 137"/>
${res('r1', 100, 40, 80, 'rail', 'dis')}${resH('vr', 80, 140, 150, 'pl', 'pr')}
${wire('pl', 'M80 150H60V164')}${diode(60, 164, 'down')}${wire('pr', 'M140 150H148V164')}${diode(148, 164, 'up')}
${wire('c', 'M60 176V206H170M148 176V206M170 156V206M170 156H180M170 196H180M100 206V214')}${cap('c1', 100, 214, 'c', 'gnd')}${wire('gnd', 'M100 222V272')}
${jn([xw, 116], [100, 206], [148, 206], [170, 196])}
<text class="s-n" x="50" y="174" text-anchor="end">D1</text><text class="s-n" x="152" y="196">D2</text>
<text class="s-l" x="110" y="176" text-anchor="middle">VR</text><text class="s-v" id="s-r2" x="110" y="191" text-anchor="middle"></text>
${lbl(86, 56, `R${sub('1')}`, 's-r1')}${lbl(84, 218, `C${sub('1')}`, 's-c1')}
<rect class="t5-hit t5-pot" x="74" y="132" width="72" height="26" rx="4"/>
${common({})}`;
  const dcPath: Pt[] = [
    [100, 214],
    [100, 206],
    [148, 206],
    [148, 150],
    [140, 150],
    [xw, 150],
    [xw, 116],
  ];
  return {
    svg,
    branches: [
      {
        k: 'ch',
        p: [
          [
            [21.5, 24],
            [100, 24],
            [100, 116],
            [xw, 116],
            [xw, 150],
            [80, 150],
            [60, 150],
            [60, 206],
            [100, 206],
            [100, 214],
          ],
          down(100, 222),
        ],
      },
      {
        k: 'dr1',
        p: [
          [
            [21.5, 24],
            [100, 24],
            [100, 116],
            [180, 116],
          ],
          PIN1,
        ],
      },
      { k: 'dc', p: [[...dcPath, [180, 116]], back(100, 222)] },
      {
        k: 'off',
        p: [[...dcPath, [100, 116], [100, 24], [210, 24], [210, 90]], back(100, 222)],
      },
      outBranch,
    ],
    pot: { k: 'pos', axis: 'x', a: 80, b: 140 },
  };
}

/** 電圧で周波数を変える: CV に可変抵抗のつまみ（上端 242・下端 266） */
function vco(v: Vals): Drawing {
  const f = Math.max(0, Math.min(1, v.cv / v.vcc)),
    yw = Math.round((266 - 24 * f) * 10) / 10;
  const svg = `${wire('rail', RAIL_STD)}${stdLeft(false)}
${vccSym(306, 234)}${res('vr', 306, 244, 268, 'rail', 'gnd')}${wire('gnd', 'M306 268V272')}
${wire('cv', `M254 232V${yw}H296`)}<path class="t5-ln" d="M294 ${yw - 4}L300 ${yw}L294 ${yw + 4}"/>
<text class="s-v" id="s-cv" x="258" y="${yw < 252 ? yw + 14 : yw - 5}"></text>${jn([306, 272])}
<rect class="t5-hit t5-pot" x="292" y="238" width="28" height="34" rx="4"/>
${common({ cv: false })}`;
  return {
    svg,
    branches: [
      ...stdBranches(false),
      outBranch,
      {
        k: 'vr',
        p: [
          [
            [306, 234],
            [306, 272],
            [210, 272],
            [210, 280],
          ],
        ],
      },
    ],
    pot: { k: 'cv', axis: 'y', a: 266, b: 242 },
  };
}

/** 暗くなると点滅: RST を R3 で引き上げ、CdS で GND へ引く */
function dark(): Drawing {
  const ldr = `${res('ldr', 300, 86, 122, 'rst', 'gnd')}<circle class="t5-ln" cx="300" cy="104" r="19" fill="none"/>
<path class="t5-ln" d="M340 74L324 88M346 88L328 100"/><path class="t5-ah" d="M322 90l2-7 4 3zM326 102l2-7 4 3z"/>`;
  const svg = `${wire('rail', 'M54 24H254V30M210 24V90M100 24V40')}${stdLeft(false)}
${res('r3', 254, 30, 60, 'rail', 'rst')}${wire('rst', 'M254 60V90M254 74H300V86')}${ldr}${wire('gnd', 'M300 122V130')}${gnd(300, 130)}${jn([254, 74])}
<text class="s-n" x="262" y="50">47 kΩ</text><text class="s-t" x="324" y="126">CdS</text><text class="s-v" id="s-lux" x="324" y="142"></text>
${common({})}`;
  return {
    svg,
    branches: [
      ...stdBranches(false),
      outBranch,
      {
        k: 'dv',
        p: [
          [
            [21.5, 24],
            [254, 24],
            [254, 74],
            [300, 74],
            [300, 138],
          ],
        ],
      },
    ],
  };
}

function mono(): Drawing {
  const svg = `${wire('rail', RAIL_STD)}
${wire('c', 'M100 80V206M100 116H180M158 116V156H180')}${wire('gnd', 'M100 214V272M140 236V272')}
${res('r1', 100, 40, 80, 'rail', 'c')}${cap('c1', 100, 206, 'c', 'gnd')}
${vccSym(140, 134)}${res('rpu', 140, 144, 180, 'rail', 'trig')}${wire('trig', 'M140 180V206M140 196H180')}
${btn('trig', 140, 206, 236, '押す')}
${jn([100, 116], [158, 116], [140, 196])}
${lbl(86, 56, `R${sub('1')}`, 's-r1')}${lbl(84, 210, `C${sub('1')}`, 's-c1')}<text class="s-n" x="149" y="172">10 kΩ</text>
${common({})}`;
  return {
    svg,
    branches: [
      {
        k: 'ch',
        p: [
          [
            [21.5, 24],
            [100, 24],
            [100, 206],
          ],
          down(100, 214),
        ],
      },
      {
        k: 'dr1',
        p: [
          [
            [21.5, 24],
            [100, 24],
            [100, 116],
            [180, 116],
          ],
          PIN1,
        ],
      },
      {
        k: 'off',
        p: [
          [
            [100, 206],
            [100, 24],
            [210, 24],
            [210, 90],
          ],
          back(100, 214),
        ],
      },
      { k: 'pu', p: [down(140, 134)] },
      outBranch,
    ],
  };
}

function bistable(): Drawing {
  const svg = `${wire('rail', 'M54 24H300V34M210 24V90M100 24V40')}
${res('rpu1', 100, 40, 80, 'rail', 'trig')}${wire('trig', 'M100 80V206M100 196H180')}${btn('trig', 100, 206, 236, 'ON')}${wire('gnd', 'M100 236V272')}
${res('rpu2', 300, 34, 64, 'rail', 'rst')}${wire('rst', 'M300 64V74H254V90M300 74H336V84')}${btn('rst', 336, 84, 114, 'OFF')}${wire('gnd', 'M336 114V120M180 156H164V164')}${gnd(336, 120)}${gnd(164, 164)}
${jn([100, 196], [300, 74])}
<text class="s-n" x="88" y="64" text-anchor="end">10 kΩ</text><text class="s-n" x="292" y="54" text-anchor="end">10 kΩ</text>
${common({})}`;
  return {
    svg,
    branches: [
      { k: 'pu1', p: [[[21.5, 24], ...down(100, 24)]] },
      {
        k: 'pu2',
        p: [
          [
            [21.5, 24],
            [300, 24],
            [300, 74],
            [336, 74],
            [336, 128],
          ],
        ],
      },
      outBranch,
    ],
  };
}

/** シュミットトリガ: VR（上端 50・下端 230）のつまみを THR・TRIG へ */
function schmitt(v: Vals): Drawing {
  const f = Math.max(0, Math.min(1, v.vin / v.vcc)),
    yw = Math.round((226 - 172 * f) * 10) / 10;
  const svg = `${wire('rail', 'M54 24H254V90M210 24V90M100 24V50')}${res('vr', 100, 50, 230, 'rail', 'gnd')}${wire('gnd', 'M100 230V272')}
${wire('in', `M108 ${yw}H140V176H158M158 156V196M158 156H180M158 196H180`)}<path class="t5-ln" d="M112 ${yw - 4}L106 ${yw}L112 ${yw + 4}"/>${jn([158, 176])}
<text class="s-l" x="86" y="120" text-anchor="end">VR</text><text class="s-v" x="86" y="137" text-anchor="end">10 kΩ</text>
<text class="s-v" id="s-vin" x="114" y="${yw > 60 ? yw - 5 : yw + 15}"></text>
<rect class="t5-hit t5-pot" x="86" y="46" width="30" height="188" rx="4"/>
${common({})}`;
  return {
    svg,
    branches: [{ k: 'vr', p: [[[21.5, 24], ...down(100, 24)]] }, outBranch],
    pot: { k: 'vin', axis: 'y', a: 226, b: 54 },
  };
}

/** 回路の図と電流の枝 */
export function drawCircuit(id: CirId, v: Vals): Drawing {
  switch (id) {
    case 'astable':
      return astable(false);
    case 'diode':
      return astable(true);
    case 'pwm':
      return pwm(v);
    case 'alt':
      return alt();
    case 'vco':
      return vco(v);
    case 'dark':
      return dark();
    case 'mono':
      return mono();
    case 'bistable':
      return bistable();
    case 'schmitt':
      return schmitt(v);
  }
}

/** 図の値を変えると形が変わる入力（つまみの位置） */
export const SHAPE_KEYS: Partial<Record<CirId, (keyof Vals)[]>> = {
  pwm: ['pos'],
  vco: ['cv', 'vcc'],
  schmitt: ['vin', 'vcc'],
};

/* ---------- 線分の分割と電流の和 ---------- */
/** 枝の折れ線を、ほかの頂点のある所で切った線分。dir は枝の向きが線分の向き（a → b）と同じなら 1 */
export interface Seg {
  a: Pt;
  b: Pt;
  len: number;
  /** [枝の番号, 向き] */
  of: [number, 1 | -1][];
}

const onSeg = (p: Pt, a: Pt, b: Pt) => {
  const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  if (Math.abs(cr) > 1e-6) return false;
  const t =
    Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]) ? (p[0] - a[0]) / (b[0] - a[0]) : (p[1] - a[1]) / (b[1] - a[1]);
  return t > 1e-9 && t < 1 - 1e-9;
};
const key = (p: Pt) => `${p[0]},${p[1]}`;

/** 枝の線をほかの枝の頂点で切りそろえ、同じ線分を通る枝をまとめる */
export function segments(branches: Branch[]): Seg[] {
  const pts: Pt[] = [];
  const seen = new Set<string>();
  for (const b of branches)
    for (const line of b.p)
      for (const p of line)
        if (!seen.has(key(p))) {
          seen.add(key(p));
          pts.push(p);
        }
  const map = new Map<string, Seg>();
  branches.forEach((br, bi) => {
    for (const line of br.p)
      for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i] as Pt,
          b = line[i + 1] as Pt;
        const cut = pts
          .filter((p) => onSeg(p, a, b))
          .sort((p, q) => Math.hypot(p[0] - a[0], p[1] - a[1]) - Math.hypot(q[0] - a[0], q[1] - a[1]));
        const chain = [a, ...cut, b];
        for (let j = 0; j + 1 < chain.length; j++) {
          const p = chain[j] as Pt,
            q = chain[j + 1] as Pt;
          const fwd = key(p) < key(q),
            k = fwd ? `${key(p)}|${key(q)}` : `${key(q)}|${key(p)}`;
          let s = map.get(k);
          if (!s) {
            const [s0, s1] = fwd ? [p, q] : [q, p];
            s = { a: s0, b: s1, len: Math.hypot(s1[0] - s0[0], s1[1] - s0[1]), of: [] };
            map.set(k, s);
          }
          s.of.push([bi, fwd ? 1 : -1]);
        }
      }
  });
  return [...map.values()].filter((s) => s.len > 0.01);
}
