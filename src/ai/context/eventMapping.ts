import { crawlerName } from '../../characters/characters';
import type { EventBus } from '../../core/EventBus';
import type { ChallengeSummary } from '../show/challenges';
import { ITEM_DEF, type ItemId } from '../../core/items/defs/ItemDefs';
import type { Mob } from '../../creatures/Mob';
import type { DamageSource } from '../../Player';
import { MORDECAI_CHARACTER_NAME } from '../characters';
import { EVENT_IMPORTANCE, IMPORTANCE } from './eventImportance';
import type { EventDraft, GameEventStream } from './gameEventStream';
import type { JsonObject } from './json';
import { liveCrawlerNamed } from './liveState';
import type { PlayerProfileTracker } from './playerProfile';
import type { AIContextSource, CrawlerName } from './types';

/** `playerIdle` fires every few seconds of idling; only these marks are worth telling the AI about. */
const IDLE_FIRST_MARK_MS = 30_000;
const IDLE_SECOND_MARK_MS = 120_000;
const IDLE_THIRD_MARK_MS = 300_000;
const IDLE_REPORT_MARKS_MS = [IDLE_FIRST_MARK_MS, IDLE_SECOND_MARK_MS, IDLE_THIRD_MARK_MS];
/** `playerIdle` fires once per this many idle milliseconds. */
const IDLE_EVENT_STEP_MS = 5_000;
const MS_PER_SECOND = 1000;

/** What the event mapping needs from the builder that owns it. */
export interface EventMappingHost {
  readonly source: AIContextSource;
  readonly stream: GameEventStream;
  readonly profile: PlayerProfileTracker;
  now(): number;
  /** A crawler dropped to low HP; the host decides later whether they sat on their potions. */
  watchForStockpiling(crawler: CrawlerName): void;
  potionDrunk(crawler: CrawlerName): void;
}

function sideName(side: 'Human' | 'Cat'): CrawlerName {
  return crawlerName(side === 'Human' ? 'human' : 'cat');
}

function kindName(kind: 'human' | 'cat'): CrawlerName {
  return crawlerName(kind);
}

/** `trash_gremlin` → `the trashGremlin`. */
function humanize(id: string): string {
  return id.replace(/_/g, ' ');
}

/** What every challenge event carries about the challenge. */
function challengeData(e: ChallengeSummary): JsonObject {
  return {
    challengeId: e.challengeId,
    title: e.title,
    template: e.template,
    objective: e.objective,
    rewardRarity: e.rewardRarity,
  };
}

const UNNAMED_MOB = 'Unknown';

export function mobLabel(mob: Mob): string {
  if (mob.displayName !== UNNAMED_MOB) return mob.displayName;
  if (mob.spawnTypeKey !== null) return humanize(mob.spawnTypeKey);
  return mob.constructor.name;
}

/** A short phrase naming what dealt a blow, for knockouts and deaths. */
export function describeDamageSource(source: DamageSource | null): string {
  if (source === null) return 'unknown causes';
  switch (source.kind) {
    case 'mob':
      return source.attackType === undefined
        ? `a ${source.mobType}`
        : `a ${source.mobType} (${source.attackType})`;
    case 'status':
      return humanize(source.effectType);
    case 'dynamite':
      return 'their own explosive';
    case 'environmental':
      return source.hazard === undefined ? 'the environment' : humanize(source.hazard);
    case 'doomsday':
      return 'the doomsday device';
    case 'siege':
      return 'their own siege engine';
  }
}

function itemName(id: ItemId | null): string | null {
  return id === null ? null : ITEM_DEF[id].name;
}

/**
 * Subscribes the AI event mapping to a scene's bus. Each handler turns a game
 * event into an `EventDraft` (a summary written for the AI, a 0..1 importance
 * and who besides the omniscient System perceived it) or into a rollup or
 * profile update. Returns the unsubscribe functions.
 */
export function subscribeGameEvents(bus: EventBus, host: EventMappingHost): Array<() => void> {
  const { source, stream, profile } = host;
  const emit = (draft: EventDraft): void => {
    const sawIt =
      draft.subject === undefined
        ? source.isPartyInSafeRoom()
        : source.isCrawlerInSafeRoom(draft.subject);
    stream.record(draft, host.now(), sawIt);
  };
  const nameOf = source.crawlerNameOf.bind(source);
  const progress = (): void => profile.recordProgress(host.now());

  return [
    // ── Combat ──────────────────────────────────────────────────────────────
    bus.on('combatStarted', (e) => {
      emit({
        type: 'combatStarted',
        data: { attacker: sideName(e.attacker), mob: e.mobType },
        summary: `${sideName(e.attacker)} started a fight with a ${e.mobType}.`,
        importance: EVENT_IMPORTANCE.combatStarted,
        witness: 'inSafeRoom',
        subject: sideName(e.attacker),
      });
    }),
    bus.on('mobKilled', (e) => {
      if (e.mob.isBoss) return;
      const killer = e.killer === null ? null : nameOf(e.killer);
      if (killer !== null) profile.recordKills(1);
      stream.recordKill(mobLabel(e.mob), killer, host.now(), source.isPartyInSafeRoom());
    }),
    bus.on('multiKill', (e) => {
      emit({
        type: 'multiKill',
        data: { count: e.count },
        summary: `${crawlerName('human')} killed ${e.count} enemies with a single blow.`,
        importance: EVENT_IMPORTANCE.multiKill,
        witness: 'inSafeRoom',
        subject: crawlerName('human'),
      });
    }),
    bus.on('dynamiteUsed', (e) => {
      emit({
        type: 'dynamiteUsed',
        data: { crawler: sideName(e.player) },
        summary:
          e.item === 'black_powder_bomb'
            ? `${sideName(e.player)} lobbed a black powder bomb.`
            : `${sideName(e.player)} lit a stick of goblin dynamite.`,
        importance: EVENT_IMPORTANCE.dynamiteUsed,
        witness: 'inSafeRoom',
        subject: sideName(e.player),
      });
    }),
    bus.on('dynamiteKills', (e) => {
      emit({
        type: 'dynamiteKills',
        data: { kills: e.kills, bossKilled: e.bossKilled },
        summary: e.bossKilled
          ? `${crawlerName('human')} blew up a boss with an explosive (${e.kills} dead in the blast).`
          : `${crawlerName('human')}'s explosive killed ${e.kills} enemies at once.`,
        importance: e.bossKilled ? IMPORTANCE.LANDMARK : EVENT_IMPORTANCE.dynamiteKills,
        witness: 'inSafeRoom',
        subject: crawlerName('human'),
      });
    }),
    bus.on('bossFightInitiated', (e) => {
      emit({
        type: 'bossFightInitiated',
        data: { boss: humanize(e.bossType) },
        summary: `The crawlers sealed themselves in with ${humanize(e.bossType)}. Boss fight!`,
        importance: EVENT_IMPORTANCE.bossFightInitiated,
        witness: 'never',
      });
    }),
    bus.on('bossDefeated', (e) => {
      progress();
      emit({
        type: 'bossDefeated',
        data: { boss: humanize(e.bossType) },
        summary: `The crawlers killed the boss ${humanize(e.bossType)}.`,
        importance: EVENT_IMPORTANCE.bossDefeated,
        witness: 'always',
      });
    }),
    bus.on('healthLow', (e) => {
      const crawler = sideName(e.player);
      host.watchForStockpiling(crawler);
      emit({
        type: 'healthLow',
        data: { crawler, hp: Math.ceil(e.hp), maxHp: e.maxHp },
        summary: `${crawler} is badly hurt (${Math.ceil(e.hp)}/${e.maxHp} HP).`,
        importance: EVENT_IMPORTANCE.healthLow,
        witness: 'inSafeRoom',
        subject: crawler,
      });
    }),
    bus.on('healingPotionUsed', (e) => {
      const crawler = sideName(e.player);
      host.potionDrunk(crawler);
      const live = source.readLive();
      const state = liveCrawlerNamed(live, crawler);
      const hpBefore = Math.max(0, state.hp - e.hpRestored);
      profile.recordPotion(state.maxHp > 0 ? hpBefore / state.maxHp : 0);
      emit({
        type: 'healingPotionUsed',
        data: { crawler, hpRestored: Math.round(e.hpRestored), hpBefore: Math.round(hpBefore) },
        summary: `${crawler} drank a healing potion at ${Math.round(hpBefore)}/${state.maxHp} HP.`,
        importance: EVENT_IMPORTANCE.healingPotionUsed,
        witness: 'inSafeRoom',
        subject: crawler,
      });
    }),
    bus.on('crawlerKnockedOut', (e) => {
      const crawler = nameOf(e.player);
      if (crawler === null) return;
      profile.recordKnockout(crawler);
      const cause = describeDamageSource(e.player.lastDamageSource);
      emit({
        type: 'crawlerKnockedOut',
        data: { crawler, cause },
        summary: `${crawler} was knocked out by ${cause} and is bleeding out.`,
        importance: EVENT_IMPORTANCE.crawlerKnockedOut,
        witness: 'inSafeRoom',
        subject: crawler,
      });
    }),
    bus.on('crawlerRevived', (e) => {
      const crawler = nameOf(e.player);
      if (crawler === null) return;
      emit({
        type: 'crawlerRevived',
        data: { crawler },
        summary: `${crawler} was revived.`,
        importance: EVENT_IMPORTANCE.crawlerRevived,
        witness: 'inSafeRoom',
        subject: crawler,
      });
    }),
    bus.on('playerDodged', (e) => {
      stream.recordDodge(sideName(e.player), host.now());
    }),
    bus.on('roomCleared', (e) => {
      emit({
        type: 'roomCleared',
        data: { roomIndex: e.roomIndex },
        summary: 'The crawlers cleared every hostile out of a room.',
        importance: EVENT_IMPORTANCE.roomCleared,
        witness: 'never',
      });
    }),
    bus.on('skillTriggered', (e) => {
      emit({
        type: 'skillTriggered',
        data: { crawler: sideName(e.player), skill: humanize(e.skillId) },
        summary: `${sideName(e.player)}'s ${humanize(e.skillId)} skill kicked in.`,
        importance: EVENT_IMPORTANCE.skillTriggered,
        witness: 'inSafeRoom',
        subject: sideName(e.player),
      });
    }),
    bus.on('statusApplied', (e) => {
      const crawler = nameOf(e.player);
      if (crawler === null) return;
      emit({
        type: 'statusApplied',
        data: { crawler, status: e.status },
        summary: `${crawler} is now afflicted with ${humanize(e.status)}.`,
        importance: EVENT_IMPORTANCE.statusApplied,
        witness: 'inSafeRoom',
        subject: crawler,
      });
    }),
    bus.on('statusCured', (e) => {
      const crawler = nameOf(e.player);
      if (crawler === null) return;
      emit({
        type: 'statusCured',
        data: { crawler, status: e.status },
        summary: `${crawler} is no longer ${humanize(e.status)}.`,
        importance: EVENT_IMPORTANCE.statusCured,
        witness: 'inSafeRoom',
        subject: crawler,
      });
    }),
    bus.on('playerDied', (e) => {
      const crawler = e.fallen === null ? null : nameOf(e.fallen);
      const killedBy =
        e.fallen === null
          ? 'the floor collapsing'
          : describeDamageSource(e.fallen.lastDamageSource);
      const data: JsonObject = { cause: e.cause, killedBy };
      if (crawler !== null) data.crawler = crawler;
      emit({
        type: 'playerDied',
        data,
        summary:
          crawler === null
            ? `The run ended: ${killedBy}.`
            : `${crawler} died, killed by ${killedBy}. The party respawns at the last save.`,
        importance: EVENT_IMPORTANCE.playerDied,
        witness: 'always',
      });
    }),

    // ── Progress ────────────────────────────────────────────────────────────
    bus.on('playerLevelUp', (e) => {
      const crawler = nameOf(e.player);
      if (crawler === null) return;
      emit({
        type: 'playerLevelUp',
        data: { crawler, level: e.newLevel },
        summary: `${crawler} reached level ${e.newLevel}.`,
        importance: EVENT_IMPORTANCE.playerLevelUp,
        witness: 'inSafeRoom',
        subject: crawler,
      });
    }),
    bus.on('skillUnlocked', (e) => {
      emit({
        type: 'skillUnlocked',
        data: { crawler: sideName(e.player), skill: humanize(e.skillId) },
        summary: `${sideName(e.player)} learned the ${humanize(e.skillId)} skill.`,
        importance: EVENT_IMPORTANCE.skillUnlocked,
        witness: 'inSafeRoom',
        subject: sideName(e.player),
      });
    }),
    bus.on('skillLevelUp', (e) => {
      emit({
        type: 'skillLevelUp',
        data: { crawler: sideName(e.player), skill: humanize(e.skillId), level: e.newLevel },
        summary: `${sideName(e.player)}'s ${humanize(e.skillId)} rose to level ${e.newLevel}.`,
        importance: EVENT_IMPORTANCE.skillLevelUp,
        witness: 'inSafeRoom',
        subject: sideName(e.player),
      });
    }),
    bus.on('craftSkillLearned', (e) => {
      emit({
        type: 'craftSkillLearned',
        data: { crawler: kindName(e.crawler), skill: e.id },
        summary: `${kindName(e.crawler)} learned the ${e.id} craft.`,
        importance: EVENT_IMPORTANCE.craftSkillLearned,
        witness: 'inSafeRoom',
        subject: kindName(e.crawler),
      });
    }),
    bus.on('craftSkillLevelUp', (e) => {
      emit({
        type: 'craftSkillLevelUp',
        data: { crawler: kindName(e.crawler), skill: e.id, level: e.level },
        summary: `${kindName(e.crawler)}'s ${e.id} craft rose to level ${e.level}.`,
        importance: EVENT_IMPORTANCE.craftSkillLevelUp,
        witness: 'inSafeRoom',
        subject: kindName(e.crawler),
      });
    }),
    bus.on('achievementUnlocked', (e) => {
      emit({
        type: 'achievementUnlocked',
        data: { crawler: sideName(e.player), achievement: humanize(e.achievementId) },
        summary: `${sideName(e.player)} earned the achievement "${humanize(e.achievementId)}".`,
        importance: EVENT_IMPORTANCE.achievementUnlocked,
        witness: 'always',
      });
    }),
    bus.on('rewardGranted', (e) => {
      const names = e.rewards.map((reward) => reward.name);
      emit({
        type: 'rewardGranted',
        data: { rewards: names },
        summary: `The crawlers unlocked: ${names.join(', ')}.`,
        importance: EVENT_IMPORTANCE.rewardGranted,
        witness: 'inSafeRoom',
      });
    }),
    bus.on('rewardChestOpened', (e) => {
      profile.recordChestOpened();
      const crawler = nameOf(e.owner) ?? 'A crawler';
      const contents = [
        e.coins > 0 ? `${e.coins} coins` : null,
        e.potions > 0 ? `${e.potions} potions` : null,
        ...e.items,
      ].filter((part): part is string => part !== null);
      emit({
        type: 'rewardChestOpened',
        data: { crawler, rarity: e.rarity, contents },
        summary: `${crawler} earned a ${e.rarity} chest: ${contents.join(', ') || 'nothing'}.`,
        importance: EVENT_IMPORTANCE.rewardChestOpened,
        witness: 'always',
        subject: nameOf(e.owner) ?? undefined,
      });
    }),
    bus.on('equipmentChanged', (e) => {
      if (e.reason === 'restore') return;
      const crawler = kindName(e.crawler);
      const added = itemName(e.itemId);
      const removed = itemName(e.removedItemId);
      const data: JsonObject = { crawler, reason: e.reason };
      if (added !== null) data.equipped = added;
      if (removed !== null) data.removed = removed;
      emit({
        type: 'equipmentChanged',
        data,
        summary:
          added !== null
            ? `${crawler} equipped ${added}${removed !== null ? ` in place of ${removed}` : ''}.`
            : `${crawler} took off ${removed ?? 'something'}.`,
        importance: EVENT_IMPORTANCE.equipmentChanged,
        witness: 'inSafeRoom',
        subject: crawler,
      });
    }),
    bus.on('stairwellFound', () => {
      progress();
      emit({
        type: 'stairwellFound',
        data: {},
        summary: 'The crawlers found the stairwell down to the next floor.',
        importance: EVENT_IMPORTANCE.stairwellFound,
        witness: 'never',
      });
    }),
    bus.on('levelComplete', () => {
      progress();
      emit({
        type: 'levelComplete',
        data: {},
        summary: 'The crawlers took the stairwell down. This floor is behind them.',
        importance: EVENT_IMPORTANCE.levelComplete,
        witness: 'always',
      });
    }),
    bus.on('safeRoomEntered', () => {
      emit({
        type: 'safeRoomEntered',
        data: {},
        summary: 'The crawlers walked into a safe room.',
        importance: EVENT_IMPORTANCE.safeRoomEntered,
        witness: 'always',
      });
    }),
    bus.on('gameSaved', () => {
      emit({
        type: 'gameSaved',
        data: {},
        summary: 'Progress was saved.',
        importance: EVENT_IMPORTANCE.gameSaved,
        witness: 'never',
      });
    }),
    bus.on('fastTravelUsed', (e) => {
      emit({
        type: 'fastTravelUsed',
        data: { destination: humanize(e.destination) },
        summary: `The crawlers warped to ${humanize(e.destination)} with the Wayfinder's Anchor.`,
        importance: EVENT_IMPORTANCE.fastTravelUsed,
        witness: 'never',
      });
    }),
    bus.on('toolUpgraded', (e) => {
      emit({
        type: 'toolUpgraded',
        data: { tool: e.kind, tier: e.tier },
        summary: `The party's ${e.kind} was upgraded to tier ${e.tier}.`,
        importance: EVENT_IMPORTANCE.toolUpgraded,
        witness: 'never',
      });
    }),

    // ── Quests ──────────────────────────────────────────────────────────────
    bus.on('questStarted', (e) => {
      progress();
      emit({
        type: 'questStarted',
        data: { quest: e.questId },
        summary: `Quest accepted: ${humanize(e.questId)}.`,
        importance: EVENT_IMPORTANCE.questStarted,
        witness: 'inSafeRoom',
      });
    }),
    bus.on('objectiveComplete', (e) => {
      progress();
      emit({
        type: 'objectiveComplete',
        data: { objective: e.objectiveId },
        summary: `Objective complete: ${humanize(e.objectiveId)}.`,
        importance: EVENT_IMPORTANCE.objectiveComplete,
        witness: 'inSafeRoom',
      });
    }),
    bus.on('questCompleted', (e) => {
      progress();
      const data: JsonObject = { quest: e.questId };
      if (e.difficulty !== undefined) data.difficulty = e.difficulty;
      emit({
        type: 'questCompleted',
        data,
        summary: `Quest completed: ${humanize(e.questId)}.`,
        importance: EVENT_IMPORTANCE.questCompleted,
        witness: 'always',
      });
    }),
    bus.on('questFailed', (e) => {
      emit({
        type: 'questFailed',
        data: { quest: e.questId },
        summary: `Quest failed: ${humanize(e.questId)}.`,
        importance: EVENT_IMPORTANCE.questFailed,
        witness: 'inSafeRoom',
      });
    }),
    bus.on('questAbandoned', (e) => {
      emit({
        type: 'questAbandoned',
        data: { quest: e.questId },
        summary: `The crawlers gave up on ${humanize(e.questId)}.`,
        importance: EVENT_IMPORTANCE.questAbandoned,
        witness: 'inSafeRoom',
      });
    }),
    bus.on('villageQuestPhaseChanged', (e) => {
      emit({
        type: 'villageQuestPhaseChanged',
        data: { quest: "Briar Hollow's Plea", phase: e.phase },
        summary: `Briar Hollow's Plea moved on: ${humanize(e.phase)}.`,
        importance: EVENT_IMPORTANCE.villageQuestPhaseChanged,
        witness: 'never',
      });
    }),
    bus.on('blueprintsQuestPhaseChanged', (e) => {
      emit({
        type: 'blueprintsQuestPhaseChanged',
        data: { quest: 'The Borrowed Blueprints', phase: e.phase },
        summary: `The Borrowed Blueprints moved on: ${humanize(e.phase)}.`,
        importance: EVENT_IMPORTANCE.blueprintsQuestPhaseChanged,
        witness: 'never',
      });
    }),
    bus.on('villageAssaultWave', (e) => {
      emit({
        type: 'villageAssaultWave',
        data: { wave: e.index + 1 },
        summary: `Wave ${e.index + 1} of the assault on Briar Hollow has begun.`,
        importance: EVENT_IMPORTANCE.villageAssaultWave,
        witness: 'never',
      });
    }),
    bus.on('structureDestroyed', (e) => {
      emit({
        type: 'structureDestroyed',
        data: { structure: e.kind, permanent: e.permanent },
        summary: `A Briar Hollow ${e.kind} was destroyed${e.permanent ? ' for good' : ''}.`,
        importance: EVENT_IMPORTANCE.structureDestroyed,
        witness: 'never',
      });
    }),

    // ── Social and economy ──────────────────────────────────────────────────
    bus.on('conversation', (e) => {
      const withMordecai = e.speaker === MORDECAI_CHARACTER_NAME;
      emit({
        type: e.phase === 'started' ? 'conversationStarted' : 'conversationEnded',
        data: { speaker: e.speaker },
        summary:
          e.phase === 'started'
            ? `The crawlers started talking to ${e.speaker}.`
            : `The crawlers finished talking to ${e.speaker}.`,
        importance: withMordecai ? IMPORTANCE.NOTABLE : EVENT_IMPORTANCE.conversationStarted,
        witness: withMordecai ? 'always' : 'inSafeRoom',
      });
    }),
    bus.on('mordecaiAdviceGiven', (e) => {
      profile.recordAdvice(host.now());
      emit({
        type: 'mordecaiAdviceGiven',
        data: { objective: humanize(e.objectiveId) },
        summary: `Mordecai pointed the crawlers toward ${humanize(e.objectiveId)}.`,
        importance: EVENT_IMPORTANCE.mordecaiAdviceGiven,
        witness: 'always',
      });
    }),
    bus.on('bopcaGreeted', (e) => {
      const crawler = kindName(e.tone === 'toHuman' ? 'human' : 'cat');
      emit({
        type: 'bopcaGreeted',
        data: { crawler },
        summary: `The safe room's Bopca greeted ${crawler}.`,
        importance: EVENT_IMPORTANCE.bopcaGreeted,
        witness: 'inSafeRoom',
      });
    }),
    bus.on('bopcaFoodEaten', (e) => {
      emit({
        type: 'bopcaFoodEaten',
        data: { dish: humanize(e.dishId), healed: Math.round(e.healed) },
        summary: `A crawler ate a Bopca's ${humanize(e.dishId)}.`,
        importance: EVENT_IMPORTANCE.bopcaFoodEaten,
        witness: 'inSafeRoom',
      });
    }),
    bus.on('shopPurchase', (e) => {
      profile.recordPurchase();
      const crawler = nameOf(e.buyer) ?? 'A crawler';
      emit({
        type: 'shopPurchase',
        data: { crawler, item: e.item, coins: e.coins, shop: e.shop },
        summary: `${crawler} bought ${e.item} for ${e.coins} coins${e.shop ? ` at ${e.shop}` : ''}.`,
        importance: EVENT_IMPORTANCE.shopPurchase,
        witness: 'inSafeRoom',
        subject: nameOf(e.buyer) ?? undefined,
      });
    }),
    bus.on('shopSold', (e) => {
      const crawler = nameOf(e.seller) ?? 'A crawler';
      emit({
        type: 'shopSold',
        data: { crawler, item: e.item, quantity: e.quantity, coins: e.coins, shop: e.shop },
        summary: `${crawler} sold ${e.quantity} × ${e.item} for ${e.coins} coins.`,
        importance: EVENT_IMPORTANCE.shopSold,
        witness: 'inSafeRoom',
        subject: nameOf(e.seller) ?? undefined,
      });
    }),
    bus.on('cowPetted', () => {
      emit({
        type: 'cowPetted',
        data: {},
        summary: 'A crawler stopped to pet a cow.',
        importance: EVENT_IMPORTANCE.cowPetted,
        witness: 'never',
      });
    }),
    bus.on('cowKilled', () => {
      emit({
        type: 'cowKilled',
        data: {},
        summary: 'A village cow died.',
        importance: EVENT_IMPORTANCE.cowKilled,
        witness: 'never',
      });
    }),
    // ── The show: challenges, questions, the crowd ──────────────────────────
    bus.on('challengeAccepted', (e) => {
      emit({
        type: 'challengeAccepted',
        data: { ...challengeData(e) },
        summary: `The crawlers accepted the challenge "${e.title}": ${e.objective}.`,
        importance: EVENT_IMPORTANCE.challengeAccepted,
        witness: 'always',
      });
    }),
    bus.on('challengeDeclined', (e) => {
      emit({
        type: 'challengeDeclined',
        data: { ...challengeData(e) },
        summary: `The crawlers turned down the challenge "${e.title}".`,
        importance: EVENT_IMPORTANCE.challengeDeclined,
        witness: 'always',
      });
    }),
    bus.on('challengeCompleted', (e) => {
      const winner = sideName(e.rewardedTo);
      emit({
        type: 'challengeCompleted',
        data: { ...challengeData(e), rewardedTo: winner, secondsTaken: e.secondsTaken },
        summary: `The crawlers won the challenge "${e.title}" in ${e.secondsTaken}s; ${winner} got the ${e.rewardRarity} chest.`,
        importance: EVENT_IMPORTANCE.challengeCompleted,
        witness: 'always',
      });
    }),
    bus.on('challengeFailed', (e) => {
      emit({
        type: 'challengeFailed',
        data: { ...challengeData(e), reason: e.reason },
        summary: `The crawlers failed the challenge "${e.title}": they ${e.reason}.`,
        importance: EVENT_IMPORTANCE.challengeFailed,
        witness: 'always',
      });
    }),
    bus.on('playerAnswered', (e) => {
      emit({
        type: 'playerAnswered',
        data: {
          questionId: e.questionId,
          question: e.question,
          answer: e.answer,
          choices: e.choices,
          askedBy: e.askedBy,
        },
        summary:
          e.answer === null
            ? `Asked "${e.question}", the player refused to answer.`
            : `Asked "${e.question}", the player answered "${e.answer}".`,
        importance: EVENT_IMPORTANCE.playerAnswered,
        witness: 'always',
      });
    }),
    bus.on('viewerFavorChanged', (e) => {
      emit({
        type: 'viewerFavorChanged',
        data: { favor: e.favor, delta: e.delta, reaction: e.reaction, tier: e.tier },
        summary: `The viewers' favour moved ${e.delta >= 0 ? '+' : ''}${e.delta} to ${e.favor}/100 (${e.tier}).`,
        importance: EVENT_IMPORTANCE.viewerFavorChanged,
        witness: 'never',
      });
    }),
    bus.on('aiAchievementAwarded', (e) => {
      const crawler = sideName(e.player);
      emit({
        type: 'aiAchievementAwarded',
        data: { crawler, title: e.title, rarity: e.rarity, awardedBy: e.awardedBy },
        summary: `${crawler} was awarded the achievement "${e.title}" by the ${e.awardedBy}.`,
        importance: EVENT_IMPORTANCE.aiAchievementAwarded,
        witness: 'always',
      });
    }),
    bus.on('sponsorBreakEnded', (e) => {
      emit({
        type: 'sponsorBreakEnded',
        data: { sponsor: e.sponsor, skipped: e.skipped },
        summary: e.skipped
          ? `The player skipped the sponsor break for ${e.sponsor}.`
          : `The player sat through the sponsor break for ${e.sponsor}.`,
        importance: EVENT_IMPORTANCE.sponsorBreakEnded,
        witness: 'never',
      });
    }),
    bus.on('playerIdle', (e) => {
      const previous = e.totalIdleMs - IDLE_EVENT_STEP_MS;
      const mark = IDLE_REPORT_MARKS_MS.find((m) => previous < m && e.totalIdleMs >= m);
      if (mark === undefined) return;
      const seconds = Math.round(e.totalIdleMs / MS_PER_SECOND);
      emit({
        type: 'playerIdle',
        data: { seconds },
        summary: `The crawlers have stood around doing nothing for ${seconds}s.`,
        importance: EVENT_IMPORTANCE.playerIdle,
        witness: 'inSafeRoom',
      });
    }),
  ];
}
