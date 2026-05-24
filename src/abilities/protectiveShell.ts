import type { AbilityDef } from '../core/AbilityManager';

// Level thresholds
const LEVEL_3 = 3;
const LEVEL_4 = 4;
const LEVEL_5 = 5;
const LEVEL_6 = 6;
const LEVEL_7 = 7;
const LEVEL_8 = 8;
const LEVEL_9 = 9;
const LEVEL_10 = 10;
const LEVEL_11 = 11;
const LEVEL_12 = 12;
const LEVEL_13 = 13;
const LEVEL_14 = 14;
const LEVEL_15 = 15;

// Radius levels
const RADIUS_BASE = 3;
const RADIUS_LEVEL_3 = 4;
const RADIUS_LEVEL_8 = 5;

// Duration (frames)
const DURATION_BASE = 1200;
const DURATION_INCREMENT_LEVEL_4 = 120;
const DURATION_INCREMENT_LEVEL_13 = 240;

// Cooldown (frames)
const COOLDOWN_BASE = 7200;
const COOLDOWN_REDUCE_LEVEL_2 = 300;
const COOLDOWN_REDUCE_LEVEL_6 = 360;
const COOLDOWN_REDUCE_LEVEL_9 = 420;
const COOLDOWN_REDUCE_LEVEL_11 = 480;

// Expand damage
const EXPAND_DAMAGE_BASE = 3;
const EXPAND_DAMAGE_MULT_LEVEL_7 = 1.25;
const EXPAND_DAMAGE_MULT_LEVEL_12 = 2.0;

// Healing multiplier
const ALLY_HEALING_MULTIPLIER_BONUS = 5;

// Icon rendering
const ICON_CENTER = 0.5;
const ICON_OUTER_RADIUS = 0.45;
const ICON_OUTER_RING_RADIUS = 0.42;
const ICON_INNER_RING_RADIUS = 0.28;
const ICON_CENTER_DOT_RADIUS = 0.1;
const ICON_GRADIENT_STOP_1 = 0.4;
const ICON_GRADIENT_STOP_2 = 0.5;
const ICON_STROKE_WIDTH_OUTER = 2;
const ICON_STROKE_WIDTH_INNER = 1.5;

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
  let radiusTiles = RADIUS_BASE;
  if (level >= LEVEL_8) radiusTiles = RADIUS_LEVEL_8;
  else if (level >= LEVEL_3) radiusTiles = RADIUS_LEVEL_3;

  // Duration (frames): 1200 base, +120 at L4, +240 at L13 (cumulative)
  let durationFrames = DURATION_BASE;
  if (level >= LEVEL_4) durationFrames += DURATION_INCREMENT_LEVEL_4;
  if (level >= LEVEL_13) durationFrames += DURATION_INCREMENT_LEVEL_13;

  // Cooldown (frames): 7200 base, reductions stack
  let cooldownFrames = COOLDOWN_BASE;
  if (level >= 2) cooldownFrames -= COOLDOWN_REDUCE_LEVEL_2;
  if (level >= LEVEL_6) cooldownFrames -= COOLDOWN_REDUCE_LEVEL_6;
  if (level >= LEVEL_9) cooldownFrames -= COOLDOWN_REDUCE_LEVEL_9;
  if (level >= LEVEL_11) cooldownFrames -= COOLDOWN_REDUCE_LEVEL_11;

  // Expand damage: 3 base; ×1.25 at L7 = 4; ×2.0 at L12 → 3 * 1.25 * 2.0 = 7.5 → round = 8
  let expandDamage = EXPAND_DAMAGE_BASE;
  if (level >= LEVEL_12)
    expandDamage = Math.round(
      EXPAND_DAMAGE_BASE * EXPAND_DAMAGE_MULT_LEVEL_7 * EXPAND_DAMAGE_MULT_LEVEL_12,
    );
  else if (level >= LEVEL_7)
    expandDamage = Math.round(EXPAND_DAMAGE_BASE * EXPAND_DAMAGE_MULT_LEVEL_7);

  return {
    radiusTiles,
    durationFrames,
    cooldownFrames,
    expandDamageEnabled: level >= LEVEL_5,
    expandDamage,
    allyHealingMultiplier: level >= LEVEL_10 ? ALLY_HEALING_MULTIPLIER_BONUS : 1,
    continuousDamageEnabled: level >= LEVEL_14,
    miniShieldEnabled: level >= LEVEL_14,
    isFullPower: level >= LEVEL_15,
  };
}

function renderProtectiveShellIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  level: number,
): void {
  const cx = x + size * ICON_CENTER;
  const cy = y + size * ICON_CENTER;
  const isFullPower = level >= LEVEL_15;

  if (isFullPower) {
    // Level 15: blazing orange energy
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * ICON_OUTER_RADIUS);
    grad.addColorStop(0, 'rgba(255, 220, 80, 1.0)');
    grad.addColorStop(ICON_GRADIENT_STOP_1, 'rgba(255, 140, 0, 0.8)');
    grad.addColorStop(1, 'rgba(200, 60, 0, 0)');
    ctx.beginPath();
    ctx.arc(cx, cy, size * ICON_OUTER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Outer ring
    ctx.strokeStyle = '#ff8c00';
    ctx.lineWidth = ICON_STROKE_WIDTH_OUTER;
    ctx.beginPath();
    ctx.arc(cx, cy, size * ICON_OUTER_RING_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    // Inner ring
    ctx.strokeStyle = '#fd7c0a';
    ctx.lineWidth = ICON_STROKE_WIDTH_INNER;
    ctx.beginPath();
    ctx.arc(cx, cy, size * ICON_INNER_RING_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    // Center dot
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(cx, cy, size * ICON_CENTER_DOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Standard blue shield
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * ICON_OUTER_RADIUS);
    grad.addColorStop(0, 'rgba(147, 197, 253, 0.9)');
    grad.addColorStop(ICON_GRADIENT_STOP_2, 'rgba(59, 130, 246, 0.6)');
    grad.addColorStop(1, 'rgba(29, 78, 216, 0)');
    ctx.beginPath();
    ctx.arc(cx, cy, size * ICON_OUTER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Outer ring
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = ICON_STROKE_WIDTH_OUTER;
    ctx.beginPath();
    ctx.arc(cx, cy, size * ICON_OUTER_RING_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    // Inner ring
    ctx.strokeStyle = '#93c5fd';
    ctx.lineWidth = ICON_STROKE_WIDTH_INNER;
    ctx.beginPath();
    ctx.arc(cx, cy, size * ICON_INNER_RING_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    // Center dot
    ctx.fillStyle = '#e0f2fe';
    ctx.beginPath();
    ctx.arc(cx, cy, size * ICON_CENTER_DOT_RADIUS, 0, Math.PI * 2);
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
