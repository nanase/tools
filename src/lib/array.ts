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

export function findMinMax(...array: number[]): { max: number; min: number; maxIndex: number; minIndex: number } {
  if (array.length === 0) {
    throw new Error('Array is empty');
  }

  let max = array[0];
  let min = array[0];
  let maxIndex = 0;
  let minIndex = 0;

  for (let i = 1; i < array.length; i++) {
    if (array[i] > max) {
      max = array[i];
      maxIndex = i;
    }
    if (array[i] < min) {
      min = array[i];
      minIndex = i;
    }
  }

  return {
    max: max,
    min: min,
    maxIndex: maxIndex,
    minIndex: minIndex,
  };
}
