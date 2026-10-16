/**
 * The Over City's notice board copy. Given a snapshot of quest progress, this
 * builds the short list of notices/bounties shown when the player reads the
 * board in the town square. It is the board's analog to `townDialog.ts`:
 * citizens gossip about what the player has done, and the board posts the same
 * world state as concrete, actionable notices — an available quest reads as an
 * OPEN posting, an in-progress one as ACTIVE with the current objective, a
 * finished one as DONE, and a live doomsday countdown as a DANGER alert.
 * Briar Hollow's board shares Wendell's work order and adds the siege call.
 *
 * Pure data + selection: no rendering, no audio, no scene coupling. The owning
 * `TownPropSystem` / `NoticeBoard` supply the context and draw the result.
 */

import type { CircusQuestStage } from '../core/CircusQuestProgress';
import type { MurderQuestStage } from '../core/MurderQuestProgress';
import type { DoomsdayStage } from '../core/DoomsdayProgress';
import type { BountyPhase } from '../core/BountyProgress';
import { asListItem, listed } from '../dialog/scripts/wendellContracts';

/** Visual/priority category for a posting. Sorted DANGER → ACTIVE → OPEN → SOON → DONE. */
export type NoticeTone = 'danger' | 'active' | 'available' | 'upcoming' | 'done';

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
  /** Live bounty state, or null on maps with no notice board bounty (non-overworld). */
  bounty: BountyNoticeState | null;
  workOrder: WorkOrderNoticeState;
}

/** Where Wendell's construction contracts stand, for the work-order posting on both boards. */
export type WorkOrderNoticeState =
  | { readonly kind: 'locked' }
  | { readonly kind: 'open' }
  | { readonly kind: 'held'; readonly siteName: string; readonly remaining: readonly string[] }
  | { readonly kind: 'ready'; readonly contactName: string };

/** What the board knows about Shady's current job. */
export interface BountyNoticeState {
  phase: BountyPhase;
  /** The mark's name, e.g. "Slice". Null unless a bounty is out. */
  name: string | null;
  /** The mark's type label, e.g. "the Mantid". Null unless a bounty is out. */
  typeLabel: string | null;
}

export const TOTAL_MURDER_CLUES = 3;

/** Board-ordering priority: the most urgent postings float to the top. */
const TONE_PRIORITY: Record<NoticeTone, number> = {
  danger: 0,
  active: 1,
  available: 2,
  upcoming: 3,
  done: 4,
};

function byTonePriority(a: Notice, b: Notice): number {
  return TONE_PRIORITY[a.tone] - TONE_PRIORITY[b.tone];
}

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
        body: 'The Big Top stands open. Whatever Grimaldi has become waits at its centre.',
        tone: 'active',
      };
    case 'grimaldi_redeemed':
    case 'complete':
      return {
        title,
        body: 'The vine under the Big Top remembers its own name again. The troupe walk free, and nobody had to die for it.',
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
        body: 'The killer has a name at last, and the name has a patron. End the Krasue murders for good.',
        tone: 'active',
      };
    case 'quill_slain':
      return {
        title,
        body: 'Miss Quill has fallen — but something far worse rose in her place. The tower is not safe yet.',
        tone: 'danger',
      };
    case 'lich_slain':
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

/**
 * The board's bounty posting, which tracks Shady's job rather than standing
 * still — so the board is the second place (after the arrow) a player can find
 * out who they are hunting.
 */
function bountyNotice(state: BountyNoticeState | null): Notice {
  const hooded = 'Speak to the hooded man loitering outside the Quiet Needle, in the Low Quarter.';
  if (state === null || state.phase === 'available') {
    return {
      title: 'Ruins Bounty',
      body: `The Watch pays coin for every horror culled beyond the town walls. ${hooded}`,
      tone: 'available',
    };
  }
  const mark =
    state.name !== null && state.typeLabel !== null
      ? `${state.name} ${state.typeLabel}`
      : 'the marked beast';
  if (state.phase === 'active') {
    return {
      title: `WANTED: ${mark}`,
      body: `Last seen out in the wilds beyond the walls. Kill it, then return. ${hooded}`,
      tone: 'active',
    };
  }
  return {
    title: `SLAIN: ${mark}`,
    body: `The mark is down. The purse is waiting. ${hooded}`,
    tone: 'active',
  };
}

/**
 * Wendell's standing offer of his hayloft. Deliberately not a quest hook —
 * there is nothing to hand in — but it is the board's one posting that points
 * at a *building* rather than at the wilds, which is what it is for: the board
 * is where a player looks to find out what this town has, and the loft's rest
 * is only ever found by walking into his house.
 */
const PLUMBLINE_FARM_NOTICE: Notice = {
  title: 'A Dry Loft, Plumbline Farm',
  body: "Plumbline Farm, north of the Barracks, keeps a hayloft that is sound, dry, and at present rather emptier than it was built to be. A crawler in want of an hour's rest may have one there for a modest charge, and will not be turned out of it. Enquire at the house.",
  tone: 'available',
};

/** Wendell's work order: a posting on both notice boards that also hands out his contracts. */
export function workOrderNotice(state: WorkOrderNoticeState): Notice {
  switch (state.kind) {
    case 'locked':
      return {
        title: 'Builder Wanted, Plumbline Farm',
        body: 'Wendell of Plumbline Farm expects more repair work than one man and a ladder can manage, once a certain set of borrowed drawings is back where it belongs. Paid work orders will be pinned here.',
        tone: 'upcoming',
      };
    case 'open':
      return {
        title: 'WORK ORDER: Plumbline Farm',
        body: "Repairs wanted. Bring your own boards, rope and stone; the client pays on completion. A tear-off strip at the foot of the order carries Wendell's plumb-bob stamp.",
        tone: 'available',
      };
    case 'held':
      return {
        title: `WORK ORDER: ${state.siteName}`,
        body: `Your strip is in your pocket. Still to do: ${listed(state.remaining.map(asListItem))}.`,
        tone: 'active',
      };
    case 'ready':
      return {
        title: 'WORK ORDER: Done',
        body: `The work is finished. Collect your pay from ${state.contactName}.`,
        tone: 'active',
      };
  }
}

const VILLAGE_SIEGE_NOTICE: Notice = {
  title: 'TO ARMS',
  body: 'The dead are at the palisade. Every pair of hands to the walls, and every pair of feet away from them.',
  tone: 'danger',
};

/** What Briar Hollow's board needs to know. */
export interface VillageNoticeContext {
  readonly workOrder: WorkOrderNoticeState;
  readonly underSiege: boolean;
}

/** Briar Hollow's board postings, most urgent first. Never empty: the work order is always up. */
export function buildVillageNotices(ctx: VillageNoticeContext): Notice[] {
  const notices: Notice[] = [];
  if (ctx.underSiege) notices.push(VILLAGE_SIEGE_NOTICE);
  notices.push(workOrderNotice(ctx.workOrder));
  notices.sort(byTonePriority);
  return notices;
}

/**
 * Assemble the current board postings, most urgent first. Always returns at
 * least the standing ruins bounty so the board is never blank.
 */
export function buildTownNotices(ctx: TownNoticeContext): Notice[] {
  const notices: Notice[] = [];
  for (const notice of [circusNotice(ctx), murderNotice(ctx), doomsdayNotice(ctx)]) {
    if (notice !== null) notices.push(notice);
  }
  notices.push(bountyNotice(ctx.bounty));
  notices.push(PLUMBLINE_FARM_NOTICE);
  notices.push(workOrderNotice(ctx.workOrder));
  notices.sort(byTonePriority);
  return notices;
}
