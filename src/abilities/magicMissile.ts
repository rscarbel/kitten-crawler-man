import type { AbilityDef } from '../core/AbilityManager';

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
  if (level >= 15) cooldownFrames = 0;
  else if (level >= 11) cooldownFrames = 12;
  else if (level >= 9) cooldownFrames = 36;
  else if (level >= 6) cooldownFrames = 48;
  else if (level >= 2) cooldownFrames = 60;
  else cooldownFrames = 72;

  // Cumulative damage multipliers (multiplicative stacking):
  //   L3: ×1.05   L7: ×1.10   L12: ×1.50   L15: ×3.00
  let damageMultiplier = 1.0;
  if (level >= 3) damageMultiplier *= 1.05;
  if (level >= 7) damageMultiplier *= 1.1;
  if (level >= 12) damageMultiplier *= 1.5;
  if (level >= 15) damageMultiplier *= 3.0;

  // Cumulative range multipliers:
  //   L4: ×1.05   L8: ×1.10   L13: ×1.50   L15: effectively infinite
  let rangeMultiplier = 1.0;
  if (level >= 4) rangeMultiplier *= 1.05;
  if (level >= 8) rangeMultiplier *= 1.1;
  if (level >= 13) rangeMultiplier *= 1.5;
  if (level >= 15) rangeMultiplier = 9999;

  const speed = level >= 15 ? 9.0 : 4.5;

  return {
    cooldownFrames,
    damageMultiplier,
    rangeMultiplier,
    speed,
    hasAoeSplash: level >= 5,
    hasSubMissiles: level >= 10,
    hasHoming: level >= 14,
    isFullPower: level >= 15,
  };
}

function renderMagicMissileIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  level: number,
): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const isFullPower = level >= 15;

  if (isFullPower) {
    // Level 15: orange beam
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.45);
    grad.addColorStop(0, 'rgba(255, 220, 100, 1.0)');
    grad.addColorStop(0.4, 'rgba(255, 120, 0, 0.8)');
    grad.addColorStop(1, 'rgba(180, 40, 0, 0)');
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.fillStyle = '#fff8e0';
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.12, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Standard purple missile
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.45);
    grad.addColorStop(0, 'rgba(230, 190, 255, 0.95)');
    grad.addColorStop(0.5, 'rgba(150, 70, 240, 0.65)');
    grad.addColorStop(1, 'rgba(80, 0, 180, 0)');
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.fillStyle = '#f0e0ff';
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }
}

export const MAGIC_MISSILE_DEF: AbilityDef = {
  id: 'magic_missile',
  name: 'Magic Missile',
  owner: 'cat',
  equipInstructions: 'Switch to Cat (Tab) then press Space to fire',
  baseXpToLevel2: 100,
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
