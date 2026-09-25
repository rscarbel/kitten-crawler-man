/**
 * Which line a Briar Hollow villager opens a conversation with, right now.
 *
 * Pure: the resolver reads a {@link VillagerContext} snapshot and returns the
 * circumstance to say, never touching the state it was built from. The
 * villager system builds the context, shows the line and then records what
 * the line spent (a one-shot flag, Wicker's hint cooldown) — which keeps the
 * whole rule ladder drivable headlessly by the dialogue gate.
 *
 * Every line is looked up by circumstance in `ratkinDialogue.ts`; nothing here
 * types a word of dialogue.
 */

import type { ToolTier } from '../../core/toolTiers';
import type { SoldierOrder, VillageQuestState } from '../../core/briarHollowState';
import { hasAcceptedMayorRequest, type VillageQuestPhase } from '../../core/villageQuestPhase';
import type { NPCMarkerType } from '../../creatures/QuestNPC';
import { type Circumstance, type VillagerId, line, villagerEntry } from './ratkinDialogue';
import type { ConversationController } from './villagerTopics';

/** Seconds after an event during which a villager still brings it up. */
export const RECENT_EVENT_SECONDS = 30;
/** How close, in tiles, a crumbling deposit must be for Garn to have noticed it. */
export const DEPOSIT_NOTICE_RADIUS_TILES = 12;
/** Party stone Garn wants to see before he calls it a good load. */
export const STONE_DELIVERED_MIN = 10;
/** Party stone that makes Wicker think a wooden wall could be stone. */
export const STONE_UPGRADE_HINT_MIN_STONE = 5;
/** Wicker repeats his stone suggestion at most this often. */
export const STONE_UPGRADE_HINT_COOLDOWN_SECONDS = 300;
/** A shop stock at or below this makes Vetch worry about supplies. */
export const LOW_SUPPLIES_THRESHOLD = 3;

/** Construction levels at which Tikka remarks on what the builder can now do, lowest first. */
const TIKKA_CONSTRUCTION_MILESTONES: ReadonlyArray<{
  readonly level: number;
  readonly circumstance: Circumstance;
}> = [
  { level: 5, circumstance: 'spikes_unlocked' },
  { level: 10, circumstance: 'level_10_construction' },
  { level: 15, circumstance: 'level_15_construction' },
];

/** Phases in which the village is working toward the siege: everyone's `quest_active`. */
const QUEST_ACTIVE_PHASES: ReadonlySet<VillageQuestPhase> = new Set([
  'need_tools',
  'gathering',
  'fortifying',
]);

/** The two phases with the enemy at, or through, the gate. */
const SIEGE_PHASES: ReadonlySet<VillageQuestPhase> = new Set(['imminent', 'assault']);
const VICTORY_PHASES: ReadonlySet<VillageQuestPhase> = new Set(['victory', 'complete']);

/** The soldiers who call out a breach instead of the general alarm. */
const BREACH_CALLERS: ReadonlySet<VillagerId> = new Set(['marta', 'hobb']);

/** What a soldier is doing, as the resolver reads it: the standing orders, or at their post. */
export type SoldierStance = SoldierOrder | 'post';

/** The shops refuse trade while the enemy is at the gate. */
export function isShopClosed(phase: VillageQuestPhase): boolean {
  return SIEGE_PHASES.has(phase);
}

/** The party as a villager sees it. Each crawler's craft level is its own; none is ever shared. */
export interface VillagerPartyState {
  readonly hpFractions: { readonly human: number; readonly cat: number };
  readonly stone: number;
  readonly axeTier: ToolTier | null;
  readonly pickaxeTier: ToolTier | null;
  /** 0 while the skill is unlearned. */
  readonly constructionLevels: { readonly human: number; readonly cat: number };
  readonly constructionLearned: boolean;
}

/** Recent events, stamped on the village clock and already filtered to what this villager could have seen. */
export interface VillagerRecentEvents {
  /** A cow was petted within earshot of this villager. */
  readonly lastCowPetNearbyAt: number | null;
  /** A rock deposit crumbled within {@link DEPOSIT_NOTICE_RADIUS_TILES} of this villager. */
  readonly lastDepositDepletedNearAt: number | null;
  /** At least one palisade segment has ever been raised to a wooden wall or better. */
  readonly firstWoodenWallBuilt: boolean;
  /** Party stone at this villager's previous conversation, or null if there was none. */
  readonly stoneAtLastTalk: number | null;
  readonly lastStoneUpgradeHintAt: number | null;
}

export interface VillagerContext {
  /** Now, on the village clock the event stamps use. */
  readonly nowSeconds: number;
  /** The quest's phase and sub-objective flags. */
  readonly quest: Readonly<VillageQuestState>;
  readonly talkCount: number;
  readonly onceFlags: readonly string[];
  readonly party: VillagerPartyState;
  readonly events: VillagerRecentEvents;
  /** A palisade segment is currently a breach. */
  readonly breachExists: boolean;
  /** A segment currently stands at the wooden tier — one that stone could reinforce. */
  readonly woodenWallStanding: boolean;
  /** The lowest count in the merchant's stock, or null while he has none recorded. */
  readonly lowestStock: number | null;
  /** This villager's standing orders when they are a soldier; null for civilians. */
  readonly soldierStance: SoldierStance | null;
}

/** Which rung of the ladder an opening came from. The gate asserts every rung is reachable. */
export type OpeningRule =
  | 'siege'
  | 'one_shot'
  | 'quest'
  | 'victory'
  | 'recent'
  | 'first_meeting'
  | 'orders_need_mayor'
  | 'soldier_stance'
  | 'quest_active'
  | 'fallback';

/** At least one page: an opening is always something to say. */
export type OpeningPages = readonly [Circumstance, ...Circumstance[]];

export interface OpeningLine {
  readonly pages: OpeningPages;
  readonly rule: OpeningRule;
  /** The one-shot flag this opening spends, written once it has been shown. */
  readonly onceFlag?: string;
  /** What the questline does as this opening is shown; see {@link QuestOpening.onShown}. */
  readonly onShown?: (ctl: ConversationController) => void;
}

/**
 * The questline's say in who opens with what. Consulted after the siege lines
 * and the one-shots, before everything else; returning null leaves the
 * villager to the rest of the ladder.
 */
export interface QuestLineProvider {
  lineFor(villager: VillagerId, ctx: VillagerContext): QuestOpening | null;
  /** The glyph over a villager's head: what the questline has for the party there. Absent means none. */
  markerFor?(villager: VillagerId, ctx: VillagerContext): NPCMarkerType;
}

export interface QuestOpening {
  readonly pages: OpeningPages;
  /** Set when the opening must only ever be spoken once; recorded as it is shown. */
  readonly onceFlag?: string;
  /**
   * Runs once the conversation has opened on these pages: where the questline
   * does what the lines announce — teaches the skill, hands over the reward,
   * moves the phase on. Never run by the resolver, which only ever picks.
   */
  readonly onShown?: (ctl: ConversationController) => void;
}

/** The flag a one-shot line is recorded under once spoken. */
export function onceFlagFor(villager: VillagerId, circumstance: Circumstance): string {
  return `${villager}:${circumstance}`;
}

function has(villager: VillagerId, circumstance: Circumstance): boolean {
  return line(villager, circumstance) !== undefined;
}

function single(circumstance: Circumstance, rule: OpeningRule): OpeningLine {
  return { pages: [circumstance], rule };
}

function secondsSince(ctx: VillagerContext, at: number | null): number | null {
  return at === null ? null : ctx.nowSeconds - at;
}

function isRecent(ctx: VillagerContext, at: number | null): boolean {
  const elapsed = secondsSince(ctx, at);
  return elapsed !== null && elapsed <= RECENT_EVENT_SECONDS;
}

function siegeLine(villager: VillagerId, ctx: VillagerContext): Circumstance | null {
  const phase = ctx.quest.phase;
  if (!SIEGE_PHASES.has(phase)) return null;
  if (phase === 'assault') {
    if (has(villager, 'attack_started')) return 'attack_started';
    if (ctx.breachExists && BREACH_CALLERS.has(villager) && has(villager, 'enemy_breach')) {
      return 'enemy_breach';
    }
  }
  return has(villager, 'attack_imminent') ? 'attack_imminent' : null;
}

/** Whether anyone in the party has reached `level` in Construction — a milestone, not a perk. */
function someoneReachedConstruction(party: VillagerPartyState, level: number): boolean {
  return party.constructionLevels.human >= level || party.constructionLevels.cat >= level;
}

function pendingOneShot(villager: VillagerId, ctx: VillagerContext): Circumstance | null {
  const unspent = (circumstance: Circumstance): boolean =>
    !ctx.onceFlags.includes(onceFlagFor(villager, circumstance));
  if (villager === 'wicker' && ctx.events.firstWoodenWallBuilt && unspent('wooden_wall_built')) {
    return 'wooden_wall_built';
  }
  if (villager === 'tikka') {
    for (const milestone of TIKKA_CONSTRUCTION_MILESTONES) {
      if (
        someoneReachedConstruction(ctx.party, milestone.level) &&
        unspent(milestone.circumstance)
      ) {
        return milestone.circumstance;
      }
    }
  }
  return null;
}

function recentEventLine(villager: VillagerId, ctx: VillagerContext): Circumstance | null {
  const { events, party } = ctx;
  if (villager === 'merrit') {
    return isRecent(ctx, events.lastCowPetNearbyAt) ? 'cow_petted_nearby' : null;
  }
  if (villager === 'garn') {
    if (isRecent(ctx, events.lastDepositDepletedNearAt)) return 'deposit_depleted';
    const lastStone = events.stoneAtLastTalk;
    const deliveredMore = lastStone !== null && party.stone > lastStone;
    return party.stone >= STONE_DELIVERED_MIN && deliveredMore ? 'stone_delivered' : null;
  }
  if (villager === 'wicker') {
    const sinceHint = secondsSince(ctx, events.lastStoneUpgradeHintAt);
    const hintCooledDown = sinceHint === null || sinceHint >= STONE_UPGRADE_HINT_COOLDOWN_SECONDS;
    const canUpgrade = ctx.woodenWallStanding && party.stone >= STONE_UPGRADE_HINT_MIN_STONE;
    return canUpgrade && hintCooledDown ? 'stone_upgrade_available' : null;
  }
  if (villager === 'vetch') {
    const running = ctx.lowestStock !== null && ctx.lowestStock <= LOW_SUPPLIES_THRESHOLD;
    return running ? 'low_supplies' : null;
  }
  return null;
}

/** A soldier's line for their standing orders, falling back to the order's own command line. */
function soldierStanceLine(villager: VillagerId, stance: SoldierStance): Circumstance | null {
  const candidates: Readonly<Record<SoldierStance, readonly Circumstance[]>> = {
    post: [],
    follow: ['follow_active', 'command_follow'],
    hold: ['stay_active', 'command_stay'],
    patrol: ['patrol_active', 'command_patrol'],
  };
  return candidates[stance].find((circumstance) => has(villager, circumstance)) ?? null;
}

/**
 * The lines a villager says with no particular reason: their greeting and
 * their answers to the questions anyone might ask.
 */
export function fallbackPool(villager: VillagerId): readonly Circumstance[] {
  return villagerEntry(villager)
    .dialogueOptions.map((option) => option.circumstance)
    .filter((circumstance) => circumstance === 'first_meeting' || circumstance.startsWith('ask_'));
}

/**
 * Picks this conversation's opening. The first rule that applies *and* has a
 * line for this villager wins:
 *
 * 1. the siege — the alarm, or the breach for the two who watch the wall;
 * 2. a one-shot the party has earned and not yet heard;
 * 3. the questline's own line, when it has one for this villager;
 * 4. relief after the victory;
 * 5. something that just happened nearby;
 * 6. a first meeting;
 * 7. a soldier's refusal to take orders before the Mayor's request is accepted;
 * 8. a soldier's standing orders;
 * 9. the village at work, while the quest is under way;
 * 10. otherwise, a rotation through their greeting and their answers, so two
 *     talks in a row never open the same way.
 */
export function openingLine(
  villager: VillagerId,
  ctx: VillagerContext,
  questLines: QuestLineProvider | null = null,
): OpeningLine {
  const siege = siegeLine(villager, ctx);
  if (siege !== null) return single(siege, 'siege');

  const oneShot = pendingOneShot(villager, ctx);
  if (oneShot !== null) {
    return { pages: [oneShot], rule: 'one_shot', onceFlag: onceFlagFor(villager, oneShot) };
  }

  const quest = questLines?.lineFor(villager, ctx) ?? null;
  if (quest !== null) {
    return {
      pages: quest.pages,
      rule: 'quest',
      ...(quest.onceFlag === undefined ? {} : { onceFlag: quest.onceFlag }),
      ...(quest.onShown === undefined ? {} : { onShown: quest.onShown }),
    };
  }

  if (VICTORY_PHASES.has(ctx.quest.phase) && has(villager, 'after_victory')) {
    return single('after_victory', 'victory');
  }

  const recent = recentEventLine(villager, ctx);
  if (recent !== null) return single(recent, 'recent');

  if (ctx.talkCount === 0 && has(villager, 'first_meeting')) {
    return single('first_meeting', 'first_meeting');
  }

  if (ctx.soldierStance !== null) {
    if (!hasAcceptedMayorRequest(ctx.quest.phase) && has(villager, 'orders_need_mayor')) {
      return single('orders_need_mayor', 'orders_need_mayor');
    }
    const stance = soldierStanceLine(villager, ctx.soldierStance);
    if (stance !== null) return single(stance, 'soldier_stance');
  }

  if (QUEST_ACTIVE_PHASES.has(ctx.quest.phase) && has(villager, 'quest_active')) {
    return single('quest_active', 'quest_active');
  }

  const pool = fallbackPool(villager);
  if (pool.length === 0) return single('first_meeting', 'fallback');
  return single(pool[ctx.talkCount % pool.length], 'fallback');
}
