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

/**
 * Every stat he has, per level.
 *
 * The `maxHp` column carries two invariants the perk text depends on and the
 * numbers do not state, both of which a partial re-scale breaks quietly.
 *
 * Levels 5 and 10 are *growth spurts*, so their step has to be visibly larger
 * than the ordinary steps either side of it. Fattening the juvenile rows without
 * re-taping the adolescent ones broke this in the worst possible way — a level-4
 * raptor with more health than a level-5 one, under a perk line reading GROWTH
 * SPURT.
 *
 * And the ordinary steps never go backwards: a level-6 raptor must not gain less
 * health per level than a level-2 one. That is the trap the first repair fell
 * into. Restoring the spurt by *flattening its neighbours* satisfies a purely
 * relative check while leaving the adolescent band the slowest-growing stretch
 * in the table, right where the player has just been taught that levelling
 * matters. Both invariants are gated in `verify-mongo.ts`; re-scale a band and
 * run it.
 */
const MONGO_LEVELS: readonly MongoLevelRow[] = [
  {
    level: 1,
    stage: 'juvenile',
    maxHp: 35,
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
    maxHp: 42,
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
    maxHp: 50,
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
    maxHp: 60,
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
    maxHp: 80,
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
    maxHp: 90,
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
    maxHp: 100,
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
    maxHp: 110,
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
    maxHp: 120,
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
    maxHp: 155,
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
    maxHp: 168,
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
    maxHp: 181,
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
    maxHp: 194,
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
    maxHp: 207,
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
 *
 * Two, not five, because at five the arithmetic never reached a level-up. A
 * level-1 raptor bites for two every 46 frames, which at five damage a point is
 * about a third of a point per second of *uninterrupted* combat — five-plus
 * minutes of continuous biting, from an animal who dies in a few hits and then
 * owes minutes of recovery, to buy the first level. Players did not report
 * levelling as slow; they reported it as not existing.
 */
export const MONGO_DAMAGE_PER_XP = 2;

/**
 * XP for a kill he helped with but did not finish.
 *
 * The pet is the one party member who mostly does not land the killing blow —
 * he chips at what the cat is already hitting for many times his bite — so a
 * finish-only reward pays him for the fights he happened to be lucky in rather
 * than the ones he did work in. Well under {@link MONGO_DEF.killXp}: helping is
 * worth real progress, finishing is worth more.
 */
export const MONGO_ASSIST_XP = 5;

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
    'Switch to Cat (Tab), then press R or the Summon button. Press again to recall. ' +
    'His health is his own and it carries between summons — he does not come back topped up. ' +
    'He heals slowly only while recalled, and a knockout means he rests all the way to full ' +
    'before he can be sent in again. Below roughly two fifths of his health he will not go in ' +
    'at all — a raptor that hurt stays at your side instead of fighting, so the button holds ' +
    'him back until he is fit.',
  // Sixty rather than a hundred: the first level-up has to land inside the first
  // session that actually uses him, because it is the proof to the player that
  // he levels at all. The 1.45 growth rate is untouched — the late curve is fine
  // once there is a reason to believe in it.
  baseXpToLevel2: 60,
  xpGrowthRate: 1.45,
  finalLevelMultiplier: 2.0,
  usageXp: 2,
  killXp: 15,
  maxLevel: MONGO_MAX_LEVEL,
  perks: MONGO_LEVELS.map((row) => ({ level: row.level, description: row.perk })),
  renderIcon: renderMongoIcon,
};
