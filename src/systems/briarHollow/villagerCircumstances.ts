/**
 * Which line a Briar Hollow villager opens a conversation with, right now.
 *
 * Pure: the resolver reads a {@link VillagerContext} snapshot and returns the
 * lines to say, never touching the state it was built from. The villager
 * system builds the context, shows the lines and then records what the
 * opening spent (a one-shot flag, Wicker's hint cooldown) — which keeps the
 * whole rule ladder drivable headlessly by the dialogue gate.
 *
 * Every line is a property of a villager's own script under
 * `src/dialog/scripts/briarHollow/`; nothing here types a word of dialogue.
 */

import type { DialogLine, NonEmpty } from '../../dialog/line';
import {
  GARN,
  MERRIT,
  TIKKA,
  VETCH,
  WICKER,
  isSoldierId,
  type SoldierId,
  type VillagerId,
} from '../../dialog/scripts/briarHollow';
import { SOLDIER_SCRIPTS, VILLAGER_SCRIPTS } from '../../dialog/villagerRegistry';
import type { SoldierLines } from '../../dialog/roles';
import type { ToolTier } from '../../core/toolTiers';
import type { SoldierOrder, VillageQuestState } from '../../core/briarHollowState';
import type { VillageQuestPhase } from '../../core/villageQuestPhase';
import type { VillageUnlocks } from '../../core/villageUnlocks';
import type { NPCMarkerType } from '../../creatures/QuestNPC';

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
  readonly flagSlug: string;
  readonly line: DialogLine;
}> = [
  { level: 5, flagSlug: 'spikes_unlocked', line: TIKKA.spikesUnlocked },
  { level: 10, flagSlug: 'level_10_construction', line: TIKKA.level10Construction },
  { level: 15, flagSlug: 'level_15_construction', line: TIKKA.level15Construction },
];

/** Phases in which the village is working toward the siege: everyone's `quest_active`. */
const QUEST_ACTIVE_PHASES: ReadonlySet<VillageQuestPhase> = new Set([
  'need_tools',
  'gather_wood',
  'gather_stone',
  'report_tikka',
  'see_fenna',
  'processing',
  'return_tikka',
  'build_trebuchet',
  'load_trebuchet',
  'build_wall',
  'summoned_by_mayor',
  'fortifying',
]);

/** The two phases with the enemy at, or through, the gate. */
const SIEGE_PHASES: ReadonlySet<VillageQuestPhase> = new Set(['imminent', 'assault']);
const VICTORY_PHASES: ReadonlySet<VillageQuestPhase> = new Set(['victory', 'complete']);

/** The soldiers who call out a breach instead of the general alarm. */
const BREACH_CALLERS: ReadonlySet<SoldierId> = new Set(['marta', 'hobb']);

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
  /** What the questline has opened up so far, for a topic that only makes sense once something is. */
  readonly unlocks: Readonly<VillageUnlocks>;
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

/** The lines an opening shows, in order — always at least one. */
export type OpeningPages = NonEmpty<DialogLine>;

/**
 * What happens once an opening's pages have been read.
 *   'root'  → the villager's own topics come up, freshly rebuilt.
 *             `onEventualClose` runs whenever a later "Goodbye", walk-away or
 *             Escape eventually ends the conversation; `null` when nothing does.
 *   'close' → the conversation ends right there, with no menu after.
 *             `onClosed` runs at that moment.
 * Required on every opening, so a rung that needs a side effect once the
 * conversation is done cannot forget to say when.
 */
export type OpeningAfter =
  | { readonly kind: 'root'; readonly onEventualClose: (() => void) | null }
  | { readonly kind: 'close'; readonly onClosed: () => void };

/** An opening that says its pages and lets the villager's own topics come back up, with nothing to run once the talk eventually ends. */
export const KEEP_TALKING: OpeningAfter = { kind: 'root', onEventualClose: null };

export interface OpeningLine {
  readonly pages: OpeningPages;
  readonly rule: OpeningRule;
  /** The one-shot flag this opening spends, written once it has been shown. */
  readonly onceFlag?: string;
  /** Set when these pages matter for an active quest but offer the player no choice. */
  readonly questRelated?: boolean;
  readonly after: OpeningAfter;
}

/**
 * The questline's say in who opens with what. Consulted after the siege lines
 * and the one-shots, before everything else; returning null leaves the
 * villager to the rest of the ladder. Any effect the questline does the
 * instant this opening is chosen — teaching a skill, handing over an item —
 * is the provider's own statement, run before it returns the opening, not a
 * closure carried on the returned value.
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
  /** These pages belong to the quest being run; the conversation box wears the quest icon. */
  readonly questRelated?: boolean;
  readonly after: OpeningAfter;
}

/** The flag a one-shot line is recorded under once spoken. */
export function onceFlagFor(villager: VillagerId, flagSlug: string): string {
  return `${villager}:${flagSlug}`;
}

function single(line: DialogLine, rule: OpeningRule): OpeningLine {
  return { pages: [line], rule, after: KEEP_TALKING };
}

function secondsSince(ctx: VillagerContext, at: number | null): number | null {
  return at === null ? null : ctx.nowSeconds - at;
}

function isRecent(ctx: VillagerContext, at: number | null): boolean {
  const elapsed = secondsSince(ctx, at);
  return elapsed !== null && elapsed <= RECENT_EVENT_SECONDS;
}

function soldierScriptFor(villager: VillagerId): SoldierLines | null {
  return isSoldierId(villager) ? SOLDIER_SCRIPTS[villager] : null;
}

function siegeLine(villager: VillagerId, ctx: VillagerContext): DialogLine | null {
  const phase = ctx.quest.phase;
  if (!SIEGE_PHASES.has(phase)) return null;
  const script = VILLAGER_SCRIPTS[villager];
  if (phase === 'assault') {
    if (script.attackStarted !== undefined) return script.attackStarted;
    if (
      ctx.breachExists &&
      isSoldierId(villager) &&
      BREACH_CALLERS.has(villager) &&
      script.enemyBreach !== undefined
    ) {
      return script.enemyBreach;
    }
  }
  return script.attackImminent ?? null;
}

/** Whether anyone in the party has reached `level` in Construction — a milestone, not a perk. */
function someoneReachedConstruction(party: VillagerPartyState, level: number): boolean {
  return party.constructionLevels.human >= level || party.constructionLevels.cat >= level;
}

function pendingOneShot(
  villager: VillagerId,
  ctx: VillagerContext,
): { readonly line: DialogLine; readonly onceFlag: string } | null {
  const unspent = (flagSlug: string): boolean =>
    !ctx.onceFlags.includes(onceFlagFor(villager, flagSlug));
  if (villager === 'wicker' && ctx.events.firstWoodenWallBuilt && unspent('wooden_wall_built')) {
    return { line: WICKER.woodenWallBuilt, onceFlag: onceFlagFor(villager, 'wooden_wall_built') };
  }
  if (villager === 'tikka') {
    for (const milestone of TIKKA_CONSTRUCTION_MILESTONES) {
      if (someoneReachedConstruction(ctx.party, milestone.level) && unspent(milestone.flagSlug)) {
        return { line: milestone.line, onceFlag: onceFlagFor(villager, milestone.flagSlug) };
      }
    }
  }
  return null;
}

function recentEventLine(villager: VillagerId, ctx: VillagerContext): DialogLine | null {
  const { events, party } = ctx;
  if (villager === 'merrit') {
    return isRecent(ctx, events.lastCowPetNearbyAt) ? MERRIT.cowPettedNearby : null;
  }
  if (villager === 'garn') {
    if (isRecent(ctx, events.lastDepositDepletedNearAt)) return GARN.depositDepleted;
    const lastStone = events.stoneAtLastTalk;
    const deliveredMore = lastStone !== null && party.stone > lastStone;
    return party.stone >= STONE_DELIVERED_MIN && deliveredMore ? GARN.stoneDelivered : null;
  }
  if (villager === 'wicker') {
    const sinceHint = secondsSince(ctx, events.lastStoneUpgradeHintAt);
    const hintCooledDown = sinceHint === null || sinceHint >= STONE_UPGRADE_HINT_COOLDOWN_SECONDS;
    const canUpgrade = ctx.woodenWallStanding && party.stone >= STONE_UPGRADE_HINT_MIN_STONE;
    return canUpgrade && hintCooledDown ? WICKER.stoneUpgradeAvailable : null;
  }
  if (villager === 'vetch') {
    const running = ctx.lowestStock !== null && ctx.lowestStock <= LOW_SUPPLIES_THRESHOLD;
    return running ? VETCH.lowSupplies : null;
  }
  return null;
}

/** A soldier's line for their standing orders, falling back to the order's own command line. */
function soldierStanceLine(script: SoldierLines, stance: SoldierStance): DialogLine | null {
  switch (stance) {
    case 'post':
      return null;
    case 'follow':
      return script.followActive;
    case 'hold':
      return script.stayActive ?? script.commandStay;
    case 'patrol':
      return script.patrolActive ?? script.commandPatrol;
  }
}

/**
 * The lines a villager says with no particular reason: their greeting and
 * their answers to the questions anyone might ask.
 */
export function fallbackPool(villager: VillagerId): OpeningPages {
  const script = VILLAGER_SCRIPTS[villager];
  return [script.firstMeeting, ...(script.fallbackQuestions ?? [])];
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
    return {
      pages: [oneShot.line],
      rule: 'one_shot',
      onceFlag: oneShot.onceFlag,
      after: KEEP_TALKING,
    };
  }

  const quest = questLines?.lineFor(villager, ctx) ?? null;
  if (quest !== null) {
    return {
      pages: quest.pages,
      rule: 'quest',
      ...(quest.onceFlag === undefined ? {} : { onceFlag: quest.onceFlag }),
      ...(quest.questRelated === undefined ? {} : { questRelated: quest.questRelated }),
      after: quest.after,
    };
  }

  const script = VILLAGER_SCRIPTS[villager];
  if (VICTORY_PHASES.has(ctx.quest.phase) && script.afterVictory !== undefined) {
    return single(script.afterVictory, 'victory');
  }

  const recent = recentEventLine(villager, ctx);
  if (recent !== null) return single(recent, 'recent');

  if (ctx.talkCount === 0) return single(script.firstMeeting, 'first_meeting');

  if (ctx.soldierStance !== null) {
    const soldierScript = soldierScriptFor(villager);
    if (soldierScript !== null) {
      if (!ctx.unlocks.soldierCommands)
        return single(soldierScript.ordersNeedMayor, 'orders_need_mayor');
      const stance = soldierStanceLine(soldierScript, ctx.soldierStance);
      if (stance !== null) return single(stance, 'soldier_stance');
    }
  }

  if (QUEST_ACTIVE_PHASES.has(ctx.quest.phase) && script.questActive !== undefined) {
    return single(script.questActive, 'quest_active');
  }

  const pool = fallbackPool(villager);
  return single(pool[ctx.talkCount % pool.length], 'fallback');
}
