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
