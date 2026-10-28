/**
 * The human looks the human harnesses and gates paint, by the id `--look=`
 * names. Every human garment, held item and motion set is fitted on all of
 * them: their builds share one rig and one set of rows, so a fit checked on
 * one says nothing about another.
 */

import { HUMAN_CRAWLER_LOOKS } from '../src/characters/humanCrawlerLooks.js';
import type { HumanLook } from '../src/sprites/looks/humanLook.js';
import { DAVE_LOOK } from '../src/sprites/looks/humans/dave.js';

/** Every look the human crawler can wear, and Dave, so a new crawler look is gated without being listed here. */
export const HUMAN_LOOKS: readonly HumanLook[] = [...Object.values(HUMAN_CRAWLER_LOOKS), DAVE_LOOK];

/** The look a harness paints when `--look=` names none. */
const DEFAULT_HUMAN_LOOK_ID = HUMAN_CRAWLER_LOOKS.male_light.id;

const LOOK_FLAG_PREFIX = '--look=';

function namedLookId(argv: readonly string[]): string | null {
  return (
    argv.find((arg) => arg.startsWith(LOOK_FLAG_PREFIX))?.slice(LOOK_FLAG_PREFIX.length) ?? null
  );
}

/** The look `--look=<id>` names, or the default; throws on an id no look has. */
export function humanLookFlag(argv: readonly string[] = process.argv): HumanLook {
  const raw = namedLookId(argv) ?? DEFAULT_HUMAN_LOOK_ID;
  const look = HUMAN_LOOKS.find((candidate) => candidate.id === raw);
  if (look === undefined) {
    throw new Error(`--look=${raw} is not one of ${HUMAN_LOOKS.map((l) => l.id).join(', ')}`);
  }
  return look;
}

/**
 * The looks a gate run judges: the one `--look=` names, or every human look
 * when it names none, so a run without the flag cannot pass on one build
 * while the other is red.
 */
export function gatedHumanLooks(argv: readonly string[] = process.argv): readonly HumanLook[] {
  return namedLookId(argv) === null ? HUMAN_LOOKS : [humanLookFlag(argv)];
}
