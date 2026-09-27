/**
 * Turns a speaker's Q&A menu into a conversation's choice row: questions
 * grouped under one "Ask a question" row, a non-repeatable topic already
 * picked this conversation dropped from the list, and the row that leaves
 * the conversation always last.
 *
 * A topic that only answers and returns to the same menu does so by having
 * its own `run` play a request whose `ending` rebuilds this same menu — the
 * "answer, then come back" shape is written once per topic, as data, rather
 * than inferred from whether anything happened.
 */

import type { Choice, ConversationHandle, ConversationRequest, ConversationTopic } from './request';
import type { NonEmpty } from './line';

const ASK_QUESTION_LABEL = 'I have a question';
const BACK_LABEL = 'Back';

/** Wraps a fresh choice list back into a request that keeps showing the line already on screen. */
export type MenuReopener = (choices: NonEmpty<Choice>) => ConversationRequest;

function toNonEmpty<T>(items: readonly T[], fallback: T): NonEmpty<T> {
  const [first, ...rest] = items;
  return first === undefined ? [fallback] : [first, ...rest];
}

function toChoice(topic: ConversationTopic, spent: Set<string>): Choice {
  return {
    label: topic.label,
    tone: topic.tone,
    run: (convo: ConversationHandle) => {
      if (!topic.repeatable) spent.add(topic.key);
      topic.run(convo);
    },
  };
}

function availableTopics(
  topics: readonly ConversationTopic[],
  spent: ReadonlySet<string>,
): readonly ConversationTopic[] {
  return topics.filter((topic) => topic.repeatable || !spent.has(topic.key));
}

/**
 * One screen of a speaker's menu — the conversation's root, or a submenu a
 * root row opened.
 *
 * `spent` names every non-repeatable topic already picked this conversation;
 * a topic named in it is left off the list rather than offered again.
 */
export function topicMenu(
  topics: readonly ConversationTopic[],
  spent: Set<string>,
  exitChoice: Choice,
  reopen: MenuReopener,
): NonEmpty<Choice> {
  const available = availableTopics(topics, spent);
  const questions = available.filter((topic) => topic.grouping === 'question');
  const actions = available.filter((topic) => topic.grouping !== 'question');

  const rows: Choice[] = actions.map((topic) => toChoice(topic, spent));

  if (questions.length > 0) {
    rows.push({
      label: ASK_QUESTION_LABEL,
      tone: 'normal',
      run: (convo) =>
        convo.play(reopen(questionSubmenu(topics, questions, spent, exitChoice, reopen))),
    });
  }

  rows.push(exitChoice);
  return toNonEmpty(rows, exitChoice);
}

function questionSubmenu(
  allTopics: readonly ConversationTopic[],
  questions: readonly ConversationTopic[],
  spent: Set<string>,
  exitChoice: Choice,
  reopen: MenuReopener,
): NonEmpty<Choice> {
  const back: Choice = {
    label: BACK_LABEL,
    tone: 'exit',
    run: (convo) => convo.play(reopen(topicMenu(allTopics, spent, exitChoice, reopen))),
  };
  const rows = availableTopics(questions, spent).map((topic) => toChoice(topic, spent));
  return toNonEmpty([...rows, back], back);
}
