export class RawObject {
  constructor(readonly obj: object) {}
}

type SourceType = {
  [Key: string]:
    | boolean
    | number
    | string
    | undefined
    | null
    | symbol
    | bigint
    | RawObject
    | Array<unknown>
    | SourceType;
};

export function deepAssign<T>(target: T, source: SourceType): T {
  if (typeof target !== 'undefined' && target != null) {
    for (const key of Object.keys(source)) {
      if (source[key] instanceof RawObject) {
        (target as any)[key] = source[key].obj;
      } else if (source[key] === null) {
        (target as any)[key] = null;
      } else if (!Array.isArray(source[key]) && typeof source[key] === 'object') {
        (target as any)[key] = deepAssign((target as any)[key], source[key]);
      } else {
        (target as any)[key] = source[key];
      }
    }
  }

  return target;
}
