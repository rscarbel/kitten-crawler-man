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
 * A board only ever posts what is already true of the world: every posting
 * declares the condition it waits on (`postedOnce`), so nothing is
 * pinned up ahead of the quest or the work it announces.
 *
 * Pure data + selection: no rendering, no audio, no scene coupling. The owning
 * `TownPropSystem` / `NoticeBoard` supply the context and draw the result.
 */

import type { BountyPhase } from '../core/quests/BountyProgress';
import { asListItem, listed } from '../dialog/scripts/wendellContracts';
import type { TownCatId } from '../core/state/townCatIds';
import { TOWN_CATS } from './critters/TownCats';
import { buildingDisplayName } from '../map/buildingIds';

/** Visual/priority category for a posting. Sorted DANGER → ACTIVE → OPEN → DONE. */
export type NoticeTone = 'danger' | 'active' | 'available' | 'done';

export interface Notice {
  title: string;
  body: string;
  tone: NoticeTone;
}

/** The quest flags that determine what the board posts. */
export interface TownNoticeContext {
  /** Live bounty state, or null on maps with no Shady to take a bounty from. */
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

/** The work-order states a board posts: a locked contract has nothing to pin up yet. */
type PostedWorkOrder = Exclude<WorkOrderNoticeState, { readonly kind: 'locked' }>;

function isPostedWorkOrder(state: WorkOrderNoticeState): state is PostedWorkOrder {
  return state.kind !== 'locked';
}

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
  done: 3,
};

function byTonePriority(a: Notice, b: Notice): number {
  return TONE_PRIORITY[a.tone] - TONE_PRIORITY[b.tone];
}

/**
 * The board's bounty posting, which tracks Shady's job rather than standing
 * still — so the board is the second place (after the arrow) a player can find
 * out who they are hunting.
 */
function bountyNotice(state: BountyNoticeState): Notice {
  const hooded = 'Speak to the hooded man loitering outside the Quiet Needle, in the Low Quarter.';
  if (state.phase === 'available') {
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
export function workOrderNotice(state: PostedWorkOrder): Notice {
  switch (state.kind) {
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
    'Tiny and grey, with four white socks. Went out through the back window, and nobody walked through the garden to reach it.',
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

const POSTING_DECLARED: unique symbol = Symbol('postingDeclared');

/**
 * One posting on a board. Only `postedFromStart` and `postedOnce` write the
 * mark, so every posting declares what must already be true of the world
 * before it goes up.
 */
interface Posting<Ctx> {
  readonly post: (ctx: Ctx) => readonly Notice[];
  readonly [POSTING_DECLARED]: true;
}

/** A posting about what the town has from the party's first day in it. */
function postedFromStart<Ctx>(notices: readonly Notice[]): Posting<Ctx> {
  return { post: () => notices, [POSTING_DECLARED]: true };
}

/**
 * A posting about a quest, a job or an event: `basisOf` reads the state that
 * makes it true, null until it is, and `notices` is written from that state alone.
 */
function postedOnce<Ctx, Basis>(
  basisOf: (ctx: Ctx) => Basis | null,
  notices: (basis: Basis) => readonly Notice[],
): Posting<Ctx> {
  return {
    post: (ctx) => {
      const basis = basisOf(ctx);
      return basis === null ? [] : notices(basis);
    },
    [POSTING_DECLARED]: true,
  };
}

function boardNotices<Ctx>(postings: Readonly<Record<string, Posting<Ctx>>>, ctx: Ctx): Notice[] {
  const notices = Object.values(postings).flatMap((posting) => posting.post(ctx));
  notices.sort(byTonePriority);
  return notices;
}

function postedWorkOrder(state: WorkOrderNoticeState): PostedWorkOrder | null {
  return isPostedWorkOrder(state) ? state : null;
}

type TownPostingId = 'missingCats' | 'ruinsBounty' | 'dryLoft' | 'workOrder';

const TOWN_POSTINGS = {
  missingCats: postedOnce<TownNoticeContext, readonly TownCatId[]>(
    (ctx) => (ctx.missingCats.length > 0 ? ctx.missingCats : null),
    (cats) => cats.map(missingCatNotice),
  ),
  ruinsBounty: postedOnce<TownNoticeContext, BountyNoticeState>(
    (ctx) => ctx.bounty,
    (bounty) => [bountyNotice(bounty)],
  ),
  // Wendell lets the loft from the first day, before any quest of his.
  dryLoft: postedFromStart<TownNoticeContext>([PLUMBLINE_FARM_NOTICE]),
  workOrder: postedOnce<TownNoticeContext, PostedWorkOrder>(
    (ctx) => postedWorkOrder(ctx.workOrder),
    (order) => [workOrderNotice(order)],
  ),
} as const satisfies Record<TownPostingId, Posting<TownNoticeContext>>;

/** What Briar Hollow's board needs to know. */
export interface VillageNoticeContext {
  readonly workOrder: WorkOrderNoticeState;
  readonly underSiege: boolean;
}

type VillagePostingId = 'siege' | 'workOrder';

const VILLAGE_POSTINGS = {
  siege: postedOnce<VillageNoticeContext, Notice>(
    (ctx) => (ctx.underSiege ? VILLAGE_SIEGE_NOTICE : null),
    (notice) => [notice],
  ),
  workOrder: postedOnce<VillageNoticeContext, PostedWorkOrder>(
    (ctx) => postedWorkOrder(ctx.workOrder),
    (order) => [workOrderNotice(order)],
  ),
} as const satisfies Record<VillagePostingId, Posting<VillageNoticeContext>>;

/** Briar Hollow's board postings, most urgent first; bare until the siege or Wendell's contracts give it something to say. */
export function buildVillageNotices(ctx: VillageNoticeContext): Notice[] {
  return boardNotices<VillageNoticeContext>(VILLAGE_POSTINGS, ctx);
}

/** The town board's current postings, most urgent first. */
export function buildTownNotices(ctx: TownNoticeContext): Notice[] {
  return boardNotices<TownNoticeContext>(TOWN_POSTINGS, ctx);
}
