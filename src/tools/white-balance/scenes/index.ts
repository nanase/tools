/* 場面の一覧（選択肢に出す順） */
import { lift, type Scene } from '../scene';
import { SCENE as aquarium } from './aquarium';
import { SCENE as autumn } from './autumn';
import { SCENE as beach } from './beach';
import { SCENE as cafe } from './cafe';
import { SCENE as cake } from './cake';
import { SCENE as chart } from './chart';
import { SCENE as room } from './room';
import { SCENE as snowdusk } from './snowdusk';
import { SCENE as snowshop } from './snowshop';
import { SCENE as study } from './study';
import { SCENE as table } from './table';
import { SCENE as washroom } from './washroom';

/* 手前の物が写真の下端のボタンに隠れる場面は、中身を上へずらす */
export const SCENES: readonly Scene[] = [
  lift(table, 70),
  chart,
  washroom,
  autumn,
  beach,
  aquarium,
  cake,
  lift(study, 55),
  lift(cafe, 45),
  lift(room, 60),
  snowdusk,
  snowshop,
];
