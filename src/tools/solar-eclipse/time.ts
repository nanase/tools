/**
 * 暦と ΔT（DOM に依存しない）
 *
 * 暦は NASA の正典と同じく、1582-10-15 より前をユリウス暦、年を天文学的な数え方（0 年 = 紀元前 1 年）で表す。
 * ΔT は Espenak & Meeus (2006) の区間多項式に、月の永年加速の補正 c = −0.000012932 (y − 1955)² を加えたもの
 * （NASA の正典が使った値）。標準誤差 σ は NASA の「Uncertainty in Delta T」の表と式
 */

export interface Cal {
  year: number;
  month: number;
  day: number;
  /** 日の中の時刻 [h] */
  hour: number;
}

/** JD を暦に直す（Meeus『Astronomical Algorithms』7 章） */
export function jdToCal(jd: number): Cal {
  const z = Math.floor(jd + 0.5);
  const f = jd + 0.5 - z;
  let a = z;
  if (z >= 2299161) {
    const al = Math.floor((z - 1867216.25) / 36524.25);
    a = z + 1 + al - Math.floor(al / 4);
  }
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const d = Math.floor(365.25 * c);
  const e = Math.floor((b - d) / 30.6001);
  const day = b - d - Math.floor(30.6001 * e);
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;
  return { year, month, day, hour: f * 24 };
}

/** 暦（0 時）を JD に直す */
export function calToJd(year: number, month: number, day: number): number {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const gregorian = year > 1582 || (year === 1582 && (month > 10 || (month === 10 && day >= 15)));
  const a = Math.floor(y / 100);
  const b = gregorian ? 2 - a + Math.floor(a / 4) : 0;
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
}

const poly = (c: number[], t: number) => c.reduceRight((s, k) => s * t + k, 0);

/** Espenak & Meeus (2006) の ΔT [s]。y は年の小数（y = 年 + (月 − 0.5)/12） */
export function deltaTEM(y: number): number {
  const long = (u: number) => -20 + 32 * u * u;
  let dt: number;
  if (y < -500) dt = long((y - 1820) / 100);
  else if (y < 500) dt = poly([10583.6, -1014.41, 33.78311, -5.952053, -0.1798452, 0.022174192, 0.0090316521], y / 100);
  else if (y < 1600)
    dt = poly([1574.2, -556.01, 71.23472, 0.319781, -0.8503463, -0.005050998, 0.0083572073], (y - 1000) / 100);
  else if (y < 1700) dt = poly([120, -0.9808, -0.01532, 1 / 7129], y - 1600);
  else if (y < 1800) dt = poly([8.83, 0.1603, -0.0059285, 0.00013336, -1 / 1174000], y - 1700);
  else if (y < 1860)
    dt = poly(
      [13.72, -0.332447, 0.0068612, 0.0041116, -0.00037436, 0.0000121272, -0.0000001699, 0.000000000875],
      y - 1800,
    );
  else if (y < 1900) dt = poly([7.62, 0.5737, -0.251754, 0.01680668, -0.0004473624, 1 / 233174], y - 1860);
  else if (y < 1920) dt = poly([-2.79, 1.494119, -0.0598939, 0.0061966, -0.000197], y - 1900);
  else if (y < 1941) dt = poly([21.2, 0.84493, -0.0761, 0.0020936], y - 1920);
  else if (y < 1961) dt = poly([29.07, 0.407, -1 / 233, 1 / 2547], y - 1950);
  else if (y < 1986) dt = poly([45.45, 1.067, -1 / 260, -1 / 718], y - 1975);
  else if (y < 2005) dt = poly([63.86, 0.3345, -0.060374, 0.0017275, 0.000651814, 0.00002373599], y - 2000);
  else if (y < 2050) dt = poly([62.92, 0.32217, 0.005589], y - 2000);
  else if (y < 2150) dt = long((y - 1820) / 100) - 0.5628 * (2150 - y);
  else dt = long((y - 1820) / 100);
  if (y < 1955 || y > 2005) dt += -0.000012932 * (y - 1955) * (y - 1955);
  return dt;
}

/** Huber (2000) のブラウン運動とドリフトの模型による ΔT の標準誤差 [s] */
const huber = (n: number) => (365.25 * n * Math.sqrt(((n * 0.058) / 3) * (1 + n / 2500))) / 1000;

/** ΔT の標準誤差 σ [s]（NASA SEcat5/uncertainty.html の表 1〜3 をつないだもの） */
export function deltaTSigma(y: number): number {
  if (y < -1000) return huber(-500 - y);
  if (y <= 1200) {
    const t = (y - 1820) / 100;
    return 0.8 * t * t;
  }
  // 表の点を対数で補間する
  const pts: [number, number][] = [
    [1200, 31],
    [1300, 20],
    [1600, 20],
    [1700, 5],
    [1800, 1],
    [1900, 0.1],
  ];
  if (y < 1900) {
    for (let k = 1; k < pts.length; k++) {
      if (y <= pts[k][0]) {
        const [y0, s0] = pts[k - 1];
        const [y1, s1] = pts[k];
        return s0 * (s1 / s0) ** ((y - y0) / (y1 - y0));
      }
    }
  }
  return Math.max(0.1, y > 2005 ? huber(y - 2005) : 0.1);
}
