/**
 * Opening a treasure chest, the same way in every scene that has one: the
 * press hands the loot over at once, the human heaves the lid, the reward
 * card shows what came out and the coins and items fly to the HUD once the
 * card is put away.
 *
 * A scene owns one kit and binds every `TreasureChestSystem` it builds to it
 * (one per map, so a tower storey's chests are judged against that storey's
 * mobs). What only one scene knows — the tutorial's scripted first chest,
 * Big Rooster's tattoo line — comes in through {@link ChestKitDeps.reward}
 * rather than as a second copy of this wiring.
 */

import type { AudioManager } from '../../audio/AudioManager';
import type { PlayerManager } from '../../core/party/PlayerManager';
import { ITEM_DEF, type ItemId } from '../../core/items/defs/ItemDefs';
import { getSkillDef, type CrawlerKind } from '../../core/skills/SkillManager';
import { TILE_SIZE } from '../../core/constants';
import { viewportHeight, viewportWidth } from '../../core/rendering/Viewport';
import type { LootDrop, Mob } from '../../creatures/Mob';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import { openChestWithGesture } from '../../creatures/humanGestures';
import { coinBonusFor } from '../../gear/gearHooks';
import { rollChestGear, withGearLoot, type GearId } from '../../loot/gearPools';
import type { GameMap } from '../../map/GameMap';
import type { TilePoint } from '../../map/town/townPlan';
import { ChestRewardDialog, type ChestLootSplit } from '../../ui/ChestRewardDialog';
import type { Surface } from '../../ui/core/UiRoot';
import { chestRewardSurface } from '../../ui/screens/dialogs/chestRewardScreen';
import type { RewardFlyHold, RewardFlySystem } from '../RewardFlySystem';
import type { ChestType, TreasureChest, TreasureChestSystem } from '../TreasureChestSystem';

/** Even odds for which crawler takes the odd coin or the odd unit of a split stack. */
const LOOT_SPLIT_THRESHOLD = 0.5;
/** A chest's centre, as a fraction of its tile. */
const TILE_CENTRE_FRACTION = 0.5;

/**
 * What an opened chest's reward dialog shows, and what dismissing it grants
 * over and above the loot, which is already handed over when it is shown.
 */
export interface ChestReward {
  readonly split: ChestLootSplit | null;
  readonly onDismissed?: () => void;
}

export interface ChestKitDeps {
  readonly pm: PlayerManager;
  readonly audio: AudioManager | null;
  readonly rewardFly: RewardFlySystem;
  /** The floor whose gear pools a world chest rolls from. */
  readonly floorNumber: number;
  /** Whether the party already has `id`, carried or still on the ground: gear is one of a kind per party. */
  readonly partyOwnsGear: (id: GearId) => boolean;
  /**
   * The scene's own answer for a chest, for the few whose reward is not just
   * their loot. `payStandard` pays the chest's loot and rolled gear and returns
   * the split it paid; a reward that replaces the loot does not call it.
   * Absent, every chest pays its standard split.
   */
  readonly reward?: (chest: TreasureChest, payStandard: () => ChestLootSplit | null) => ChestReward;
}

/**
 * Puts chests on one map. Every chest blocks its tile, so a crawler can never
 * stand inside one.
 */
export interface ChestPlacer {
  /**
   * A wooden chest held by a band of mobs called out later, wherever they
   * then stand: locked from the start, and unlocked once every mob posted to
   * it with {@link postChestBand} is dead.
   */
  heldByBand(tile: TilePoint, loot: LootDrop): TreasureChest;
  /** A chest a previous visit already emptied: drawn with its lid up, offering nothing. */
  opened(tile: TilePoint, type: ChestType): TreasureChest;
}

export function chestPlacer(chests: TreasureChestSystem, map: GameMap): ChestPlacer {
  return {
    heldByBand: (tile, loot) => {
      map.blockTilePermanently(tile.x, tile.y);
      return chests.addBandChest(tile.x, tile.y, loot);
    },
    opened: (tile, type) => {
      map.blockTilePermanently(tile.x, tile.y);
      return chests.addOpenedChest(tile.x, tile.y, type);
    },
  };
}

/** Posts the band that holds a chest placed with {@link ChestPlacer.heldByBand}. */
export function postChestBand(chest: TreasureChest, band: ReadonlyArray<Mob>): void {
  chest.guard = { kind: 'band', mobs: band };
}

/**
 * Which crawler must receive this item, or null when either may have it.
 *
 * An item naming a `lootRecipient` goes to that crawler, and gear to the one
 * its `wearer` names. Beyond gear, a book only one of them can study is routed
 * to that one — the alternative is handing the cat's only guaranteed Cockroach
 * book to the human, who cannot read it.
 */
export function forcedRecipientFor(id: ItemId): CrawlerKind | null {
  const def = ITEM_DEF[id];
  if (def.lootRecipient !== undefined) return def.lootRecipient;
  if (def.wearer !== undefined && def.wearer !== 'both') return def.wearer;
  if (def.explosivesHandlingLevels !== undefined) return 'human';
  const skillId = def.skillId;
  if (skillId === undefined) return null;
  const eligibleFor = getSkillDef(skillId).eligibleFor;
  return eligibleFor === 'both' ? null : eligibleFor;
}

/** Shares a chest's loot between the two crawlers, each forced item to the crawler it belongs to. */
function splitChestLoot(loot: LootDrop): { humanLoot: LootDrop; catLoot: LootDrop } {
  const humanItems: LootDrop['items'] = [];
  const catItems: LootDrop['items'] = [];
  const singlePool: LootDrop['items'] = [];

  for (const item of loot.items) {
    const forced = forcedRecipientFor(item.id);
    if (forced === 'human') {
      humanItems.push({ ...item });
    } else if (forced === 'cat') {
      catItems.push({ ...item });
    } else if (item.quantity === 1) {
      singlePool.push({ ...item });
    } else {
      const half = Math.floor(item.quantity / 2);
      const extra = item.quantity - half * 2;
      const humanGetsExtra = extra > 0 && Math.random() < LOOT_SPLIT_THRESHOLD;
      humanItems.push({ id: item.id, quantity: half + (humanGetsExtra ? extra : 0) });
      catItems.push({ id: item.id, quantity: half + (humanGetsExtra ? 0 : extra) });
    }
  }

  // Shuffled before the round-robin, so which crawler gets the first single
  // item is not decided by the order the loot table lists them in.
  for (let i = singlePool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [singlePool[i], singlePool[j]] = [singlePool[j], singlePool[i]];
  }
  singlePool.forEach((item, i) => {
    if (i % 2 === 0) humanItems.push(item);
    else catItems.push(item);
  });

  const halfCoins = Math.floor(loot.coins / 2);
  const extraCoin = loot.coins - halfCoins * 2;
  const humanGetsExtraCoin = extraCoin > 0 && Math.random() < LOOT_SPLIT_THRESHOLD;

  return {
    humanLoot: { coins: halfCoins + (humanGetsExtraCoin ? extraCoin : 0), items: humanItems },
    catLoot: { coins: halfCoins + (humanGetsExtraCoin ? 0 : extraCoin), items: catItems },
  };
}

export class ChestKit {
  private readonly dialog = new ChestRewardDialog();
  /** The reward dialog's own hold, if one is outstanding — taken when it opens, let go when it closes. */
  private flyHold: RewardFlyHold | null = null;

  constructor(private readonly deps: ChestKitDeps) {}

  /** Wires one map's chests to this kit's open, locked and unlocked handling. */
  bind(chests: TreasureChestSystem): void {
    chests.setOnOpen((chest) => {
      // The loot is his on the press, so nothing that befalls him while he
      // heaves the lid can lose it; only the showing waits for the lid.
      const reward = this.grantContents(chest);
      const chestCentre = {
        x: (chest.tileX + TILE_CENTRE_FRACTION) * TILE_SIZE,
        y: (chest.tileY + TILE_CENTRE_FRACTION) * TILE_SIZE,
      };
      openChestWithGesture(this.deps.pm.active(), chestCentre, (outcome) => {
        if (outcome === 'shown') this.showReward(chest, reward);
        else reward.onDismissed?.();
      });
    });
    chests.setOnLockedAttempt(() => {
      this.deps.audio?.play('chest_locked');
    });
    chests.setOnWoodenChestUnlocked(() => {
      this.deps.audio?.play('chest_unlocked_in_treasure_room');
    });
  }

  get isOpen(): boolean {
    return this.dialog.isOpen;
  }

  /** Mount once on the scene's `UiRoot`. */
  surface(): Surface {
    return chestRewardSurface(this.dialog);
  }

  /** Every frame, ahead of any halting return: the card animates while it holds the world. */
  tick(): void {
    this.dialog.tick();
    if (this.dialog.rewardSoundPending) {
      this.dialog.rewardSoundPending = false;
      this.deps.audio?.play('treasure_chest_reward');
    }
  }

  /**
   * Drops the card and its queued fly without granting anything, for a world
   * being rewound to before the chest was opened. Cancelling by this kit's own
   * hold leaves any other hold outstanding at the same time (an achievement
   * reveal, say) untouched.
   */
  discard(): void {
    if (this.flyHold !== null) {
      this.deps.rewardFly.cancel(this.flyHold);
      this.flyHold = null;
    }
    this.dialog.discard();
  }

  /**
   * Hands over what is inside a chest the moment it is opened, and returns
   * what its reward dialog is to show. The dialog only previews the loot
   * already handed over, so showing it never grants twice.
   */
  private grantContents(chest: TreasureChest): ChestReward {
    const payStandard = (): ChestLootSplit | null => this.payStandard(chest);
    return this.deps.reward?.(chest, payStandard) ?? { split: payStandard() };
  }

  private payStandard(chest: TreasureChest): ChestLootSplit | null {
    // A boss chest holds the boss's own loot, gear roll included, and its
    // coins took the kill's coin bonus when the boss died; a world chest rolls
    // its gear and takes the bonus here.
    const isBossChest = chest.bossRoomIndex !== null;
    const chestGear = isBossChest
      ? { items: [], coins: 0 }
      : rollChestGear(chest.type, this.deps.floorNumber, Math.random, this.deps.partyOwnsGear);
    const loot = withGearLoot(chest.loot, chestGear);
    const split = loot !== null ? splitChestLoot(loot) : null;
    this.paySplit(split, !isBossChest);
    return split;
  }

  /** Pays a chest's split; `coinBonus` is false for coins that already took it. */
  private paySplit(split: ChestLootSplit | null, coinBonus: boolean): void {
    if (split === null) return;
    const { human, cat } = this.deps.pm;
    const bonusFor = (crawler: HumanPlayer | CatPlayer): number =>
      coinBonus ? coinBonusFor(crawler) : 1;
    for (const item of split.humanLoot.items) {
      human.inventory.addItem(item.id, item.quantity);
    }
    human.earnCoins(Math.round(split.humanLoot.coins * bonusFor(human)));
    for (const item of split.catLoot.items) {
      cat.inventory.addItem(item.id, item.quantity);
    }
    cat.earnCoins(Math.round(split.catLoot.coins * bonusFor(cat)));
  }

  /** A chest's lid is up: show what came out of it. */
  private showReward(chest: TreasureChest, reward: ChestReward): void {
    // Queued here and held until the card the player is looking at closes,
    // under its own handle so a rewind of this exact chest cancels only this
    // queue.
    const rewardFly = this.deps.rewardFly;
    const flyHold = rewardFly.hold();
    this.flyHold = flyHold;
    const dialogCenter = { x: viewportWidth() / 2, y: viewportHeight() / 2 };
    const split = reward.split;
    if (split !== null) {
      rewardFly.enqueueCoins(split.humanLoot.coins, dialogCenter.x, dialogCenter.y, flyHold);
      rewardFly.enqueueCoins(split.catLoot.coins, dialogCenter.x, dialogCenter.y, flyHold);
      for (const item of [...split.humanLoot.items, ...split.catLoot.items]) {
        rewardFly.enqueueItem(
          item.id,
          ITEM_DEF[item.id].name,
          dialogCenter.x,
          dialogCenter.y,
          flyHold,
        );
      }
    }
    this.dialog.open(chest, reward.split, () => {
      rewardFly.release(flyHold);
      this.flyHold = null;
      reward.onDismissed?.();
    });
    this.deps.audio?.play('opening_treasure_chest');
  }
}
