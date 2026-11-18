/**
 * 「しくみ」の枠の段。絵は viewBox 0 0 60 54 の SVG の中身で、線の class は style.css の .pl-steps .how にある:
 * gl ガラスの縁、gf ガラスの地、ry 光線、nl 法線、wk 弱い反射、mr 鏡、s0〜s5 虹の色（赤から紫）
 */
export interface Step {
  t: string;
  p: string[];
  svg: string;
}

const FAN = [0, 1, 2, 3, 4, 5].map((k) => `<path class="s${k}" d="M36 21L57 ${30 + k * 3.4}"/>`).join('');

export const STEPS: Step[] = [
  {
    t: '屈折',
    p: [
      '光はガラスや水の中では空気より遅く進みます。',
      '境目に斜めに入ると、遅くなる側へ折れ曲がります。曲がり方は屈折率で決まります。',
    ],
    svg: '<rect class="gf" x="2" y="27" width="56" height="25"/><path class="gl" d="M2 27H58"/><path class="nl" d="M30 4V50"/><path class="ry" d="M8 5L30 27L39 50"/>',
  },
  {
    t: '色ごとに違う曲がり方',
    p: [
      '屈折率は光の色（波長）で少しずつ違い、紫ほど大きく、赤ほど小さくなります。',
      'プリズムに白い光を通すと、色ごとに曲がる角が違うので虹のように分かれます。',
    ],
    svg: `<path class="gf gl" d="M30 6L45 34H15Z"/><path class="ry" d="M2 34L23 21H36"/>${FAN}`,
  },
  {
    t: '面での反射',
    p: [
      '光が境目に当たると、多くは通り抜け、一部が鏡のように跳ね返ります。',
      '浅い角度で当たるほど、跳ね返る割合が増えます。',
    ],
    svg: '<rect class="gf" x="2" y="27" width="56" height="25"/><path class="gl" d="M2 27H58"/><path class="nl" d="M30 4V50"/><path class="ry" d="M6 7L30 27L38 50"/><path class="wk" d="M30 27L54 7"/>',
  },
  {
    t: '全反射',
    p: [
      'ガラスから空気へ出る光は、境目に浅く当たると外へ出られず、すべて跳ね返ります。',
      '光ファイバーはこの性質で光を閉じ込めて運びます。',
    ],
    svg: '<rect class="gf" x="2" y="18" width="56" height="18"/><path class="gl" d="M2 18H58M2 36H58"/><path class="ry" d="M2 30L14 36L30 18L46 36L58 22"/>',
  },
  {
    t: 'レンズと鏡',
    p: [
      '凸レンズは中心ほど厚く、外側を通る光ほど大きく曲げて 1 点に集めます。',
      '凹面鏡も曲がった面で反射させて集めます。鏡は色によらず同じ角で反射するので、色のずれが出ません。',
    ],
    svg: '<path class="gf gl" d="M22 6C28 16 28 38 22 48C16 38 16 16 22 6Z"/><path class="ry" d="M2 12H22L52 27M2 27H52M2 42H22L52 27"/>',
  },
  {
    t: '光線を重ねて描く',
    p: [
      '光源から光線を少しずつ違う位置・色で何十万本も出し、通った道すじを足し合わせます。',
      '多くの光線が通った所ほど明るく写り、止めて待つほど滑らかになります。',
    ],
    svg: '<path class="ry t" d="M4 10L56 18M4 16L56 20M4 22L56 24M4 28L56 27M4 34L56 30M4 40L56 33M4 46L56 37"/><circle class="ry" cx="52" cy="27" r="3"/>',
  },
];
