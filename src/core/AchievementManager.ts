import { randomInt } from '../utils';

export type AchievementId =
  | 'first_blood'
  | 'boss_slayer'
  | 'smush'
  | 'safe_haven'
  | 'magic_touch';

export type BoxTier = 'Bronze' | 'Silver' | 'Gold' | 'Legendary' | 'Celestial';
export type BoxCategory = 'Adventurer' | 'Boss' | 'Spicy';
export type PlayerTarget = 'human' | 'cat' | 'both';

export interface LootBox {
  id: number;
  tier: BoxTier;
  category: BoxCategory;
  fromAchievement: AchievementId;
}

export interface AchievementDef {
  id: AchievementId;
  name: string;
  description: string;
  /** Which player(s) can earn this achievement. */
  playerType: PlayerTarget;
  /** Loot box granted on unlock; omit for achievements with no box reward. */
  lootBox?: { tier: BoxTier; category: BoxCategory };
}

export const ACHIEVEMENT_DEFS: Record<AchievementId, AchievementDef> = {
  first_blood: {
    id: 'first_blood',
    name: "You've killed a mob!",
    description: 'You have killed a mob for the first time in the dungeon',
    playerType: 'both',
  },
  boss_slayer: {
    id: 'boss_slayer',
    name: 'Boss Slayer',
    description: 'Vanquish a dungeon boss.',
    playerType: 'both',
    lootBox: { tier: 'Bronze', category: 'Boss' },
  },
  smush: {
    id: 'smush',
    name: 'Bare feet',
    description: "You've used your bare feet to crush and kill an opponent",
    playerType: 'human',
    lootBox: { tier: 'Bronze', category: 'Spicy' },
  },
  safe_haven: {
    id: 'safe_haven',
    name: 'Safe Haven',
    description: 'Find and enter the safe room.',
    playerType: 'both',
    lootBox: { tier: 'Bronze', category: 'Adventurer' },
  },
  magic_touch: {
    id: 'magic_touch',
    name: 'Magic Touch',
    description: 'Eliminate an enemy with a magic missile (Cat only).',
    playerType: 'cat',
    lootBox: { tier: 'Bronze', category: 'Adventurer' },
  },
};

/** Contents granted when a loot box is opened. */
export interface BoxContents {
  potions?: number;
  coins: number;
  /** Optional extra item id and quantity. */
  bonus?: { id: string; quantity: number };
}

const BOX_CONTENTS = {
  Bronze: {
    Adventurer: { potions: randomInt(1, 2), coins: randomInt(5, 10) },
    Boss: { potions: randomInt(2, 3), coins: randomInt(20, 25) },
    Spicy: {
      ...(randomInt(0, 2) ? { potions: 1 } : {}),
      coins: 15,
      bonus: { id: 'goblin_dynamite', quantity: 1 },
    },
  },
  Silver: {
    Adventurer: { potions: 3, coins: 20 },
    Boss: { potions: 4, coins: 40 },
    Spicy: {
      potions: 2,
      coins: 25,
      bonus: { id: 'goblin_dynamite', quantity: 2 },
    },
  },
  Gold: {
    Adventurer: { potions: 4, coins: 35 },
    Boss: { potions: 5, coins: 60 },
    Spicy: {
      potions: 3,
      coins: 40,
      bonus: { id: 'goblin_dynamite', quantity: 3 },
    },
  },
  Legendary: {
    Adventurer: { potions: 5, coins: 60 },
    Boss: { potions: 6, coins: 100 },
    Spicy: {
      potions: 4,
      coins: 60,
      bonus: { id: 'goblin_dynamite', quantity: 4 },
    },
  },
  Celestial: {
    Adventurer: { potions: 6, coins: 100 },
    Boss: { potions: 8, coins: 150 },
    Spicy: {
      potions: 5,
      coins: 80,
      bonus: { id: 'goblin_dynamite', quantity: 5 },
    },
  },
} as const satisfies Record<BoxTier, Record<BoxCategory, BoxContents>>;

export function getBoxContents(
  tier: BoxTier,
  category: BoxCategory,
): BoxContents {
  return BOX_CONTENTS[tier][category];
}

export class AchievementManager {
  private unlocked = new Set<AchievementId>();
  /** Queue of achievement defs waiting to be shown as unread (icon badge). */
  readonly pendingNotifications: AchievementDef[] = [];
  /** Loot boxes accumulated from achievements, awaiting opening in a safe room. */
  readonly pendingBoxes: LootBox[] = [];
  private nextBoxId = 1;

  /** Number of achievements unlocked since the last clearUnread() call. */
  get unreadCount(): number {
    return this.pendingNotifications.length;
  }

  /**
   * Attempt to unlock an achievement. Returns true if it was newly unlocked,
   * false if it was already unlocked (each achievement is one-time).
   */
  tryUnlock(id: AchievementId): boolean {
    if (this.unlocked.has(id)) return false;
    this.unlocked.add(id);
    const def = ACHIEVEMENT_DEFS[id];
    this.pendingNotifications.push(def);
    if (def.lootBox) {
      this.pendingBoxes.push({
        id: this.nextBoxId++,
        tier: def.lootBox.tier,
        category: def.lootBox.category,
        fromAchievement: id,
      });
    }
    return true;
  }

  /** Clear all unread notifications (call when the player views the achievements tab). */
  clearUnread(): void {
    this.pendingNotifications.length = 0;
  }

  isUnlocked(id: AchievementId): boolean {
    return this.unlocked.has(id);
  }

  /** Returns all achievement defs paired with their unlock status, in definition order. */
  getAllAchievements(): Array<{ def: AchievementDef; unlocked: boolean }> {
    return (Object.keys(ACHIEVEMENT_DEFS) as AchievementId[]).map((id) => ({
      def: ACHIEVEMENT_DEFS[id],
      unlocked: this.unlocked.has(id),
    }));
  }

  /**
   * Directly grant a loot box without requiring a new achievement unlock.
   * Use when the achievement is already earned but the box should still be awarded.
   */
  grantBox(
    tier: BoxTier,
    category: BoxCategory,
    fromAchievement: AchievementId,
  ): void {
    this.pendingBoxes.push({
      id: this.nextBoxId++,
      tier,
      category,
      fromAchievement,
    });
  }

  /**
   * Open (remove) a specific box by ID. Returns the box if found, or null.
   * The caller is responsible for granting the box contents to the player.
   */
  openBox(boxId: number): LootBox | null {
    const idx = this.pendingBoxes.findIndex((b) => b.id === boxId);
    if (idx === -1) return null;
    const [box] = this.pendingBoxes.splice(idx, 1);
    return box;
  }
}
