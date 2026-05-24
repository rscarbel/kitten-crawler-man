import type { AbilityDef } from '../core/AbilityManager';
import { drawSpriteKey } from '../core/SpriteRenderer';

const LEVEL_SLIGHT_COOLDOWN_REDUCTION = 2;
const LEVEL_MODERATE_COOLDOWN_REDUCTION = 6;
const LEVEL_SIGNIFICANT_COOLDOWN_REDUCTION = 9;
const LEVEL_FAST_COOLDOWN = 11;
const LEVEL_FULL_POWER = 15;
const LEVEL_DAMAGE_BOOST_1 = 3;
const LEVEL_DAMAGE_BOOST_2 = 7;
const LEVEL_DAMAGE_BOOST_3 = 12;
const LEVEL_RANGE_BOOST_1 = 4;
const LEVEL_RANGE_BOOST_2 = 8;
const LEVEL_RANGE_BOOST_3 = 13;
const LEVEL_AOE_SPLASH = 5;
const LEVEL_SUB_MISSILES = 10;
const LEVEL_HOMING = 14;
const COOLDOWN_VERY_FAST = 12;
const COOLDOWN_FAST = 36;
const COOLDOWN_MODERATE = 48;
const COOLDOWN_MEDIUM = 60;
const COOLDOWN_BASE = 72;
const DAMAGE_MULT_SMALL = 1.05;
const DAMAGE_MULT_MEDIUM = 1.1;
const DAMAGE_MULT_LARGE = 1.5;
const DAMAGE_MULT_FULL_POWER = 3.0;
const RANGE_MULT_SMALL = 1.05;
const RANGE_MULT_MEDIUM = 1.1;
const RANGE_MULT_LARGE = 1.5;
const RANGE_INFINITE = 9999;
const SPEED_FULL_POWER = 9.0;
const SPEED_BASE = 4.5;

/** Runtime stats computed from the current ability level. */
export interface MagicMissileStats {
  /** Frames between allowed player-triggered shots (0 = no cooldown). */
  cooldownFrames: number;
  /** Multiplier applied to base missile damage (2 + intelligence). */
  damageMultiplier: number;
  /** Multiplier applied to base range (3.5 + intelligence * 0.5 tiles). */
  rangeMultiplier: number;
  /** Speed in px/frame. Increases to 9 at level 15. */
  speed: number;
  /** Level ≥ 5: small AoE splash on mob hit. */
  hasAoeSplash: boolean;
  /** Level ≥ 10: hit spawns 3-5 sub-missiles from the impact point. */
  hasSubMissiles: boolean;
  /** Level ≥ 14: missiles curve toward enemies in a 120° forward cone. */
  hasHoming: boolean;
  /** Level ≥ 15: infinite range, boss slow, death shockwave, orange beam visual. */
  isFullPower: boolean;
}

export function getMagicMissileStats(level: number): MagicMissileStats {
  // Cooldown reductions (frames @ 60 fps):
  //   Base: 72 (1.2 s)  L2: 60 (1.0 s)  L6: 48 (0.8 s)  L9: 36 (0.6 s)
  //   L11: 12 (0.2 s)   L15: 0 (no cooldown)
  let cooldownFrames: number;
  if (level >= LEVEL_FULL_POWER) cooldownFrames = 0;
  else if (level >= LEVEL_FAST_COOLDOWN) cooldownFrames = COOLDOWN_VERY_FAST;
  else if (level >= LEVEL_SIGNIFICANT_COOLDOWN_REDUCTION) cooldownFrames = COOLDOWN_FAST;
  else if (level >= LEVEL_MODERATE_COOLDOWN_REDUCTION) cooldownFrames = COOLDOWN_MODERATE;
  else if (level >= LEVEL_SLIGHT_COOLDOWN_REDUCTION) cooldownFrames = COOLDOWN_MEDIUM;
  else cooldownFrames = COOLDOWN_BASE;

  // Cumulative damage multipliers (multiplicative stacking):
  //   L3: ×1.05   L7: ×1.10   L12: ×1.50   L15: ×3.00
  let damageMultiplier = 1.0;
  if (level >= LEVEL_DAMAGE_BOOST_1) damageMultiplier *= DAMAGE_MULT_SMALL;
  if (level >= LEVEL_DAMAGE_BOOST_2) damageMultiplier *= DAMAGE_MULT_MEDIUM;
  if (level >= LEVEL_DAMAGE_BOOST_3) damageMultiplier *= DAMAGE_MULT_LARGE;
  if (level >= LEVEL_FULL_POWER) damageMultiplier *= DAMAGE_MULT_FULL_POWER;

  // Cumulative range multipliers:
  //   L4: ×1.05   L8: ×1.10   L13: ×1.50   L15: effectively infinite
  let rangeMultiplier = 1.0;
  if (level >= LEVEL_RANGE_BOOST_1) rangeMultiplier *= RANGE_MULT_SMALL;
  if (level >= LEVEL_RANGE_BOOST_2) rangeMultiplier *= RANGE_MULT_MEDIUM;
  if (level >= LEVEL_RANGE_BOOST_3) rangeMultiplier *= RANGE_MULT_LARGE;
  if (level >= LEVEL_FULL_POWER) rangeMultiplier = RANGE_INFINITE;

  const speed = level >= LEVEL_FULL_POWER ? SPEED_FULL_POWER : SPEED_BASE;

  return {
    cooldownFrames,
    damageMultiplier,
    rangeMultiplier,
    speed,
    hasAoeSplash: level >= LEVEL_AOE_SPLASH,
    hasSubMissiles: level >= LEVEL_SUB_MISSILES,
    hasHoming: level >= LEVEL_HOMING,
    isFullPower: level >= LEVEL_FULL_POWER,
  };
}

function renderMagicMissileIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  level: number,
): void {
  const state = level >= LEVEL_FULL_POWER ? 'full_power' : 'standard';
  drawSpriteKey(ctx, 'magic_missile_icon', state, 0, x, y, size);
}

export const MAGIC_MISSILE_DEF: AbilityDef = {
  id: 'magic_missile',
  name: 'Magic Missile',
  owner: 'cat',
  equipInstructions: 'Switch to Cat (Tab), place tome on hotbar, press key 1–7 to fire',
  baseXpToLevel2: 100,
  xpGrowthRate: 1.7,
  finalLevelMultiplier: 2.2,
  usageXp: 1,
  killXp: 20,
  maxLevel: 15,
  perks: [
    {
      level: 1,
      description:
        'Magic Missile: A bolt of pure arcane energy. The Cat fires a magical projectile.',
    },
    { level: 2, description: 'Cooldown decreased by 0.2 seconds' },
    { level: 3, description: 'Base damage increased by 5%' },
    { level: 4, description: 'Base range increased by 5%' },
    {
      level: 5,
      description:
        'Magic Missile now causes a small explosion on impact, damaging nearby enemies in a splash radius',
    },
    { level: 6, description: 'Cooldown decreased by 0.2 seconds' },
    { level: 7, description: 'Base damage increased by 10%' },
    { level: 8, description: 'Base range increased by 10%' },
    { level: 9, description: 'Cooldown decreased by 0.2 seconds' },
    {
      level: 10,
      description:
        'Missiles that hit an enemy release smaller magic missiles that blast out from the impact zone and explode.',
    },
    { level: 11, description: 'Cooldown decreased by 0.4 seconds' },
    { level: 12, description: 'Base damage increased by 50%' },
    { level: 13, description: 'Base range increased by 50%' },
    {
      level: 14,
      description: 'Magic missiles home in on nearby enemies.',
    },
    {
      level: 15,
      description:
        'All cooldown removed. Damage ×3. Range becomes infinite. Bosses are Slowed on hit. Enemy deaths trigger a magic shockwave that inflicts Magic Burn on nearby foes.',
    },
  ],
  renderIcon: renderMagicMissileIcon,
};
