import dayjs, { Dayjs } from '@/lib/dayjs';

export type TimeCode = 'P' | '0' | '1' | 'S';

export interface EncodeOptions {
  callSign?: 'default' | 'force' | 'disable';
  summerTime?: boolean;
  summerTimeNotice?: boolean;
  leapSecondNotice?: boolean;
  leapSecondType?: boolean;
  stopAfter?: number;
  stopType?: boolean;
  stopDuration?: number;
}

export const StopAfterItems: { title: string; value: number }[] = [
  {
    title: '予定なし',
    value: 0,
  },
  {
    title: '7日以内に実施',
    value: 1,
  },
  {
    title: '3～6日以内に実施',
    value: 2,
  },
  {
    title: '2日以内に実施',
    value: 3,
  },
  {
    title: '24時間以内に実施',
    value: 4,
  },
  {
    title: '12時間以内に実施',
    value: 5,
  },
  {
    title: '2時間以内に実施',
    value: 6,
  },
];

export const StopDurationItems: { title: string; value: number }[] = [
  {
    title: '予定なし',
    value: 0,
  },
  {
    title: '7日間以上または期限未定',
    value: 1,
  },
  {
    title: '2～6日間',
    value: 2,
  },
  {
    title: '2日間以内',
    value: 3,
  },
];

export const CallSignItems: { title: string; value: string }[] = [
  {
    title: '毎時15分および45分',
    value: 'default',
  },
  {
    title: '強制',
    value: 'force',
  },
  {
    title: 'なし',
    value: 'disable',
  },
];

export const TimeCodeName: Record<TimeCode, string> = {
  P: 'ポジションマーカー',
  '0': 'ビット 0',
  '1': 'ビット 1',
  S: 'JJY コールサイン',
};

export const TimeCodeSignalDescription: Record<TimeCode, string> = {
  P: '高出力 0.2秒、低出力 0.8秒',
  '0': '高出力 0.8秒、低出力 0.2秒',
  '1': '高出力 0.5秒、低出力 0.5秒',
  S: '・－－－ ・－－－ －・－－（モールスで2回以内）',
};

const flag = (bit: number | boolean | undefined) => ((bit ?? false) == 0 ? '0' : '1');

function parity(n: number): boolean {
  let parity = false;

  while (n !== 0) {
    if ((n & 0x01) !== 0) {
      parity = !parity;
    }
    n >>= 1;
  }

  return parity;
}

export function encode(time: Dayjs, options?: EncodeOptions): TimeCode[] {
  const timeCopy = dayjs(time).startOf('minute');
  const timeCodes: TimeCode[] = [];
  time.subtract;

  for (let i = 0; i < 60; i++) {
    timeCodes[i] = encodeOnSecond(timeCopy.add(i, 'seconds'), options);
  }

  return timeCodes;
}

export function callsignEnabled(time: Dayjs, options?: EncodeOptions): boolean {
  return (
    (options?.callSign === 'force' || time.minute() === 15 || time.minute() === 45) &&
    !(options?.callSign === 'disable')
  );
}

export function encodeOnSecond(time: Dayjs, options?: EncodeOptions): TimeCode {
  const callsignEnable = callsignEnabled(time, options);

  switch (time.second()) {
    case 0:
      return 'P';

    case 1:
      return flag((time.minute() / 10) & 0x04);
    case 2:
      return flag((time.minute() / 10) & 0x02);
    case 3:
      return flag((time.minute() / 10) & 0x01);
    case 4:
      return '0';

    case 5:
      return flag(time.minute() % 10 & 0x08);
    case 6:
      return flag(time.minute() % 10 & 0x04);
    case 7:
      return flag(time.minute() % 10 & 0x02);
    case 8:
      return flag(time.minute() % 10 & 0x01);
    case 9:
      return 'P';

    case 10:
    case 11:
      return '0';
    case 12:
      return flag((time.hour() / 10) & 0x02);
    case 13:
      return flag((time.hour() / 10) & 0x01);
    case 14:
      return '0';

    case 15:
      return flag(time.hour() % 10 & 0x08);
    case 16:
      return flag(time.hour() % 10 & 0x04);
    case 17:
      return flag(time.hour() % 10 & 0x02);
    case 18:
      return flag(time.hour() % 10 & 0x01);
    case 19:
      return 'P';

    case 20:
    case 21:
      return '0';
    case 22:
      return flag((time.dayOfYear() / 100) & 0x02);
    case 23:
      return flag((time.dayOfYear() / 100) & 0x01);
    case 24:
      return '0';

    case 25:
      return flag((time.dayOfYear() / 10) % 10 & 0x08);
    case 26:
      return flag((time.dayOfYear() / 10) % 10 & 0x04);
    case 27:
      return flag((time.dayOfYear() / 10) % 10 & 0x02);
    case 28:
      return flag((time.dayOfYear() / 10) % 10 & 0x01);
    case 29:
      return 'P';

    case 30:
      return flag(time.dayOfYear() % 10 & 0x08);
    case 31:
      return flag(time.dayOfYear() % 10 & 0x04);
    case 32:
      return flag(time.dayOfYear() % 10 & 0x02);
    case 33:
      return flag(time.dayOfYear() % 10 & 0x01);
    case 34:
      return '0';

    case 35:
      return '0';
    case 36:
      return flag(parity(((time.hour() / 10) << 4) | time.hour() % 10));
    case 37:
      return flag(parity(((time.minute() / 10) << 4) | time.minute() % 10));
    case 38:
      return flag(options?.summerTimeNotice);
    case 39:
      return 'P';

    case 40:
      return callsignEnable ? 'S' : flag(options?.summerTime);
    case 41:
      return callsignEnable ? 'S' : flag(((time.year() % 100) / 10) & 0x08);
    case 42:
      return callsignEnable ? 'S' : flag(((time.year() % 100) / 10) & 0x04);
    case 43:
      return callsignEnable ? 'S' : flag(((time.year() % 100) / 10) & 0x02);
    case 44:
      return callsignEnable ? 'S' : flag(((time.year() % 100) / 10) & 0x01);

    case 45:
      return callsignEnable ? 'S' : flag(time.year() % 10 & 0x08);
    case 46:
      return callsignEnable ? 'S' : flag(time.year() % 10 & 0x04);
    case 47:
      return callsignEnable ? 'S' : flag(time.year() % 10 & 0x02);
    case 48:
      return callsignEnable ? 'S' : flag(time.year() % 10 & 0x01);

    case 49:
      return 'P';

    case 50:
      return callsignEnable ? flag((options?.stopAfter ?? 0) & 0x04) : flag(time.day() & 0x04);
    case 51:
      return callsignEnable ? flag((options?.stopAfter ?? 0) & 0x02) : flag(time.day() & 0x02);
    case 52:
      return callsignEnable ? flag((options?.stopAfter ?? 0) & 0x01) : flag(time.day() & 0x01);

    case 53:
      return callsignEnable && options?.stopAfter !== 0 ? flag(options?.stopType) : flag(options?.leapSecondNotice);
    case 54:
      return callsignEnable && options?.stopAfter !== 0
        ? flag((options?.stopDuration ?? 0) & 0x02)
        : flag(options?.leapSecondNotice && options?.leapSecondType);
    case 55:
      return callsignEnable && options?.stopAfter !== 0 ? flag((options?.stopDuration ?? 0) & 0x01) : '0';

    case 56:
    case 57:
    case 58:
      return '0';

    case 59:
      return 'P';

    default: {
      console.info('invalid time', time);
      return '0';
    }
  }
}

export function getTimeCodeDescription(second: number, callsign: boolean): string {
  switch (second) {
    case 0:
      return 'M: 開始を表すポジションマーカー（固定）';
    case 1:
      return '分の重み（40）';
    case 2:
      return '分の重み（20）';
    case 3:
      return '分の重み（10）';
    case 4:
      return '未使用（常にビット 0）';
    case 5:
      return '分の重み（8）';
    case 6:
      return '分の重み（4）';
    case 7:
      return '分の重み（2）';
    case 8:
      return '分の重み（1）';
    case 9:
      return 'P1: ポジションマーカー（固定）';

    case 10:
    case 11:
      return '未使用（常にビット 0）';
    case 12:
      return '時の重み（20）';
    case 13:
      return '時の重み（10）';
    case 14:
      return '未使用（常にビット 0）';
    case 15:
      return '時の重み（8）';
    case 16:
      return '時の重み（4）';
    case 17:
      return '時の重み（2）';
    case 18:
      return '時の重み（1）';
    case 19:
      return 'P2: ポジションマーカー（固定）';

    case 20:
    case 21:
      return '未使用（常にビット 0）';
    case 22:
      return '年の通算日の重み（200）';
    case 23:
      return '年の通算日の重み（100）';
    case 24:
      return '未使用（常にビット 0）';

    case 25:
      return '年の通算日の重み（80）';
    case 26:
      return '年の通算日の重み（40）';
    case 27:
      return '年の通算日の重み（20）';
    case 28:
      return '年の通算日の重み（10）';
    case 29:
      return 'P3: ポジションマーカー（固定）';

    case 30:
      return '年の通算日の重み（8）';
    case 31:
      return '年の通算日の重み（4）';
    case 32:
      return '年の通算日の重み（2）';
    case 33:
      return '年の通算日の重み（1）';
    case 34:
    case 35:
      return '未使用（常にビット 0）';
    case 36:
      return 'PA1: 「時」部のビットの偶数パリティ';
    case 37:
      return 'PA2: 「分」部のビットの偶数パリティ';
    case 38:
      return 'SU1: 6日以内に夏時間開始または終了のときビット 1';
    case 39:
      return 'P4: ポジションマーカー（固定）';

    case 40:
      return callsign ? '「JJY」を表すコールサイン' : 'SU2: 夏時間実施中のときビット 1';
    case 41:
      return callsign ? '「JJY」を表すコールサイン' : '年の重み（80）';
    case 42:
      return callsign ? '「JJY」を表すコールサイン' : '年の重み（40）';
    case 43:
      return callsign ? '「JJY」を表すコールサイン' : '年の重み（20）';
    case 44:
      return callsign ? '「JJY」を表すコールサイン' : '年の重み（10）';
    case 45:
      return callsign ? '「JJY」を表すコールサイン' : '年の重み（8）';
    case 46:
      return callsign ? '「JJY」を表すコールサイン' : '年の重み（4）';
    case 47:
      return callsign ? '「JJY」を表すコールサイン' : '年の重み（2）';
    case 48:
      return callsign ? '「JJY」を表すコールサイン' : '年の重み（1）';
    case 49:
      return 'P5: ポジションマーカー（固定）';

    case 50:
      return callsign ? 'ST1: 停波が開始するまでの時間の上位1ビット目' : '日曜日を起点とした曜日の上位1ビット目';
    case 51:
      return callsign ? 'ST2: 停波が開始するまでの時間の上位2ビット目' : '日曜日を起点とした曜日の上位2ビット目';
    case 52:
      return callsign ? 'ST3: 停波が開始するまでの時間の上位3ビット目' : '日曜日を起点とした曜日の上位3ビット目';
    case 53:
      return callsign ? 'ST4: 停波が昼間のみのときビット 1' : 'LS1: 月末に閏秒が実施されるときビット 1';
    case 54:
      return callsign
        ? 'ST5: 停波の期間の上位1ビット目'
        : 'LS2: 実施される閏秒の種別が挿入のときビット 1、削除のときビット 0';
    case 55:
      return callsign ? 'ST6: 停波の期間の上位2ビット目' : '未使用（常にビット 0）';

    case 56:
    case 57:
    case 58:
      return '未使用（常にビット 0）';

    case 59:
      return 'P0: ポジションマーカー（固定）';

    default: {
      console.info('invalid time', second);
      return '';
    }
  }
}
