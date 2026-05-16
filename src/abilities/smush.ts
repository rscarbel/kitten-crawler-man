import type { AbilityDef } from '../core/AbilityManager';
import { drawSpriteKey } from '../core/SpriteRenderer';

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
  // Cooldown: 10s base (600 frames), -1s at levels 2, 6, 9, 11
  let cooldownFrames = 600;
  if (level >= 2) cooldownFrames -= 60;
  if (level >= 6) cooldownFrames -= 60;
  if (level >= 9) cooldownFrames -= 60;
  if (level >= 11) cooldownFrames -= 60;

  // Base damage = 5× melee; multiplied by cumulative perks
  let damageMultiplier = 5.0;
  if (level >= 3) damageMultiplier *= 1.1;
  if (level >= 7) damageMultiplier *= 1.2;
  if (level >= 12) damageMultiplier *= 1.5;
  if (level >= 15) damageMultiplier *= 3.0;

  // Outer ring: 3× melee base (unchanged by level perks)
  const outerDamageMultiplier = 3.0;

  // Blast radius: 2.5 tiles inner, +0.5 at L8, +0.5 at L13, ×2 at L15
  let innerBlastRadius = 2.5;
  if (level >= 8) innerBlastRadius += 0.5;
  if (level >= 13) innerBlastRadius += 0.5;
  if (level >= 15) innerBlastRadius *= 2.0;

  // Outer ring is 1 tile beyond inner radius
  const outerBlastRadius = innerBlastRadius + 1.0;

  // Level 4: +20% damage vs bosses
  const bossDamageMultiplier = level >= 4 ? 1.2 : 1.0;

  return {
    cooldownFrames,
    damageMultiplier,
    outerDamageMultiplier,
    innerBlastRadius,
    outerBlastRadius,
    bossDamageMultiplier,
    stunSmallEnemies: level >= 5,
    healOnHit: level >= 10,
    doubleGoldOnKill: level >= 14,
    stunBossChance: level >= 14 ? 0.25 : 0,
    isFullPower: level >= 15,
  };
}

function renderSmushIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  level: number,
): void {
  const state = level >= 15 ? 'full_power' : 'standard';
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
