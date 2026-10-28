/**
 * The one place an award is paid. Every achievement unlock, AI award and
 * reward chest goes through here, which rolls the contents at that moment,
 * puts them straight into the owning crawler's bag and purse, queues the
 * presentation the reward screen shows, and tells the bus, so the audio and
 * the AI hear every award the same way. A companion is the one reward not
 * paid here: it joins when its chest is opened (see `deinonychusArrival.ts`).
 */

import {
  ACHIEVEMENT_COUNTER_SCOPE,
  ACHIEVEMENT_DEFS,
  crawlerCanEarn,
  counterKeeper,
  type AchievementManager,
  type AIAchievementGrant,
  type FixedReward,
  type PartyAchievements,
} from '../core/progression/AchievementManager';
import {
  isAchievementId,
  type AchievementCounterId,
  type AchievementId,
  type AIAchievementDef,
} from '../core/progression/achievementSave';
import type { EventBus } from '../core/EventBus';
import type { ItemId } from '../core/items/defs/ItemDefs';
import type { Rarity } from '../core/items/defs/rarity';
import { CRAWLER_KINDS, type CrawlerKind } from '../core/skills/SkillManager';
import { worldRandom } from '../core/world/WorldRandom';
import { CHEST_SOURCE_TITLES, rollRewardChest, type RewardPresentation } from '../loot/rewardChest';
import { type ChestSource, type GrantedLine } from '../core/progression/achievementSave';
import { duplicateCoins, isGearId, type GearId } from '../loot/gearPools';
import { coinBonusFor } from '../gear/gearHooks';
import type { Player } from '../Player';

/** What the payer needs from the scene it serves. */
export interface AchievementAwardsDeps {
  readonly humanAchievements: AchievementManager;
  readonly catAchievements: AchievementManager;
  readonly human: Player;
  readonly cat: Player;
  readonly bus: EventBus;
  /**
   * Whether the party already has `id` anywhere it can still be had: bags,
   * hotbars, equipment, floor loot, unopened chests. The scene answers it, as
   * only the scene knows every place a piece can be waiting.
   */
  readonly owns: (id: GearId) => boolean;
  /** Which crawler the player is steering: the one an "active" fixed reward goes to. */
  readonly activeCrawler: () => CrawlerKind;
  /** Whether the scene is the tutorial, whose achievements pay their tutorial kit instead of a roll. */
  readonly inTutorial?: () => boolean;
  readonly random?: () => number;
}

/** A chest no achievement earned: a gift, a prize, a quest's reward or a repeat boss kill. */
export interface ChestGrant {
  readonly rarity: Rarity;
  readonly source: ChestSource;
  /** Shown under the header; the source's title stands alone when absent. */
  readonly subtitle?: string;
  readonly fixed?: ReadonlyArray<FixedReward>;
}

const POTION_ID = 'health_potion' satisfies ItemId;

/** How the event bus names a crawler. */
export function crawlerLabel(kind: CrawlerKind): 'Human' | 'Cat' {
  return kind === 'human' ? 'Human' : 'Cat';
}

export class AchievementAwards {
  constructor(private readonly deps: AchievementAwardsDeps) {}

  /** The achievement manager that keeps `kind`'s achievements. */
  managerOf(kind: CrawlerKind): AchievementManager {
    return kind === 'human' ? this.deps.humanAchievements : this.deps.catAchievements;
  }

  private get party(): PartyAchievements {
    return { human: this.deps.humanAchievements, cat: this.deps.catAchievements };
  }

  private crawler(kind: CrawlerKind): Player {
    return kind === 'human' ? this.deps.human : this.deps.cat;
  }

  /**
   * Unlocks `id` for `kind` and pays its chest. Returns false when `kind`
   * cannot earn it or already has it, in which case nothing is paid.
   */
  unlock(kind: CrawlerKind, id: AchievementId): boolean {
    const def = ACHIEVEMENT_DEFS[id];
    if (!crawlerCanEarn(def, kind)) return false;
    if (this.managerOf(kind).recordUnlock(id) === null) return false;
    const tutorialReward = this.deps.inTutorial?.() === true ? def.tutorialReward : undefined;
    const rewards =
      tutorialReward === undefined
        ? this.pay(kind, def.reward.rarity, def.reward.fixed ?? [], true)
        : this.pay(kind, def.reward.rarity, tutorialReward, false);
    this.managerOf(kind).queuePresentation({
      origin: { kind: 'award', award: def },
      title: def.name,
      subtitle: def.description,
      crawler: kind,
      rarity: def.reward.rarity,
      rewards,
    });
    this.deps.bus.emit('achievementUnlocked', { achievementId: id, player: crawlerLabel(kind) });
    return true;
  }

  /** Unlocks `id` for every crawler who can earn it. Returns whether either newly did. */
  unlockParty(id: AchievementId): boolean {
    const human = this.unlock('human', id);
    const cat = this.unlock('cat', id);
    return human || cat;
  }

  /**
   * Files the AI's achievement for `kind` and pays its chest. Null when the
   * crawler already holds one by that title or holds the most allowed.
   */
  grantAIAchievement(kind: CrawlerKind, grant: AIAchievementGrant): AIAchievementDef | null {
    const def = this.managerOf(kind).recordAIAchievement(grant);
    if (def === null) return null;
    const rewards = this.pay(kind, def.rarity, [], true);
    this.managerOf(kind).queuePresentation({
      origin: { kind: 'award', award: def },
      title: def.name,
      subtitle: def.description,
      crawler: kind,
      rarity: def.rarity,
      rewards,
    });
    return def;
  }

  /** Rolls and pays a chest no achievement earned, and queues it for the reward screen. */
  grantChest(kind: CrawlerKind, grant: ChestGrant): RewardPresentation {
    const rewards = this.pay(kind, grant.rarity, grant.fixed ?? [], true);
    const presentation: RewardPresentation = {
      origin: { kind: 'chest', source: grant.source },
      title: CHEST_SOURCE_TITLES[grant.source],
      subtitle: grant.subtitle ?? '',
      crawler: kind,
      rarity: grant.rarity,
      rewards,
    };
    this.managerOf(kind).queuePresentation(presentation);
    return presentation;
  }

  /**
   * Adds one to `counter` for `kind` (for a party counter, either crawler's
   * credit counts once) and unlocks every achievement whose target it reaches.
   */
  advance(counter: AchievementCounterId, kind: CrawlerKind): void {
    const tally = counterKeeper(this.party, kind, counter).advanceCounter(counter);
    const earners: readonly CrawlerKind[] =
      ACHIEVEMENT_COUNTER_SCOPE[counter] === 'party' ? CRAWLER_KINDS : [kind];
    for (const id of Object.keys(ACHIEVEMENT_DEFS).filter(isAchievementId)) {
      const progress = ACHIEVEMENT_DEFS[id].progress;
      if (progress?.counter !== counter || tally < progress.target) continue;
      for (const earner of earners) this.unlock(earner, id);
    }
  }

  /** A monster the party killed on a dungeon floor, toward the kill ladder. */
  recordDungeonKill(): void {
    this.advance('dungeonKills', 'human');
  }

  /** A kill landed by `kind`'s relic, toward Hands-Free. */
  recordRelicKill(kind: CrawlerKind): void {
    this.advance('relicKills', kind);
  }

  /** `kind` is wearing every piece of a gear set. */
  unlockDressedForTheOccasion(kind: CrawlerKind): void {
    this.unlock(kind, 'dressed_for_the_occasion');
  }

  private recipientOf(reward: FixedReward, kind: CrawlerKind): CrawlerKind {
    if (reward.to === undefined) return kind;
    return reward.to === 'active' ? this.deps.activeCrawler() : reward.to;
  }

  private fixedLine(reward: FixedReward): GrantedLine {
    if (reward.kind === 'companion') return { kind: 'companion', id: reward.id };
    if (isGearId(reward.id) && this.deps.owns(reward.id)) {
      return { kind: 'duplicate', id: reward.id, coins: duplicateCoins(reward.id) };
    }
    return { kind: 'item', id: reward.id, quantity: reward.quantity };
  }

  /**
   * Rolls (when `roll`) and pays one chest to `kind`, with the fixed rewards
   * routed to `kind` on top, and returns every line it paid.
   */
  private pay(
    kind: CrawlerKind,
    rarity: Rarity,
    fixed: ReadonlyArray<FixedReward>,
    roll: boolean,
  ): GrantedLine[] {
    const fixedLines = fixed
      .filter((reward) => this.recipientOf(reward, kind) === kind)
      .map((reward) => this.fixedLine(reward));
    const rolled = roll
      ? rollRewardChest(rarity, kind, this.deps.random ?? worldRandom, {
          owns: this.deps.owns,
          // The recipient's worn coin bonus pays on chests as it does on kills.
          coinMultiplier: coinBonusFor(this.crawler(kind)),
          // Every fixed piece, whichever crawler it is routed to: the award pays it
          // to one of them, so a roll on either must not hand over a second copy.
          reserved: fixed.flatMap((reward) => (reward.kind === 'item' ? [reward.id] : [])),
        })
      : [];
    const lines = [...rolled, ...fixedLines];
    const owner = this.crawler(kind);
    let coins = 0;
    let potions = 0;
    const items: ItemId[] = [];
    for (const line of lines) {
      if (line.kind === 'item') {
        owner.inventory.addItem(line.id, line.quantity);
        if (line.id === POTION_ID) potions += line.quantity;
        else items.push(line.id);
      } else if (line.kind === 'coins') {
        owner.earnCoins(line.amount);
        coins += line.amount;
      } else if (line.kind === 'duplicate') {
        owner.earnCoins(line.coins);
        coins += line.coins;
      }
    }
    this.deps.bus.emit('rewardChestOpened', { owner, rarity, coins, potions, items });
    return lines;
  }
}
