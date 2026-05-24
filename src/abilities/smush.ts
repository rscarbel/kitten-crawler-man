import type { AbilityDef } from '../core/AbilityManager';
import { drawSpriteKey } from '../core/SpriteRenderer';

const SMUSH_BASE_COOLDOWN = 600;
const SMUSH_COOLDOWN_DECREMENT = 60;
const SMUSH_LEVEL_COOLDOWN_2 = 2;
const SMUSH_LEVEL_COOLDOWN_3 = 6;
const SMUSH_LEVEL_COOLDOWN_4 = 9;
const SMUSH_LEVEL_COOLDOWN_5 = 11;
const SMUSH_BASE_DAMAGE_MULT = 5.0;
const SMUSH_LEVEL_DAMAGE_BOOST_1 = 3;
const SMUSH_LEVEL_DAMAGE_BOOST_2 = 7;
const SMUSH_LEVEL_DAMAGE_BOOST_3 = 12;
const SMUSH_LEVEL_FULL_POWER = 15;
const SMUSH_DAMAGE_MULT_L3 = 1.1;
const SMUSH_DAMAGE_MULT_L7 = 1.2;
const SMUSH_DAMAGE_MULT_L12 = 1.5;
const SMUSH_DAMAGE_MULT_L15 = 3.0;
const SMUSH_OUTER_DAMAGE_MULT = 3.0;
const SMUSH_BASE_INNER_RADIUS = 2.5;
const SMUSH_LEVEL_RADIUS_BOOST_1 = 8;
const SMUSH_LEVEL_RADIUS_BOOST_2 = 13;
const SMUSH_RADIUS_INCREMENT = 0.5;
const SMUSH_RADIUS_FULL_POWER_MULT = 2.0;
const SMUSH_OUTER_RADIUS_OFFSET = 1.0;
const SMUSH_LEVEL_BOSS_DAMAGE = 4;
const SMUSH_BOSS_DAMAGE_FACTOR = 1.2;
const SMUSH_LEVEL_STUN_SMALL = 5;
const SMUSH_LEVEL_HEAL_ON_HIT = 10;
const SMUSH_LEVEL_DOUBLE_GOLD = 14;
const SMUSH_STUN_BOSS_CHANCE = 0.25;

export interface SmushStats {
  cooldownFrames: number;
  damageMultiplier: number;
  outerDamageMultiplier: number;
  innerBlastRadius: number;
  outerBlastRadius: number;
  bossDamageMultiplier: number;
  stunSmallEnemies: boolean;
  healOnHit: boolean;
  doubleGoldOnKill: boolean;
  stunBossChance: number;
  isFullPower: boolean;
}

export function getSmushStats(level: number): SmushStats {
  let cooldownFrames = SMUSH_BASE_COOLDOWN;
  if (level >= SMUSH_LEVEL_COOLDOWN_2) cooldownFrames -= SMUSH_COOLDOWN_DECREMENT;
  if (level >= SMUSH_LEVEL_COOLDOWN_3) cooldownFrames -= SMUSH_COOLDOWN_DECREMENT;
  if (level >= SMUSH_LEVEL_COOLDOWN_4) cooldownFrames -= SMUSH_COOLDOWN_DECREMENT;
  if (level >= SMUSH_LEVEL_COOLDOWN_5) cooldownFrames -= SMUSH_COOLDOWN_DECREMENT;

  let damageMultiplier = SMUSH_BASE_DAMAGE_MULT;
  if (level >= SMUSH_LEVEL_DAMAGE_BOOST_1) damageMultiplier *= SMUSH_DAMAGE_MULT_L3;
  if (level >= SMUSH_LEVEL_DAMAGE_BOOST_2) damageMultiplier *= SMUSH_DAMAGE_MULT_L7;
  if (level >= SMUSH_LEVEL_DAMAGE_BOOST_3) damageMultiplier *= SMUSH_DAMAGE_MULT_L12;
  if (level >= SMUSH_LEVEL_FULL_POWER) damageMultiplier *= SMUSH_DAMAGE_MULT_L15;

  const outerDamageMultiplier = SMUSH_OUTER_DAMAGE_MULT;

  let innerBlastRadius = SMUSH_BASE_INNER_RADIUS;
  if (level >= SMUSH_LEVEL_RADIUS_BOOST_1) innerBlastRadius += SMUSH_RADIUS_INCREMENT;
  if (level >= SMUSH_LEVEL_RADIUS_BOOST_2) innerBlastRadius += SMUSH_RADIUS_INCREMENT;
  if (level >= SMUSH_LEVEL_FULL_POWER) innerBlastRadius *= SMUSH_RADIUS_FULL_POWER_MULT;

  const outerBlastRadius = innerBlastRadius + SMUSH_OUTER_RADIUS_OFFSET;

  const bossDamageMultiplier = level >= SMUSH_LEVEL_BOSS_DAMAGE ? SMUSH_BOSS_DAMAGE_FACTOR : 1.0;

  return {
    cooldownFrames,
    damageMultiplier,
    outerDamageMultiplier,
    innerBlastRadius,
    outerBlastRadius,
    bossDamageMultiplier,
    stunSmallEnemies: level >= SMUSH_LEVEL_STUN_SMALL,
    healOnHit: level >= SMUSH_LEVEL_HEAL_ON_HIT,
    doubleGoldOnKill: level >= SMUSH_LEVEL_DOUBLE_GOLD,
    stunBossChance: level >= SMUSH_LEVEL_DOUBLE_GOLD ? SMUSH_STUN_BOSS_CHANCE : 0,
    isFullPower: level >= SMUSH_LEVEL_FULL_POWER,
  };
}

function renderSmushIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  level: number,
): void {
  const state = level >= SMUSH_LEVEL_FULL_POWER ? 'full_power' : 'standard';
  drawSpriteKey(ctx, 'smush_icon', state, 0, x, y, size);
}

export const SMUSH_DEF: AbilityDef = {
  id: 'smush',
  name: 'Smush',
  owner: 'human',
  equipInstructions: 'Switch to Human (Tab), place tome on hotbar, press key 1–7 to fire',
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
        'Smush: Use the crushing power of your bare feet to pound enemies into the ground with explosive force, causing extremely high damage in a small area.',
    },
    { level: 2, description: 'Cooldown decreased by 1 second' },
    { level: 3, description: 'Base damage increased by 10%' },
    { level: 4, description: 'Damage against bosses increased by 20%' },
    {
      level: 5,
      description: 'Non-lethal hits stun small enemies.',
    },
    { level: 6, description: 'Cooldown decreased by 1 second' },
    { level: 7, description: 'Base damage increased by 20%' },
    { level: 8, description: 'Explosion radius increased by 20%' },
    { level: 9, description: 'Cooldown decreased by 1 second' },
    {
      level: 10,
      description: 'There is a 20% chance the player will be healed for 50% of the damage dealt.',
    },
    { level: 11, description: 'Cooldown decreased by 1 second' },
    { level: 12, description: 'Base damage increased by 50%' },
    { level: 13, description: 'Explosion radius increased by 20%' },
    {
      level: 14,
      description:
        'Killing an enemy with Smush doubles the gold they drop. Additionally, Bosses now have a 25% chance of getting stunned.',
    },
    {
      level: 15,
      description:
        'Damage increased 300%. Blast radius increased by 200%. 4x chance of rare items being dropped by enemies killed by Smush, and double the drop rate of all gold and supplies. Healing effect also applies to any nearby allies.',
    },
  ],
  renderIcon: renderSmushIcon,
};
