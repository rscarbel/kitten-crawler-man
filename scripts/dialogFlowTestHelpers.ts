/**
 * A standalone `VillagerConversationFlow` and a recording `ConversationHandle`
 * for exercising a `TopicProvider`'s topics outside a real `VillagerSystem`
 * session — a gate that only needs to catch a topic whose `run` throws, or
 * read the choice row a beat would show, has no speaker to anchor a real
 * conversation to.
 */

import type { DialogLine, NonEmpty } from '../src/dialog/line';
import { speakerLines } from '../src/dialog/line';
import type {
  Choice,
  ConversationHandle,
  ConversationRequest,
  ConversationTopic,
} from '../src/dialog/request';
import { topicMenu } from '../src/dialog/topics';
import type { VillagerConversationFlow } from '../src/systems/briarHollow/villagerTopics';

const PLACEHOLDER_LINES: NonEmpty<DialogLine> = [speakerLines('narrator').line('placeholder')];

function baseRequest(
  lines: NonEmpty<DialogLine>,
  ending: ConversationRequest['ending'],
): ConversationRequest {
  return {
    lines,
    reward: null,
    questRelated: false,
    ending,
    dismiss: { kind: 'blocked' },
    haltsWorld: false,
    anchor: null,
    // The number keys choose, and they are the hotbar's too.
    locksKeyboard: true,
  };
}

/**
 * A flow whose `answer`/`closeNow` endings are inert (no side effect fires)
 * and whose `answerWithTopics`/`openTopics` build a real choice row through
 * `topicMenu`, so a walk that plays every request it returns reaches every
 * submenu a topic opens.
 */
export function testConversationFlow(): VillagerConversationFlow {
  const spent = new Set<string>();
  const exit: Choice = { label: 'Back', tone: 'exit', run: () => undefined };
  const reopen = (choices: NonEmpty<Choice>): ConversationRequest =>
    baseRequest(PLACEHOLDER_LINES, { kind: 'choices', choices });
  const choicesFor = (topics: readonly ConversationTopic[]): NonEmpty<Choice> =>
    topicMenu(topics, spent, exit, reopen);
  const inertClose: ConversationRequest['ending'] = { kind: 'close', onClosed: () => undefined };
  /** The `ending` last built, so `sayKeepingMenu` can say a line without disturbing it — same rule as the real flow's. */
  let lastEnding: ConversationRequest['ending'] = inertClose;
  const track = (request: ConversationRequest): ConversationRequest => {
    lastEnding = request.ending;
    return request;
  };
  return {
    answer: (lines) => track(baseRequest(lines, inertClose)),
    answerWithTopics: (lines, topics) =>
      track(baseRequest(lines, { kind: 'choices', choices: choicesFor(topics) })),
    answerAndReturnToRoot: (lines) => track(baseRequest(lines, inertClose)),
    sayKeepingMenu: (lines) => track(baseRequest(lines, lastEnding)),
    returnToRoot: () => track(baseRequest(PLACEHOLDER_LINES, inertClose)),
    openTopics: (topics) =>
      track(baseRequest(PLACEHOLDER_LINES, { kind: 'choices', choices: choicesFor(topics) })),
    closeNow: () => track(baseRequest(PLACEHOLDER_LINES, inertClose)),
    closeAfter: (lines, onClosed) => track(baseRequest(lines, { kind: 'close', onClosed })),
    onEventualClose: () => undefined,
  };
}

/** Something a walk can `run`: a `ConversationTopic` or a `Choice` a beat's ending showed. */
export type Runnable = Pick<ConversationTopic, 'run'>;

/**
 * A recording handle: every `Choice` a played request's choice row offers is
 * queued into `pending`, so a caller that walks `pending` with a `for...of`
 * reaches a submenu's own rows too.
 */
export function recordingHandle(pending: Runnable[]): ConversationHandle {
  return {
    play: (request) => {
      if (request.ending.kind === 'choices') pending.push(...request.ending.choices);
    },
    close: () => undefined,
  };
}
