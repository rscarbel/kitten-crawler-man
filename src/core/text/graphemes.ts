/**
 * Text split where a reader sees one character: a letter with its combining
 * marks, a flag, a family emoji, a Hangul syllable built from jamo. Anything
 * that breaks, counts, ellipsises or reveals text one character at a time goes
 * through here, so it never splits a surrogate pair or strands a mark.
 */

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Printable ASCII never joins into a cluster, so it splits per code unit without the segmenter. */
const PRINTABLE_ASCII = /^[ -~]*$/;

/** `text` as its grapheme clusters, in order; they concatenate back to `text`. */
export function graphemes(text: string): string[] {
  if (PRINTABLE_ASCII.test(text)) return text.split('');
  return Array.from(segmenter.segment(text), (part) => part.segment);
}
