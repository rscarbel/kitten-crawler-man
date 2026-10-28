/**
 * The one set of rules for a name the player types, shared by every kind of
 * name (the human crawler, the pets). Each kind brands its own type and sets
 * its own caps; the characters a name may hold are the same for all of them.
 *
 * The rules refuse, never rewrite: past tidying spaces and apostrophes, what
 * the player typed is either kept exactly or turned down with a reason the
 * screen can show.
 */

import { graphemes } from '../text/graphemes';

/** Why a typed name was turned down, in the order the rules are checked. */
export type NameRejection = 'empty' | 'charset' | 'noLetter' | 'tooManyMarks' | 'tooLong';

/** How long a kind of name may run. */
export interface NameCaps {
  /** The most characters a reader sees (grapheme clusters). */
  readonly maxGraphemes: number;
  /** The most UTF-16 code units, which bounds what the name costs to store and send. */
  readonly maxCodeUnits: number;
}

/**
 * The longest any name may be in UTF-16 code units, however few characters it
 * shows. Scripts and combining marks that take several code units a character
 * would otherwise let a short-looking name grow without limit.
 */
export const NAME_MAX_CODE_UNITS = 64;

/**
 * The most combining marks one character may carry. Real scripts stay under it
 * (Vietnamese stacks two); stacked-diacritic "zalgo" text does not, and it
 * overflows a dialog box upwards and downwards.
 */
export const MAX_MARKS_PER_CLUSTER = 4;

/**
 * Phone keyboards type a curly apostrophe by default, which reads as the
 * same mark to the player. The ʻokina (U+02BB) is a letter, not one of these.
 */
const TYPOGRAPHIC_APOSTROPHES = /[‘’ʼ]/g;
const SPACE_RUNS = /\p{Zs}+/gu;
const EDGE_SPACES = /^ +| +$/g;

const LETTER = /^\p{L}$/u;
const MARK = /^\p{M}$/u;
const MARKS = /\p{M}/gu;
/**
 * Code points a renderer draws as nothing: Hangul fillers (which Unicode files
 * as letters), variation selectors, the combining grapheme joiner. A name
 * built from them is blank on screen, and one inside a name hides a
 * difference two names that look alike would otherwise show.
 */
const INVISIBLE = /^\p{Default_Ignorable_Code_Point}$/u;
/**
 * Arabic tatweel and N'Ko lajanyalan only stretch the letters beside them; a
 * name of nothing else is a bare line, so they never count as its letter.
 */
const STRETCHING_LETTERS: ReadonlySet<string> = new Set(['\u0640', '\u07FA']);
/**
 * Letters, the marks some scripts build them from, digits, and the
 * punctuation names use: space, apostrophe, hyphen, period, and the middle
 * dot of Catalan "l·l".
 */
const NAME_CHARACTER = /^[\p{L}\p{M}\p{Nd} '\-.·]$/u;
/**
 * Zero-width non-joiner and joiner: Persian and Indic names need them to
 * shape a letter, so they are allowed only inside a word.
 */
const JOINERS: ReadonlySet<string> = new Set(['\u200C', '\u200D']);

/**
 * Whether the joiner at `index` shapes the letter cluster before it against a
 * letter after it. Either side may carry marks: the cluster before can end in
 * an Indic virama, and Bengali ya-phala puts the virama after the joiner
 * (ra, joiner, virama, ya).
 */
function joinsTwoLetters(codePoints: readonly string[], index: number): boolean {
  if (index === 0) return false;
  const before = codePoints[index - 1];
  const beforeIsLetterCluster = LETTER.test(before) || MARK.test(before);
  let afterIndex = index + 1;
  while (afterIndex < codePoints.length && MARK.test(codePoints[afterIndex])) afterIndex++;
  const letterFollows = afterIndex < codePoints.length && LETTER.test(codePoints[afterIndex]);
  return beforeIsLetterCluster && letterFollows;
}

/**
 * A combining mark builds on the letter before it. One that opens the name, or
 * follows a space, digit or punctuation, has nothing to sit on and draws as a
 * stray accent hanging off the previous glyph or the nameplate's edge. A
 * joiner after a letter passes the letter on to the marks after it.
 */
function marksSitOnLetters(codePoints: readonly string[]): boolean {
  let lastBase: string | undefined;
  for (const codePoint of codePoints) {
    if (MARK.test(codePoint)) {
      if (lastBase === undefined || !LETTER.test(lastBase)) return false;
      continue;
    }
    const joinerAfterLetter =
      JOINERS.has(codePoint) && lastBase !== undefined && LETTER.test(lastBase);
    if (joinerAfterLetter) continue;
    lastBase = codePoint;
  }
  return true;
}

function holdsOnlyNameCharacters(text: string): boolean {
  const codePoints = Array.from(text);
  if (!marksSitOnLetters(codePoints)) return false;
  return codePoints.every((codePoint, index) => {
    if (JOINERS.has(codePoint)) return joinsTwoLetters(codePoints, index);
    if (INVISIBLE.test(codePoint)) return false;
    return NAME_CHARACTER.test(codePoint);
  });
}

function holdsAVisibleLetter(text: string): boolean {
  return Array.from(text).some(
    (codePoint) => LETTER.test(codePoint) && !STRETCHING_LETTERS.has(codePoint),
  );
}

function marksIn(cluster: string): number {
  return cluster.match(MARKS)?.length ?? 0;
}

/**
 * `raw` tidied the way every name is before it is judged: NFC, curly
 * apostrophes folded to the straight one, runs of spaces collapsed to one,
 * and the ends trimmed. Line breaks and tabs are left in, so the rules refuse
 * them rather than quietly joining two lines.
 */
export function normalizeName(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(TYPOGRAPHIC_APOSTROPHES, "'")
    .replace(SPACE_RUNS, ' ')
    .replace(EDGE_SPACES, '');
}

/**
 * The first rule an already-normalised name breaks under `caps`, or null when
 * it is a name.
 */
export function nameRejection(normalized: string, caps: NameCaps): NameRejection | null {
  if (normalized.length === 0) return 'empty';
  if (!holdsOnlyNameCharacters(normalized)) return 'charset';
  if (!holdsAVisibleLetter(normalized)) return 'noLetter';
  const clusters = graphemes(normalized);
  if (clusters.some((cluster) => marksIn(cluster) > MAX_MARKS_PER_CLUSTER)) return 'tooManyMarks';
  const tooManyCharacters = clusters.length > caps.maxGraphemes;
  const tooManyCodeUnits = normalized.length > caps.maxCodeUnits;
  if (tooManyCharacters || tooManyCodeUnits) return 'tooLong';
  return null;
}

/** What a naming screen shows under the field for each rule, for a name with `caps`. */
export function nameRuleMessages(caps: NameCaps): Readonly<Record<NameRejection, string>> {
  return {
    empty: 'Type a name',
    charset: 'Use letters, spaces, apostrophes, hyphens or periods',
    noLetter: 'Include at least one letter',
    tooManyMarks: 'Too many accents on one letter',
    tooLong: `${caps.maxGraphemes} characters at most`,
  };
}
