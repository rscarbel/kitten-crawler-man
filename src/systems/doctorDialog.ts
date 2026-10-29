/**
 * The safe-room doctors' names and their choice-row labels.
 *
 * Everything a doctor actually says lives in `dialog/scripts/doctor.ts` instead —
 * this module is what a script or a system needs that is not itself a line of
 * dialog.
 */

import type { NonEmpty } from '../dialog/line';
import { safeRoomSeed, type SafeRoomId } from '../map/safeRoomId';

/**
 * The surnames a safe room's doctor can carry, picked by the room's seed.
 *
 * Cheap, and the single change that stops the doctor reading as one repeated
 * prop: neighbouring safe rooms on one map always have different doctors, and
 * each map's run of names starts somewhere of its own.
 */
const DOCTOR_SURNAMES: NonEmpty<string> = [
  'Lindqvist',
  'Okafor',
  'Varga',
  'Morales',
  'Hale',
  'Nakamura',
  'Brennan',
  'Adeyemi',
  'Kowalski',
  'Reyes',
  'Haddad',
  'Whitlock',
];

/** The doctor's name for a given safe room, stable across visits. */
export function doctorNameForRoom(room: SafeRoomId): string {
  const surname = DOCTOR_SURNAMES[safeRoomSeed(room) % DOCTOR_SURNAMES.length];
  return `Dr. ${surname}`;
}

/** Labels for the fixed choices offered under the dialog box. */
export const DOCTOR_CHOICE_LABELS = {
  treat: 'Patch us up',
  leave: 'Leave',
} as const;

/** Topics the chat choice cycles through, so a second question gets a new answer. */
export const CHAT_TOPIC_ORDER = ['aboutSafeRoom', 'aboutSelf', 'aboutDungeon'] as const;

export type ChatTopic = (typeof CHAT_TOPIC_ORDER)[number];

/**
 * What the chat button says for each topic.
 *
 * The button carries the question, because nothing else on screen does: a single
 * `Just chatting` button would leave the player reading an answer with no idea
 * what had been asked.
 */
export const CHAT_TOPIC_LABELS: Record<ChatTopic, string> = {
  aboutSafeRoom: 'Ask about this room',
  aboutSelf: 'Ask about the doctor',
  aboutDungeon: 'Ask about the Dungeon',
};
