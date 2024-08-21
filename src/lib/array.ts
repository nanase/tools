export function sequence(start: number, end?: number): number[] {
  if (typeof end === 'undefined') {
    const array = Array(start);
    let i = 0;

    while (i < start) {
      array[i] = i++;
    }

    return array;
  } else {
    const array = Array(end - start);
    let i = 0;
    let j = start;

    while (j < end) {
      array[i++] = j++;
    }

    return array;
  }
}

export function divide(value: number, divider: number): number[] {
  const array = Array(divider);
  let i = 0;

  while (i < divider) {
    array[i] = (value / divider) * i++;
  }

  return array;
}

export function findMinMax(array: Iterable<number>): { max: number; min: number; maxIndex: number; minIndex: number } {
  let max = -Infinity;
  let min = Infinity;
  let maxIndex = -1;
  let minIndex = -1;
  let i = 0;

  for (const value of array) {
    if (value > max) {
      max = value;
      maxIndex = i;
    }

    if (value < min) {
      min = value;
      minIndex = i;
    }

    i++;
  }

  return {
    max: max,
    min: min,
    maxIndex: maxIndex,
    minIndex: minIndex,
  };
}

export function* generateForDepth<T>(array: Array<T>, depth: number): Iterable<Array<T>> {
  const n = array.length;
  const indices = Array(depth).fill(0);

  while (true) {
    yield indices.map((i) => array[i]);

    let i = depth - 1;

    while (i >= 0) {
      indices[i]++;

      if (indices[i] < n) {
        break;
      }

      indices[i] = 0;
      i--;
    }

    if (i < 0) {
      break;
    }
  }
}
