/**
 * 消灯ラッパ（Taps、米軍のビューグルの号令）の音符。
 * scripts/trumpet-scores.ts で taps.ly から作る（直接編集しない）。
 *
 * 音符は Wikimedia Commons の楽譜「File:Bugle Calls Taps.svg」（Jazzmanian 作、2007 年、パブリックドメイン、
 * https://commons.wikimedia.org/wiki/File:Bugle_Calls_Taps.svg）を手で写した taps.lyを読んだもの。
 * 音の高さは実音（MIDI）。ハ調のビューグルの記譜（G4 C5 E5 G5）を、B♭ 管のトランペットがピストンを押さずに吹く実音（F4 B♭4 D5 F5）へ長 2 度下げた。
 * 変更: 時刻と長さを 4 分音符の 1/960 に丸めた。
 *
 * 号令はパブリックドメイン（元の楽譜もパブリックドメイン）。このファイルと taps.ly も著作権を主張しない。
 */
import { decodeVoice, type ScoreNote, TICKS } from './types';

/** 声部の音（24 音。形式は types.ts の decodeVoice） */
const VOICES = [
  '-960,720,0,65 720,240,0,65 240,2880,8,70 2880,720,0,65 720,240,0,70 240,2880,8,74 2880,480,0,65 480,480,0,70 ' +
    '480,960,0,74 960,480,0,65 480,480,0,70 480,960,0,74 960,480,0,65 480,480,0,70 480,2880,8,74 2880,720,0,70 ' +
    '720,240,0,74 240,1920,0,77 1920,960,0,74 960,960,0,70 960,2880,0,65 2880,720,0,65 720,240,0,65 240,2880,8,70',
];

/** 小節線の時刻（1/960 拍） */
const BARS = [0, 3840, 7680, 11520, 15360, 19200, 23040];

export const voices = (): ScoreNote[][] => VOICES.map(decodeVoice);
export const bars = (): number[] => BARS.map((b) => b / TICKS);
