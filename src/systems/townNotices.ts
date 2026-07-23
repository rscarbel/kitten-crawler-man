/**
 * The Over City's notice board copy. Given a snapshot of quest progress, this
 * builds the short list of notices/bounties shown when the player reads the
 * board in the town square. It is the board's analog to `townDialog.ts`:
 * citizens gossip about what the player has done, and the board posts the same
 * world state as concrete, actionable notices — an available quest reads as an
 * OPEN posting, an in-progress one as ACTIVE with the current objective, a
 * finished one as DONE, and a live doomsday countdown as a DANGER alert.
 *
 * Pure data + selection: no rendering, no audio, no scene coupling. The owning
 * `TownPropSystem` / `NoticeBoardPanel` supply the context and draw the result.
 */

import type { CircusQuestStage } from '../core/CircusQuestProgress';
import type { MurderQuestStage } from '../core/MurderQuestProgress';
import type { DoomsdayStage } from '../core/DoomsdayProgress';

/** Visual/priority category for a posting. Sorted DANGER → ACTIVE → OPEN → DONE. */
export type NoticeTone = 'danger' | 'active' | 'available' | 'done';

export interface Notice {
  title: string;
  body: string;
  tone: NoticeTone;
}

/** The quest flags that determine what the board posts. */
export interface TownNoticeContext {
  circus: CircusQuestStage;
  /** Heather the Bear has fallen — the ruins hunt is behind the player. */
  heatherSlain: boolean;
  murder: MurderQuestStage;
  /** How many of the three murder clues have been gathered so far. */
  murderCluesFound: number;
  doomsday: DoomsdayStage;
}

export const TOTAL_MURDER_CLUES = 3;

/** Board-ordering priority: the most urgent postings float to the top. */
const TONE_PRIORITY: Record<NoticeTone, number> = {
  danger: 0,
  active: 1,
  available: 2,
  done: 3,
};

function circusNotice(ctx: TownNoticeContext): Notice | null {
  const title = 'The Show Must Go On';
  switch (ctx.circus) {
    case 'not_started':
      return {
        title,
        body: 'A grieving performer waits near the old circus grounds, seeking someone brave enough to right an old wrong.',
        tone: 'available',
      };
    case 'ritual_defense':
      return {
        title,
        body: "Signet's ritual is under siege. Hold the line against the horrors it draws out of the ruins.",
        tone: 'active',
      };
    case 'heather_hunt':
      return {
        title,
        body: ctx.heatherSlain
          ? 'The beast is dead. Ready the assault on the Big Top.'
          : 'Heather the Bear stalks the ruins. She must fall before the assault can begin.',
        tone: 'active',
      };
    case 'assault':
      return {
        title,
        body: "Storm the circus grounds and break the ringmaster's grip on his troupe.",
        tone: 'active',
      };
    case 'bigtop_ready':
      return {
        title,
        body: 'The Big Top stands open. Ringmaster Grimaldi awaits within.',
        tone: 'active',
      };
    case 'grimaldi_slain':
    case 'complete':
      return {
        title,
        body: 'Justice was done at the circus. The troupe walk free, and the ringmaster answers for his cruelty.',
        tone: 'done',
      };
  }
}

function murderNotice(ctx: TownNoticeContext): Notice | null {
  const title = 'The Krasue Murders';
  switch (ctx.murder) {
    case 'not_started':
      return {
        title,
        body: 'The town watch seeks anyone willing to look into a killing the guard cannot explain.',
        tone: 'available',
      };
    case 'body_waiting':
      return {
        title,
        body: 'A fresh body lies untended by the square. Someone should take a closer look before the trail goes cold.',
        tone: 'available',
      };
    case 'investigation':
      return {
        title,
        body: `Clues gathered: ${ctx.murderCluesFound}/${TOTAL_MURDER_CLUES}. Search the well, the victim's home, and the roost.`,
        tone: 'active',
      };
    case 'night_attack':
      return {
        title,
        body: 'Something hunts the streets after dark. Bar your doors — or take up arms and end it.',
        tone: 'danger',
      };
    case 'cult_hideout':
      return {
        title,
        body: 'The trail leads to a hidden den beyond the walls. Root out whoever shelters the killer.',
        tone: 'active',
      };
    case 'confrontation':
      return {
        title,
        body: 'The killer has a name at last. End the Krasue murders for good.',
        tone: 'active',
      };
    case 'quill_slain':
    case 'complete':
      return {
        title,
        body: 'The Krasue murders are over. The town sleeps a little easier tonight.',
        tone: 'done',
      };
  }
}

function doomsdayNotice(ctx: TownNoticeContext): Notice | null {
  switch (ctx.doomsday) {
    case 'containment':
      return {
        title: 'SOUL CRYSTAL UNSTABLE',
        body: 'The crystal in the tower is destabilizing. Reach it and contain the surge before the whole city is consumed.',
        tone: 'danger',
      };
    case 'escape':
      return {
        title: 'CONTAINMENT FAILED',
        body: 'There is no more time. Flee to the stairwell now, before the blast takes everyone with it.',
        tone: 'danger',
      };
    case 'inactive':
    case 'complete':
      return null;
  }
}

/** A standing bounty that always gives the board something to say. */
const RUINS_BOUNTY: Notice = {
  title: 'Ruins Bounty',
  body: 'The Watch pays coin for every horror culled beyond the town walls. Bring proof of the kill.',
  tone: 'available',
};

/**
 * Assemble the current board postings, most urgent first. Always returns at
 * least the standing ruins bounty so the board is never blank.
 */
export function buildTownNotices(ctx: TownNoticeContext): Notice[] {
  const notices: Notice[] = [];
  for (const notice of [circusNotice(ctx), murderNotice(ctx), doomsdayNotice(ctx)]) {
    if (notice !== null) notices.push(notice);
  }
  notices.push(RUINS_BOUNTY);
  notices.sort((a, b) => TONE_PRIORITY[a.tone] - TONE_PRIORITY[b.tone]);
  return notices;
}
