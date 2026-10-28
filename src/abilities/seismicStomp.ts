import type { AbilityDef } from '../core/skills/AbilityManager';
import { drawSpriteKey } from '../core/spriteAssets/SpriteRenderer';
import type { Rect } from '../ui/core/geom';
import { iconSquare } from '../ui/icons/iconSquare';

const SEISMIC_STOMP_BASE_COOLDOWN = 600;
const SEISMIC_STOMP_COOLDOWN_DECREMENT = 60;
const SEISMIC_STOMP_LEVEL_COOLDOWN_2 = 2;
const SEISMIC_STOMP_LEVEL_COOLDOWN_3 = 6;
const SEISMIC_STOMP_LEVEL_COOLDOWN_4 = 9;
const SEISMIC_STOMP_LEVEL_COOLDOWN_5 = 11;
const SEISMIC_STOMP_BASE_DAMAGE_MULT = 5.0;
const SEISMIC_STOMP_LEVEL_DAMAGE_BOOST_1 = 3;
const SEISMIC_STOMP_LEVEL_DAMAGE_BOOST_2 = 7;
const SEISMIC_STOMP_LEVEL_DAMAGE_BOOST_3 = 12;
const SEISMIC_STOMP_LEVEL_FULL_POWER = 15;
const SEISMIC_STOMP_DAMAGE_MULT_L3 = 1.1;
const SEISMIC_STOMP_DAMAGE_MULT_L7 = 1.2;
const SEISMIC_STOMP_DAMAGE_MULT_L12 = 1.5;
const SEISMIC_STOMP_DAMAGE_MULT_L15 = 3.0;
const SEISMIC_STOMP_OUTER_DAMAGE_MULT = 3.0;
const SEISMIC_STOMP_BASE_INNER_RADIUS = 2.5;
const SEISMIC_STOMP_LEVEL_RADIUS_BOOST_1 = 8;
const SEISMIC_STOMP_LEVEL_RADIUS_BOOST_2 = 13;
const SEISMIC_STOMP_RADIUS_INCREMENT = 0.5;
const SEISMIC_STOMP_RADIUS_FULL_POWER_MULT = 2.0;
const SEISMIC_STOMP_OUTER_RADIUS_OFFSET = 1.0;
const SEISMIC_STOMP_LEVEL_BOSS_DAMAGE = 4;
const SEISMIC_STOMP_BOSS_DAMAGE_FACTOR = 1.2;
const SEISMIC_STOMP_LEVEL_STUN_SMALL = 5;
const SEISMIC_STOMP_LEVEL_HEAL_ON_HIT = 10;
const SEISMIC_STOMP_LEVEL_DOUBLE_GOLD = 14;
const SEISMIC_STOMP_STUN_BOSS_CHANCE = 0.25;

export interface SeismicStompStats {
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

export function getSeismicStompStats(level: number): SeismicStompStats {
  let cooldownFrames = SEISMIC_STOMP_BASE_COOLDOWN;
  if (level >= SEISMIC_STOMP_LEVEL_COOLDOWN_2) cooldownFrames -= SEISMIC_STOMP_COOLDOWN_DECREMENT;
  if (level >= SEISMIC_STOMP_LEVEL_COOLDOWN_3) cooldownFrames -= SEISMIC_STOMP_COOLDOWN_DECREMENT;
  if (level >= SEISMIC_STOMP_LEVEL_COOLDOWN_4) cooldownFrames -= SEISMIC_STOMP_COOLDOWN_DECREMENT;
  if (level >= SEISMIC_STOMP_LEVEL_COOLDOWN_5) cooldownFrames -= SEISMIC_STOMP_COOLDOWN_DECREMENT;

  let damageMultiplier = SEISMIC_STOMP_BASE_DAMAGE_MULT;
  if (level >= SEISMIC_STOMP_LEVEL_DAMAGE_BOOST_1) damageMultiplier *= SEISMIC_STOMP_DAMAGE_MULT_L3;
  if (level >= SEISMIC_STOMP_LEVEL_DAMAGE_BOOST_2) damageMultiplier *= SEISMIC_STOMP_DAMAGE_MULT_L7;
  if (level >= SEISMIC_STOMP_LEVEL_DAMAGE_BOOST_3)
    damageMultiplier *= SEISMIC_STOMP_DAMAGE_MULT_L12;
  if (level >= SEISMIC_STOMP_LEVEL_FULL_POWER) damageMultiplier *= SEISMIC_STOMP_DAMAGE_MULT_L15;

  const outerDamageMultiplier = SEISMIC_STOMP_OUTER_DAMAGE_MULT;

  let innerBlastRadius = SEISMIC_STOMP_BASE_INNER_RADIUS;
  if (level >= SEISMIC_STOMP_LEVEL_RADIUS_BOOST_1)
    innerBlastRadius += SEISMIC_STOMP_RADIUS_INCREMENT;
  if (level >= SEISMIC_STOMP_LEVEL_RADIUS_BOOST_2)
    innerBlastRadius += SEISMIC_STOMP_RADIUS_INCREMENT;
  if (level >= SEISMIC_STOMP_LEVEL_FULL_POWER)
    innerBlastRadius *= SEISMIC_STOMP_RADIUS_FULL_POWER_MULT;

  const outerBlastRadius = innerBlastRadius + SEISMIC_STOMP_OUTER_RADIUS_OFFSET;

  const bossDamageMultiplier =
    level >= SEISMIC_STOMP_LEVEL_BOSS_DAMAGE ? SEISMIC_STOMP_BOSS_DAMAGE_FACTOR : 1.0;

  return {
    cooldownFrames,
    damageMultiplier,
    outerDamageMultiplier,
    innerBlastRadius,
    outerBlastRadius,
    bossDamageMultiplier,
    stunSmallEnemies: level >= SEISMIC_STOMP_LEVEL_STUN_SMALL,
    healOnHit: level >= SEISMIC_STOMP_LEVEL_HEAL_ON_HIT,
    doubleGoldOnKill: level >= SEISMIC_STOMP_LEVEL_DOUBLE_GOLD,
    stunBossChance: level >= SEISMIC_STOMP_LEVEL_DOUBLE_GOLD ? SEISMIC_STOMP_STUN_BOSS_CHANCE : 0,
    isFullPower: level >= SEISMIC_STOMP_LEVEL_FULL_POWER,
  };
}

function renderSeismicStompIcon(ctx: CanvasRenderingContext2D, rect: Rect, level: number): void {
  const { x, y, size } = iconSquare(rect);
  const state = level >= SEISMIC_STOMP_LEVEL_FULL_POWER ? 'full_power' : 'standard';
  drawSpriteKey(ctx, 'seismic_stomp_icon', state, 0, x, y, size);
}

export const SEISMIC_STOMP_DEF: AbilityDef = {
  id: 'seismic_stomp',
  delivery: 'melee',
  name: 'Seismic Stomp',
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
        'Seismic Stomp: Drive your heel into the floor and send a shockwave through it. Everything close by takes extremely high damage and staggers.',
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
    { level: 8, description: 'Shockwave radius increased by 20%' },
    { level: 9, description: 'Cooldown decreased by 1 second' },
    {
      level: 10,
      description: 'There is a 20% chance the player will be healed for 50% of the damage dealt.',
    },
    { level: 11, description: 'Cooldown decreased by 1 second' },
    { level: 12, description: 'Base damage increased by 50%' },
    { level: 13, description: 'Shockwave radius increased by 20%' },
    {
      level: 14,
      description:
        'Killing an enemy with Seismic Stomp doubles the gold they drop. Additionally, Bosses now have a 25% chance of getting stunned.',
    },
    {
      level: 15,
      description:
        'Damage increased 300%. Shockwave radius increased by 200%. 4x chance of rare items being dropped by enemies killed by Seismic Stomp, and double the drop rate of all gold and supplies. Healing effect also applies to any nearby allies.',
    },
  ],
  renderIcon: renderSeismicStompIcon,
};
