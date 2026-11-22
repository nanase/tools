/** しくみの工程（図は viewBox 0 0 200 100 の SVG の中身） */
export const STEPS: readonly { h: string; svg: string; p: string }[] = [
  {
    h: '視直径',
    svg: '<circle cx="24" cy="50" r="4" class="ea"/><path class="a" d="M28 48 L160 22 M28 52 L160 78"/><circle cx="160" cy="50" r="28" class="ve"/><text x="94" y="54" text-anchor="middle">角度</text>',
    p: '大きさ ÷ 距離で決まる',
  },
  {
    h: '近いと大きい',
    svg: '<circle cx="40" cy="46" r="6" class="ve"/><circle cx="130" cy="46" r="32" class="ve"/><text x="40" y="76" text-anchor="middle">遠い</text><text x="130" y="96" text-anchor="middle">近い</text>',
    p: '金星は 6 倍ほど変わる',
  },
  {
    h: '太陽の向きだけ光る',
    svg: '<circle cx="186" cy="50" r="8" class="sun"/><circle cx="110" cy="50" r="20" class="dk"/><path class="ve" d="M110 30 A20 20 0 0 1 110 70 A9 20 0 0 0 110 30Z"/><circle cx="26" cy="50" r="5" class="ea"/><path class="a" d="M178 50 H138"/><path class="ah" d="M132 50 l8 -4 v8z"/>',
    p: '近いときほど細く欠ける',
  },
  {
    h: '太陽の近くは見えない',
    svg: '<circle cx="70" cy="50" r="30" class="lt"/><circle cx="70" cy="50" r="10" class="sun"/><circle cx="90" cy="40" r="5" class="ve"/><circle cx="168" cy="50" r="6" class="ma"/><text x="90" y="94" text-anchor="middle">見えない</text><text x="168" y="80" text-anchor="middle">見える</text>',
    p: '太陽から離れると夜空に出る',
  },
];
