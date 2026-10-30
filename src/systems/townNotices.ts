/**
 * Taloncrest's notice board copy. Given a snapshot of quest progress, this
 * builds the short list of notices/bounties shown when the player reads the
 * board in the town square. It is the board's analog to `townDialog.ts`:
 * citizens gossip about what the player has done, and the board posts the same
 * world state as concrete, actionable notices — an available quest reads as an
 * OPEN posting, an in-progress one as ACTIVE with the current objective, and a
 * finished one as DONE. Briar Hollow's board shares Wendell's work order and
 * adds the siege call as a DANGER alert.
 *
 * Pure data + selection: no rendering, no audio, no scene coupling. The owning
 * `TownPropSystem` / `NoticeBoard` supply the context and draw the result.
 */

import type { BountyPhase } from '../core/quests/BountyProgress';
import { asListItem, listed } from '../dialog/scripts/wendellContracts';
import type { TownCatId } from '../core/state/townCatIds';
import { TOWN_CATS } from './critters/TownCats';
import { buildingDisplayName } from '../map/buildingIds';

/** Visual/priority category for a posting. Sorted DANGER → ACTIVE → OPEN → SOON → DONE. */
export type NoticeTone = 'danger' | 'active' | 'available' | 'upcoming' | 'done';

export interface Notice {
  title: string;
  body: string;
  tone: NoticeTone;
}

/** The quest flags that determine what the board posts. */
export interface TownNoticeContext {
  /** Live bounty state, or null on maps with no notice board bounty (non-overworld). */
  bounty: BountyNoticeState | null;
  workOrder: WorkOrderNoticeState;
  /** The town cats posted missing, one notice each; empty while nobody has put them up. */
  missingCats: readonly TownCatId[];
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

/** What each owner wrote on their cat's notice. */
const MISSING_CAT_DESCRIPTIONS = {
  taloncrest_inn_cat: 'Fat ginger cat. Sleeps on the end of the bar. Never misses supper.',
  taloncrest_old_lady_cottage_cat:
    'Tiny and grey, with four white socks. Went out through a high window that nobody could climb to.',
  taloncrest_apothecary_cat:
    'Lean silver tabby, green eyes. Smells faintly of mint. The night she went, somebody left a dish of fish in our back room.',
  taloncrest_flagon_tavern_cat:
    'Broad black-and-white mouser, one torn ear. Will not be picked up.',
  taloncrest_mill_farm_cat:
    'Scruffy brown mill cat. Sleeps up on the millstones every night. Gone from them with the mill door bolted.',
  taloncrest_smithy_cat:
    'All black and always sooty, amber eyes. Likes the warm side of the forge.',
  taloncrest_general_store_cat:
    'Calico. Sits on the shop step all day. Taken from right outside the door.',
} as const satisfies Record<TownCatId, string>;

/** One missing cat's notice, signed with the house she was taken from. */
function missingCatNotice(cat: TownCatId): Notice {
  const def = TOWN_CATS[cat];
  return {
    title: `MISSING: ${def.displayName}`,
    body: `${MISSING_CAT_DESCRIPTIONS[cat]} Bring word to ${buildingDisplayName(def.home)}.`,
    tone: 'active',
  };
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
  const notices = [
    ...ctx.missingCats.map(missingCatNotice),
    bountyNotice(ctx.bounty),
    PLUMBLINE_FARM_NOTICE,
    workOrderNotice(ctx.workOrder),
  ];
  notices.sort(byTonePriority);
  return notices;
}
