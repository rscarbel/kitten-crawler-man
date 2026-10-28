/**
 * A name set into a line of left-to-right text. A right-to-left name dropped in
 * bare drags the punctuation beside it into its own run ("Hello, <name>!" puts
 * the "!" on the wrong side), so such a name is wrapped in a first-strong
 * isolate, which lays it out on its own and leaves its neighbours in place.
 */

const FIRST_STRONG_ISOLATE = '⁨';
const POP_DIRECTIONAL_ISOLATE = '⁩';

const DISPLAY_ISOLATES = new RegExp(`[${FIRST_STRONG_ISOLATE}${POP_DIRECTIONAL_ISOLATE}]`, 'gu');

/** Letters of the scripts written right to left that a player's keyboard can type. */
const RIGHT_TO_LEFT_LETTER =
  /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}\p{Script=Hanifi_Rohingya}]/u;

/**
 * `name` ready to place in display text: wrapped in FSI…PDI when it holds a
 * right-to-left letter, unchanged otherwise. Display only: a save or a message
 * to the AI carries the bare name.
 */
export function isolateForDisplay(name: string): string {
  if (!RIGHT_TO_LEFT_LETTER.test(name)) return name;
  return `${FIRST_STRONG_ISOLATE}${name}${POP_DIRECTIONAL_ISOLATE}`;
}

/**
 * `text` with every isolate {@link isolateForDisplay} adds taken out, for text
 * built for the screen that also leaves the page. The name rules refuse both
 * characters, so this never removes anything the player typed.
 */
export function withoutDisplayIsolates(text: string): string {
  return text.replace(DISPLAY_ISOLATES, '');
}
