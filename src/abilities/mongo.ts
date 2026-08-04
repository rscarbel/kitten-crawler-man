import type { AbilityDef } from '../core/AbilityManager';
import { drawMongoIcon, type MongoStage } from '../sprites/mongoSprite';

/**
 * Mongo the Mongoliensis — the cat's pet raptor, modelled as an ability so he
 * levels, gains stats and shows up in the Abilities tab like everything else
 * the party gets better at.
 *
 * He is unusual in two ways, and both are deliberate: he has no tome and no
 * hotbar slot (he is summoned from the Summon button or the R key), and his
 * "stats" are a whole creature's rather than a spell's. Everything that scales
 * with his level lives in one table below so tuning him is one edit.
 */

export type MongoAttack = 'bite' | 'slash' | 'pounce';

export interface MongoStats {
  readonly stage: MongoStage;
  readonly maxHp: number;
  readonly biteDamage: number;
  readonly slashDamage: number;
  readonly pounceDamage: number;
  /** Movement speed in pixels per frame, the same units `Mob.speed` uses. */
  readonly speed: number;
  readonly slashUnlocked: boolean;
  readonly pounceUnlocked: boolean;
}

interface MongoLevelRow extends MongoStats {
  readonly level: number;
  readonly perk: string;
}

const MONGO_LEVELS: readonly MongoLevelRow[] = [
  {
    level: 1,
    stage: 'juvenile',
    maxHp: 20,
    biteDamage: 2,
    slashDamage: 0,
    pounceDamage: 0,
    speed: 2.0,
    slashUnlocked: false,
    pounceUnlocked: false,
    perk: 'A tiny terror hatches. Mongo fights at your side with a snapping bite.',
  },
  {
    level: 2,
    stage: 'juvenile',
    maxHp: 24,
    biteDamage: 3,
    slashDamage: 0,
    pounceDamage: 0,
    speed: 2.0,
    slashUnlocked: false,
    pounceUnlocked: false,
    perk: 'Thicker down — Mongo takes more punishment before you have to call him back.',
  },
  {
    level: 3,
    stage: 'juvenile',
    maxHp: 28,
    biteDamage: 3,
    slashDamage: 4,
    pounceDamage: 0,
    speed: 2.0,
    slashUnlocked: true,
    pounceUnlocked: false,
    perk: 'Learns the fore-claw slash — a raking two-handed swipe at longer reach.',
  },
  {
    level: 4,
    stage: 'juvenile',
    maxHp: 34,
    biteDamage: 4,
    slashDamage: 5,
    pounceDamage: 0,
    speed: 2.1,
    slashUnlocked: true,
    pounceUnlocked: false,
    perk: 'Sharper claws, and the first hint of a hunting stride.',
  },
  {
    level: 5,
    stage: 'adolescent',
    maxHp: 55,
    biteDamage: 6,
    slashDamage: 8,
    pounceDamage: 0,
    speed: 2.4,
    slashUnlocked: true,
    pounceUnlocked: false,
    perk: 'GROWTH SPURT — Mongo is an adolescent. A major surge in health, damage and speed.',
  },
  {
    level: 6,
    stage: 'adolescent',
    maxHp: 62,
    biteDamage: 7,
    slashDamage: 9,
    pounceDamage: 0,
    speed: 2.4,
    slashUnlocked: true,
    pounceUnlocked: false,
    perk: 'Denser muscle across the shoulders and haunches.',
  },
  {
    level: 7,
    stage: 'adolescent',
    maxHp: 70,
    biteDamage: 8,
    slashDamage: 10,
    pounceDamage: 14,
    speed: 2.4,
    slashUnlocked: true,
    pounceUnlocked: true,
    perk: 'Learns the leaping sickle-claw pounce — a gap-closer that lands with both feet.',
  },
  {
    level: 8,
    stage: 'adolescent',
    maxHp: 80,
    biteDamage: 9,
    slashDamage: 11,
    pounceDamage: 16,
    speed: 2.5,
    slashUnlocked: true,
    pounceUnlocked: true,
    perk: 'Longer stride — he reaches the fight before it reaches you.',
  },
  {
    level: 9,
    stage: 'adolescent',
    maxHp: 92,
    biteDamage: 10,
    slashDamage: 12,
    pounceDamage: 18,
    speed: 2.5,
    slashUnlocked: true,
    pounceUnlocked: true,
    perk: 'Hunting instincts sharpen. Every attack hits harder.',
  },
  {
    level: 10,
    stage: 'adult',
    maxHp: 130,
    biteDamage: 14,
    slashDamage: 17,
    pounceDamage: 26,
    speed: 2.8,
    slashUnlocked: true,
    pounceUnlocked: true,
    perk: 'FULLY GROWN — a true Mongoliensis. Everything about him gets worse for everyone else.',
  },
  {
    level: 11,
    stage: 'adult',
    maxHp: 145,
    biteDamage: 15,
    slashDamage: 19,
    pounceDamage: 29,
    speed: 2.8,
    slashUnlocked: true,
    pounceUnlocked: true,
    perk: 'Hardened scales under the feathers.',
  },
  {
    level: 12,
    stage: 'adult',
    maxHp: 160,
    biteDamage: 17,
    slashDamage: 21,
    pounceDamage: 32,
    speed: 2.8,
    slashUnlocked: true,
    pounceUnlocked: true,
    perk: 'Pack-hunter cunning — he picks his target and finishes it.',
  },
  {
    level: 13,
    stage: 'adult',
    maxHp: 175,
    biteDamage: 19,
    slashDamage: 23,
    pounceDamage: 35,
    speed: 2.9,
    slashUnlocked: true,
    pounceUnlocked: true,
    perk: 'Terrifying speed across open ground.',
  },
  {
    level: 14,
    stage: 'adult',
    maxHp: 190,
    biteDamage: 21,
    slashDamage: 25,
    pounceDamage: 39,
    speed: 2.9,
    slashUnlocked: true,
    pounceUnlocked: true,
    perk: 'Almost apex. Very little on this floor wants his attention.',
  },
  {
    level: 15,
    stage: 'adult',
    maxHp: 220,
    biteDamage: 24,
    slashDamage: 29,
    pounceDamage: 45,
    speed: 3.0,
    slashUnlocked: true,
    pounceUnlocked: true,
    perk: 'APEX PREDATOR. Mongo is the most dangerous thing in the room, and he is yours.',
  },
];

export const MONGO_MAX_LEVEL = MONGO_LEVELS.length;

/**
 * Damage he has to land for one point of ability XP.
 *
 * `killXp` alone makes the first levels a wall, because the pet is the one
 * creature in the party that mostly does not get the killing blow: a juvenile
 * bites for two against mobs the cat is already hitting for ten, so a raptor who
 * spent a whole floor in the fight can come off it having earned nothing. Paying
 * for the contribution as well as the finish is what makes chip damage count.
 *
 * Deliberately coarse. A rate fine enough to pay per blow at level 1 pays an
 * adult twelve times as much for the same swing, and his XP thresholds are the
 * ones that grew — see {@link MONGO_DEF.xpGrowthRate}.
 */
export const MONGO_DAMAGE_PER_XP = 5;

/** The stats Mongo fights with at a given pet level. */
export function getMongoStats(level: number): MongoStats {
  const index = Math.max(0, Math.min(MONGO_LEVELS.length - 1, Math.round(level) - 1));
  return MONGO_LEVELS[index];
}

/**
 * Icon for the Abilities tab, the summon button and the reward dialog.
 *
 * Drawn from the sheet his *current* level uses, so the button shows the animal
 * that will actually turn up rather than a stock portrait of the adult.
 */
function renderMongoIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  level: number,
): void {
  drawMongoIcon(ctx, getMongoStats(level).stage, x + size / 2, y + size / 2, size);
}

export const MONGO_DEF: AbilityDef = {
  id: 'mongo',
  name: 'Mongo',
  owner: 'cat',
  tag: 'PET',
  equipInstructions:
    'Switch to Cat (Tab), then press R or the Summon button. Press again to recall.',
  baseXpToLevel2: 100,
  xpGrowthRate: 1.45,
  finalLevelMultiplier: 2.0,
  usageXp: 2,
  killXp: 15,
  maxLevel: MONGO_MAX_LEVEL,
  perks: MONGO_LEVELS.map((row) => ({ level: row.level, description: row.perk })),
  renderIcon: renderMongoIcon,
};
