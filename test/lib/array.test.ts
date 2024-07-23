import { divide, sequence } from '../../src/lib/array';

describe('sequence', () => {
  test('generate empty array', () => {
    expect(sequence(0)).toStrictEqual([]);
  });

  test('generate sequence array', () => {
    expect(sequence(5)).toStrictEqual([0, 1, 2, 3, 4]);
  });

  test('generate sequence array with start', () => {
    expect(sequence(-2, 2)).toStrictEqual([-2, -1, 0, 1]);
  });
});

describe('divide', () => {
  test('generate empty array', () => {
    expect(divide(0, 0)).toStrictEqual([]);
  });

  test('generate sequence array', () => {
    expect(divide(5, 5)).toStrictEqual([0, 1, 2, 3, 4]);
  });
});
