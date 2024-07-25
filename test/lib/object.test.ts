import { deepAssign, RawObject } from '../../src/lib/object';

describe('deepAssign', () => {
  test('assign empty object to empty object', () => {
    expect(deepAssign({}, {})).toStrictEqual({});
  });

  test('assign object to empty object', () => {
    expect(deepAssign({}, { a: 1, b: 2 })).toStrictEqual({ a: 1, b: 2 });
  });

  test('assign empty object to object', () => {
    expect(deepAssign({ a: 1, b: 2 }, {})).toStrictEqual({ a: 1, b: 2 });
  });

  test('assign raw object to object', () => {
    expect(deepAssign({ a: 1, b: 2 }, { b: new RawObject({ c: 3 }) })).toStrictEqual({ a: 1, b: { c: 3 } });
  });

  test('assign function to object', () => {
    const func = () => {};
    expect(deepAssign({ a: 1, b: 2 }, { b: new RawObject(func) })).toStrictEqual({ a: 1, b: func });
  });

  test('assign object to nested object', () => {
    expect(deepAssign({ a: 1, b: { c: 2 } }, { b: { c: 3 } })).toStrictEqual({ a: 1, b: { c: 3 } });
  });
});
