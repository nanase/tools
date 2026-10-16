/**
 * 写真と比べる: 自由なライセンス（パブリックドメイン・CC0・CC BY）の写真と、撮影したときの光源の高度・画角・向き、
 * 写っているハロを再現する結晶の組み合わせ（写真から見積もった例）。画像は public/photos/halo/ に縮めて EXIF を除いて置く。
 * 光源の高度は撮影の日時と場所から求めた（NOAA の式）。向きは写真の光源の位置に合わせた
 */
import type { Population } from './trace';

export interface Photo {
  id: string;
  /** ボタンの名前 */
  name: string;
  title: string;
  author: string;
  license: string;
  licenseUrl: string;
  page: string;
  w: number;
  h: number;
  /** 撮影の日時（現地時刻） */
  date: string;
  place: string;
  moon: boolean;
  /** 光源の真の高度 [°] */
  elev: number;
  /** 0 魚眼、2 透視 */
  proj: 0 | 2;
  /** 横の画角 [°] */
  fov: number;
  /** 写真の中心の向き（光源の方位が 0、右が正）と見かけの高度 [°] */
  az: number;
  alt: number;
  /** 露出の補正 [EV] */
  ev: number;
  /** 雲の厚さと高さ [km]（写真の見た目から決めた） */
  tau: number;
  hc: number;
  lens: string;
  halos: string[];
  pops: Population[];
}

export const PHOTOS: Photo[] = [
  {
    id: 'yellowstone-2016-12-18',
    name: '環天頂アークと上端接弧',
    title: '22 degree halo, supralaterel arc, circumzenithal arc, upper tangent arc, parhelion (31075518184)',
    author: 'NPS / Diane Renkin (Yellowstone National Park)',
    license: 'パブリックドメイン',
    licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
    page: 'https://commons.wikimedia.org/wiki/File:22_degree_halo,_supralaterel_arc,_circumzenithal_arc,_upper_tangent_arc,_parhelion_(31075518184).jpg',
    w: 900,
    h: 1200,
    date: '2016-12-18 10:04',
    place: '米国ワイオミング州、イエローストーン国立公園 Mammoth Hot Springs の段丘上の道路',
    moon: false,
    elev: 15,
    proj: 2,
    fov: 53.1,
    az: 13.5,
    alt: 35.69,
    ev: 0,
    tau: 0.15,
    hc: 8,
    lens: 'Samsung Galaxy S7 (SM-G930V)、35 mm 換算 26 mm',
    halos: ['内暈', '幻日', '上端接弧', '上部ラテラルアーク', '環天頂アーク'],
    pops: [
      { orient: 'random', ca: 1, tilt: 0, rot: 0, w: 40, d: 60, pyr: 0 },
      { orient: 'plate', ca: 0.3, tilt: 1.5, rot: 0, w: 25, d: 150, pyr: 0 },
      { orient: 'column', ca: 2, tilt: 1.5, rot: 0, w: 35, d: 100, pyr: 0 },
    ],
  },
  {
    id: 'alps-2025-01-03',
    name: 'パリーアークと外暈',
    title: 'Complex halo combination 03',
    author: 'Trulyamayed',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    page: 'https://commons.wikimedia.org/wiki/File:Complex_halo_combination_03.jpg',
    w: 900,
    h: 1200,
    date: '2025-01-03 10:07',
    place: "スイス西部のアルプス（ヴァレー州、Val d'Illiez 付近）",
    moon: false,
    elev: 13.1,
    proj: 2,
    fov: 53.1,
    az: 1.21,
    alt: 47.45,
    ev: 0,
    tau: 0.2,
    hc: 8,
    lens: 'Apple iPhone 12 Pro、35 mm 換算 26 mm',
    halos: ['内暈', '上端接弧', 'パリーアーク', '外暈', '環天頂アーク'],
    pops: [
      { orient: 'random', ca: 1, tilt: 0, rot: 0, w: 30, d: 60, pyr: 0 },
      { orient: 'column', ca: 2, tilt: 1, rot: 0, w: 25, d: 100, pyr: 0 },
      { orient: 'parry', ca: 2, tilt: 1, rot: 1, w: 20, d: 100, pyr: 0 },
      { orient: 'plate', ca: 0.3, tilt: 1, rot: 0, w: 25, d: 150, pyr: 0 },
    ],
  },
  {
    id: 'nikko-2025-07-19',
    name: '環水平アーク',
    title: '環水平アーク（栃木県日光市大桑）20250719-P1070892',
    author: 'くろふね',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    page: 'https://commons.wikimedia.org/wiki/File:%E7%92%B0%E6%B0%B4%E5%B9%B3%E3%82%A2%E3%83%BC%E3%82%AF%EF%BC%88%E6%A0%83%E6%9C%A8%E7%9C%8C%E6%97%A5%E5%85%89%E5%B8%82%E5%A4%A7%E6%A1%91%EF%BC%8920250719-P1070892.jpg',
    w: 1200,
    h: 900,
    date: '2025-07-19 12:50',
    place: '栃木県日光市大桑',
    moon: false,
    elev: 68.9,
    proj: 2,
    fov: 53.9,
    az: 0,
    alt: 10.1,
    ev: 0,
    tau: 0.1,
    hc: 9,
    lens: 'Panasonic LUMIX DC-GX7MK3、35 mm 換算 34 mm',
    halos: ['環水平アーク'],
    pops: [
      { orient: 'plate', ca: 0.3, tilt: 0.7, rot: 0, w: 80, d: 150, pyr: 0 },
      { orient: 'random', ca: 1, tilt: 0, rot: 0, w: 20, d: 60, pyr: 0 },
    ],
  },
  {
    id: 'south-pole-2012-01-13',
    name: '南極点の大きな表示',
    title: 'Arcs, Dogs, and Halos (24104820222)',
    author: 'LCDR Heather Moe, NOAA Corps (NOAA Photo Library, image ID anta0202)',
    license: 'パブリックドメイン',
    licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
    page: 'https://commons.wikimedia.org/wiki/File:Arcs,_Dogs,_and_Halos_(24104820222).jpg',
    w: 1200,
    h: 797,
    date: '2012-01-13 23:07',
    place: '南極点、アムンゼン・スコット基地',
    moon: false,
    elev: 21.5,
    proj: 0,
    fov: 136.7,
    az: 7.16,
    alt: 34.23,
    ev: 0,
    tau: 0.3,
    hc: 3,
    lens: 'Nikon D90、35 mm 換算 15 mm（対角魚眼）',
    halos: ['内暈', '幻日', '幻日環', '上端接弧', 'パリーアーク', '上部ラテラルアーク', '環天頂アーク'],
    pops: [
      { orient: 'random', ca: 1, tilt: 0, rot: 0, w: 25, d: 60, pyr: 0 },
      { orient: 'plate', ca: 0.3, tilt: 1, rot: 0, w: 25, d: 150, pyr: 0 },
      { orient: 'column', ca: 2, tilt: 1, rot: 0, w: 35, d: 100, pyr: 0 },
      { orient: 'parry', ca: 2, tilt: 1, rot: 1, w: 15, d: 100, pyr: 0 },
    ],
  },
  {
    id: 'waren-2025-05-10',
    name: '日の入り後の太陽柱',
    title: '20250510 4070 TG 212613 16zu10',
    author: 'J.KYSELAK',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    page: 'https://commons.wikimedia.org/wiki/File:20250510_4070_TG_212613_16zu10.jpg',
    w: 1200,
    h: 750,
    date: '2025-05-10 21:26',
    place: 'ドイツ、メクレンブルク＝フォアポンメルン州 Waren (Müritz)',
    moon: false,
    elev: -4.6,
    proj: 2,
    fov: 22.2,
    az: 1.3,
    alt: 6.66,
    ev: 0,
    tau: 0.5,
    hc: 12,
    lens: 'Samsung Galaxy S21 FE (SM-G990B2)、35 mm 換算 76 mm',
    halos: ['太陽柱'],
    pops: [{ orient: 'plate', ca: 0.3, tilt: 3, rot: 0, w: 100, d: 150, pyr: 0 }],
  },
  {
    id: 'moon-pennsylvania-2020-12-29',
    name: '月の内暈',
    title: 'Winter halo around the moon',
    author: 'Ted Mielczarek',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    page: 'https://commons.wikimedia.org/wiki/File:Winter_halo_around_the_moon.jpg',
    w: 1200,
    h: 900,
    date: '2020-12-29 22:26',
    place: '米国ペンシルベニア州北東部',
    moon: true,
    elev: 63.4,
    proj: 2,
    fov: 65.3,
    az: -1.8,
    alt: 61.19,
    ev: -2,
    tau: 0.3,
    hc: 8,
    lens: 'Google Pixel 4a、35 mm 換算 27 mm',
    halos: ['内暈（月暈）'],
    pops: [{ orient: 'random', ca: 1, tilt: 0, rot: 0, w: 100, d: 60, pyr: 0 }],
  },
  {
    id: 'moon-dogs-didcot-2015-10-25',
    name: '幻月',
    title: 'Moon dogs in Didcot, UK in October',
    author: 'Annajohepworth',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    page: 'https://commons.wikimedia.org/wiki/File:Moon_dogs_in_Didcot,_UK_in_October.jpg',
    w: 1188,
    h: 792,
    date: '2015-10-25 20:56',
    place: '英国オックスフォードシャー州 Didcot',
    moon: true,
    elev: 31.6,
    proj: 2,
    fov: 63.5,
    az: -0.5,
    alt: 31.28,
    ev: -2.5,
    tau: 0.3,
    hc: 8,
    lens: 'Canon EOS 500D、35 mm 換算 29 mm',
    halos: ['幻月', '幻月環（一部）', '内暈'],
    pops: [
      { orient: 'plate', ca: 0.3, tilt: 1, rot: 0, w: 92, d: 150, pyr: 0 },
      { orient: 'random', ca: 1, tilt: 0, rot: 0, w: 8, d: 60, pyr: 0 },
    ],
  },
];
