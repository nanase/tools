/** 録音の出典。ページの「録音の出典」の枠に出す。加工の詳細は SOURCES.md */

export interface Credit {
  /** SOUNDS の id */
  id: string;
  url: string;
  /** リンクの文言（どこの誰の録音か） */
  by: string;
  lic: 'cc0' | 'pd';
  /** 朗読の作品 */
  work?: string;
}

const FS = 'https://freesound.org/people/';
const fs = (who: string, n: number) => ({ url: `${FS}${who}/sounds/${n}/`, by: `Freesound の ${who} の録音` });

export const CREDITS: readonly Credit[] = [
  { id: 'brook', ...fs('straget', 415053), lic: 'cc0' },
  { id: 'rain', ...fs('jmbphilmes', 200273), lic: 'cc0' },
  { id: 'waves', ...fs('Alex_hears_things', 352356), lic: 'cc0' },
  { id: 'leaves', ...fs('Sandermotions', 276294), lic: 'cc0' },
  { id: 'fire', ...fs('Duophonic', 248303), lic: 'cc0' },
  { id: 'bees', ...fs('tom_woysky', 243011), lic: 'cc0' },
  { id: 'blackbird', ...fs('Kinoton', 346853), lic: 'cc0' },
  { id: 'uguisu', ...fs('warukunai', 524526), lic: 'cc0' },
  {
    id: 'frogs',
    url: 'https://www.nps.gov/yell/learn/photosmultimedia/sounds-chorusfrogs.htm',
    by: '米国国立公園局（NPS/Neal Herbert）の録音',
    lic: 'pd',
  },
  { id: 'crickets', ...fs('sengjinn', 175020), lic: 'cc0' },
  {
    id: 'chime',
    url: 'https://commons.wikimedia.org/wiki/File:Windglockenspiel.Koshi.ogg',
    by: 'Wikimedia Commons の Membeth の録音',
    lic: 'cc0',
  },
  { id: 'bell', ...fs('nahmandub', 131348), lic: 'cc0' },
  {
    id: 'voice-ja-f',
    url: 'https://archive.org/details/mshortworks_001_1202_librivox',
    by: 'LibriVox の piezke の朗読',
    lic: 'cc0',
    work: '芥川龍之介「蜜柑」',
  },
  {
    id: 'voice-ja-m',
    url: 'https://archive.org/details/gongitsune_um_librivox',
    by: 'LibriVox の ekzemplaro の朗読',
    lic: 'cc0',
    work: '新美南吉「ごん狐」',
  },
  {
    id: 'voice-en-m',
    url: 'https://archive.org/details/wind_in_the_willows_solo',
    by: 'LibriVox の Mark F. Smith の朗読',
    lic: 'pd',
    work: 'K. Grahame「The Wind in the Willows」第 1 章',
  },
];
