/**
 * Simple canvas-drawn figures for the Desperado Club's cosmetic NPCs and
 * station staff. Deliberately lightweight (primitive shapes, no sprite sheet)
 * so Phase 1 doesn't block on bespoke art — the neon-knife/art-deco sprite
 * upgrade is a later polish pass.
 */

export type ClubNpcVariant =
  | 'sledge'
  | 'dj'
  | 'dancer'
  | 'bartender'
  | 'dealer'
  | 'merchant'
  | 'rosemarie'
  | 'vip';

interface ClubNpcStyle {
  skin: string;
  outfit: string;
  accent: string;
  /** Cretin bouncers (Sledge/Bomo) are broad, stone-grey, and tuxedoed. */
  stocky?: boolean;
  /** Doctor Bones is a skeleton — bone-white head, dark eye sockets. */
  skeleton?: boolean;
}

const STYLES: Record<ClubNpcVariant, ClubNpcStyle> = {
  sledge: { skin: '#8b8f96', outfit: '#14141a', accent: '#c8a840', stocky: true },
  dj: { skin: '#e8e6de', outfit: '#2a1a3a', accent: '#e0407a', skeleton: true },
  dancer: { skin: '#d8a878', outfit: '#c0307a', accent: '#40d0e0' },
  bartender: { skin: '#c89068', outfit: '#3a1f14', accent: '#e4d8b0' },
  dealer: { skin: '#caa080', outfit: '#14322a', accent: '#e0c060' },
  merchant: { skin: '#b88858', outfit: '#4a2a5a', accent: '#e0b040' },
  rosemarie: { skin: '#d8b088', outfit: '#5a2a2a', accent: '#e0a040' },
  vip: { skin: '#d0a070', outfit: '#1a1a3a', accent: '#c8a840' },
};

const BOB_SPEED = 0.06;
const BOB_AMOUNT = 0.03;
const DANCER_SWAY = 0.08;

/**
 * Draws a club NPC standing at (sx, sy) sized to `s` pixels. `phase` advances
 * the idle bob (dancers sway more energetically). `facingX < 0` mirrors.
 */
export function drawClubNpc(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  variant: ClubNpcVariant,
  phase: number,
  facingX = 1,
): void {
  const style = STYLES[variant];
  ctx.save();

  const isDancer = variant === 'dancer';
  const bobAmp = isDancer ? DANCER_SWAY : BOB_AMOUNT;
  const bob = Math.sin(phase * BOB_SPEED) * s * bobAmp;
  const bsy = sy + bob;
  const cx = sx + s * 0.5;

  if (facingX < 0) {
    ctx.translate(cx, 0);
    ctx.scale(-1, 1);
    ctx.translate(-cx, 0);
  }

  const bodyHalf = style.stocky ? 0.3 : 0.22;
  const shoulder = style.stocky ? 0.34 : 0.26;

  // Legs
  ctx.fillStyle = '#111116';
  ctx.fillRect(cx - s * 0.16, bsy + s * 0.78, s * 0.13, s * 0.18);
  ctx.fillRect(cx + s * 0.03, bsy + s * 0.78, s * 0.13, s * 0.18);

  // Torso / outfit
  ctx.fillStyle = style.outfit;
  ctx.fillRect(cx - s * bodyHalf, bsy + s * 0.36, s * bodyHalf * 2, s * 0.46);

  // Lapel / accent stripe down the front (tuxedo or dress trim)
  ctx.fillStyle = style.accent;
  ctx.fillRect(cx - s * 0.03, bsy + s * 0.37, s * 0.06, s * 0.42);

  // Arms
  ctx.fillStyle = style.outfit;
  ctx.fillRect(cx - s * shoulder, bsy + s * 0.38, s * 0.1, s * 0.3);
  ctx.fillRect(cx + s * (shoulder - 0.1), bsy + s * 0.38, s * 0.1, s * 0.3);

  // Hands
  ctx.fillStyle = style.skeleton ? '#e8e6de' : style.skin;
  ctx.beginPath();
  ctx.ellipse(cx - s * (shoulder - 0.05), bsy + s * 0.7, s * 0.06, s * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + s * (shoulder - 0.05), bsy + s * 0.7, s * 0.06, s * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = style.skin;
  ctx.beginPath();
  ctx.ellipse(cx, bsy + s * 0.16, s * (style.stocky ? 0.17 : 0.15), s * 0.17, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eyes — dark sockets for the skeleton, small dots otherwise
  if (style.skeleton) {
    ctx.fillStyle = '#0a0a0a';
    ctx.beginPath();
    ctx.ellipse(cx - s * 0.06, bsy + s * 0.14, s * 0.04, s * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + s * 0.06, bsy + s * 0.14, s * 0.04, s * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = '#1a0e04';
    ctx.fillRect(cx - s * 0.08, bsy + s * 0.13, s * 0.04, s * 0.04);
    ctx.fillRect(cx + s * 0.04, bsy + s * 0.13, s * 0.04, s * 0.04);
  }

  // Bow tie for the tuxedoed bouncers
  if (style.stocky) {
    ctx.fillStyle = style.accent;
    ctx.fillRect(cx - s * 0.07, bsy + s * 0.32, s * 0.14, s * 0.05);
  }

  ctx.restore();
}
