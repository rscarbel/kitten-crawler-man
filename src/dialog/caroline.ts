/**
 * The only way to author what Caroline, the System AI, says. Her frame
 * (`src/ui/widgets/carolineFrame.ts`) draws "System AI message:" over every
 * message and opens each with "Caroline - ", so script text carries neither:
 * a literal that starts with either is a compile error, and a string built at
 * run time has them stripped.
 *
 * Her speaker ref is keyed by a symbol this module keeps to itself, so no
 * other module can build a `DialogLine` in her voice by hand.
 */

import type { DialogLine } from './line';

const AUTHORED: unique symbol = Symbol('caroline');

/** Who a line of hers is attributed to; made only here. */
export interface CarolineSpeakerRef {
  readonly kind: 'caroline';
  readonly name: 'Caroline';
  readonly [AUTHORED]: true;
}

/** One message from Caroline, made only by {@link carolineLines}. */
export interface CarolineMessage {
  readonly [AUTHORED]: true;
  /** Her words alone, without the label or the prefix. */
  readonly text: string;
  /** The message as a line for a `Conversation`. */
  readonly line: DialogLine;
}

/** What her frame already draws in front of her words, in the order it draws them. */
const FRAME_TEXT = ['System AI message:', 'Caroline -'] as const;

/** Text that begins with what her frame already draws. */
type CarriesFrameText = `${(typeof FRAME_TEXT)[number]}${string}`;

const SPEAKER: CarolineSpeakerRef = { kind: 'caroline', name: 'Caroline', [AUTHORED]: true };

/** `text` without any frame text at its start, for a string the compiler could not check. */
function withoutFrameText(text: string): string {
  let rest = text.trimStart();
  for (const lead of FRAME_TEXT) {
    if (rest.startsWith(lead)) rest = rest.slice(lead.length).trimStart();
  }
  return rest;
}

export const carolineLines = {
  message<const Text extends string>(
    text: Text extends CarriesFrameText ? never : Text,
  ): CarolineMessage {
    const words = withoutFrameText(text);
    return {
      [AUTHORED]: true,
      text: words,
      line: { speaker: SPEAKER, paragraphs: [words], advance: { kind: 'continue' } },
    };
  },
  /**
   * A message that names something only known once a run is under way, such
   * as the player's own name: `build` is read each time the message is shown,
   * and the frame text is stripped from what it returns.
   */
  deferredMessage(build: () => string): CarolineMessage {
    return {
      [AUTHORED]: true,
      get text(): string {
        return withoutFrameText(build());
      },
      line: {
        speaker: SPEAKER,
        get paragraphs(): readonly [string] {
          return [withoutFrameText(build())];
        },
        advance: { kind: 'continue' },
      },
    };
  },
} as const;
