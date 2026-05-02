import type { AbilityDef } from '../core/AbilityManager';

/** Runtime stats computed from the current ability level. */
export interface ProtectiveShellStats {
  /** Shell radius in tiles: 3 → 4 → 5. */
  radiusTiles: number;
  /** How long the shell lasts in frames. */
  durationFrames: number;
  /** Frames between casts. */
  cooldownFrames: number;
  /** Level ≥ 5: enemies caught inside the expanding shell are damaged. */
  expandDamageEnabled: boolean;
  /** Damage dealt on expansion (cumulative multipliers). */
  expandDamage: number;
  /** Healing rate multiplier for allies inside the shell. 1 = normal. */
  allyHealingMultiplier: number;
  /** Level ≥ 14: shell boundary continuously damages enemies. */
  continuousDamageEnabled: boolean;
  /** Level ≥ 14: allies that leave the shell get a personal mini-shield for 3 seconds. */
  miniShieldEnabled: boolean;
  /** Level ≥ 15: full power — instant ally heal, magic immunity, chain lightning on kills, electric shockwave on expiry. */
  isFullPower: boolean;
}

export function getProtectiveShellStats(level: number): ProtectiveShellStats {
  // Radius: 3 base, 4 at L3, 5 at L8
  let radiusTiles = 3;
  if (level >= 8) radiusTiles = 5;
  else if (level >= 3) radiusTiles = 4;

  // Duration (frames): 1200 base, +120 at L4, +240 at L13 (cumulative)
  let durationFrames = 1200;
  if (level >= 4) durationFrames += 120;
  if (level >= 13) durationFrames += 240;

  // Cooldown (frames): 7200 base, reductions stack
  let cooldownFrames = 7200;
  if (level >= 2) cooldownFrames -= 300;
  if (level >= 6) cooldownFrames -= 360;
  if (level >= 9) cooldownFrames -= 420;
  if (level >= 11) cooldownFrames -= 480;

  // Expand damage: 3 base; ×1.25 at L7 = 4; ×2.0 at L12 → 3 * 1.25 * 2.0 = 7.5 → round = 8
  let expandDamage = 3;
  if (level >= 12) expandDamage = Math.round(3 * 1.25 * 2.0);
  else if (level >= 7) expandDamage = Math.round(3 * 1.25);

  return {
    radiusTiles,
    durationFrames,
    cooldownFrames,
    expandDamageEnabled: level >= 5,
    expandDamage,
    allyHealingMultiplier: level >= 10 ? 5 : 1,
    continuousDamageEnabled: level >= 14,
    miniShieldEnabled: level >= 14,
    isFullPower: level >= 15,
  };
}

function renderProtectiveShellIcon(
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
    // Level 15: blazing orange energy
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.45);
    grad.addColorStop(0, 'rgba(255, 220, 80, 1.0)');
    grad.addColorStop(0.4, 'rgba(255, 140, 0, 0.8)');
    grad.addColorStop(1, 'rgba(200, 60, 0, 0)');
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Outer ring
    ctx.strokeStyle = '#ff8c00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.42, 0, Math.PI * 2);
    ctx.stroke();

    // Inner ring
    ctx.strokeStyle = '#fd7c0a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.28, 0, Math.PI * 2);
    ctx.stroke();

    // Center dot
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.1, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Standard blue shield
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.45);
    grad.addColorStop(0, 'rgba(147, 197, 253, 0.9)');
    grad.addColorStop(0.5, 'rgba(59, 130, 246, 0.6)');
    grad.addColorStop(1, 'rgba(29, 78, 216, 0)');
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Outer ring
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.42, 0, Math.PI * 2);
    ctx.stroke();

    // Inner ring
    ctx.strokeStyle = '#93c5fd';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.28, 0, Math.PI * 2);
    ctx.stroke();

    // Center dot
    ctx.fillStyle = '#e0f2fe';
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }
}

export const PROTECTIVE_SHELL_DEF: AbilityDef = {
  id: 'protective_shell',
  name: 'Protective Shell',
  owner: 'human',
  equipInstructions: 'Switch to Human (Tab) then press E to cast',
  baseXpToLevel2: 120,
  xpGrowthRate: 1.2,
  finalLevelMultiplier: 1.5,
  usageXp: 3,
  killXp: 25,
  maxLevel: 15,
  perks: [
    {
      level: 1,
      description:
        'Protective Shell: Summons a circle of magical protection around you. All corporeal enemies are repelled from the boundary.',
    },
    { level: 2, description: 'Cooldown decreased by 5 seconds' },
    { level: 3, description: 'Shell radius increased by 33%' },
    { level: 4, description: 'Duration increased by 2 seconds' },
    {
      level: 5,
      description: 'Enemies caught inside the shell when it expands are damaged.',
    },
    { level: 6, description: 'Cooldown decreased by 6 seconds' },
    { level: 7, description: 'Shell expansion damage increased by 25%' },
    { level: 8, description: 'Shell radius increased by 33%' },
    { level: 9, description: 'Cooldown decreased by 7 seconds' },
    {
      level: 10,
      description: 'All allies within the shell receive 5× healing rate while the shell is active',
    },
    { level: 11, description: 'Cooldown decreased by 8 seconds' },
    { level: 12, description: 'Shell expansion damage increased by 100%' },
    { level: 13, description: 'Duration increased by 4 seconds' },
    {
      level: 14,
      description:
        "Shell continuously damages enemies on the boundary. Allies that exit the shell's boundary receive a personal mini-shield that follows them for 3 seconds.",
    },
    {
      level: 15,
      description:
        'On cast, allies are instantly healed to full health and all status effects are cleared. Grants protection against magic attacks. Enemies that die inside trigger chain lightning to nearby foes. Upon expiry, an electric shock wave applies Electrified to nearby enemies, damaging and slowing them over time.',
    },
  ],
  renderIcon: renderProtectiveShellIcon,
};
