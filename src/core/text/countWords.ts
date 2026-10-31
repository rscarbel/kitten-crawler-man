/**
 * Small counts written out as words, for lines that state a number the way a
 * person would say it ("two fragments", not "2 fragments").
 */

const COUNT_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
] as const;

/** `count` as a lower-case word, or as digits once it is past the words this knows. */
export function countWord(count: number): string {
  const hasWord = Number.isInteger(count) && count >= 0 && count < COUNT_WORDS.length;
  return hasWord ? COUNT_WORDS[count] : String(count);
}

/** `countWord(count)` with its first letter capitalised, to open a sentence. */
export function capitalisedCountWord(count: number): string {
  const word = countWord(count);
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

/** `count` in words followed by `singular` or `plural` to agree with it. */
export function countedNoun(count: number, singular: string, plural: string): string {
  return `${countWord(count)} ${count === 1 ? singular : plural}`;
}
