import type { Player } from '../Player';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';

/**
 * Draws the top-left HUD panel: active-character label, control hints,
 * HP/XP bars for both characters, and the skill-point notification banner.
 *
 * @param pulseRef - Mutable object holding the oscillation counter for the
 *   notification pulse. Pass `{ value: 0 }` from the scene and keep it stable.
 */
export function drawHUD(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  human: HumanPlayer,
  cat: CatPlayer,
  pulseRef: { value: number },
): void {
  const activeLabel = human.isActive ? 'Human' : 'Cat (Donut)';
  const inactiveLabel = human.isActive ? 'Cat' : 'Human';
  const atkLabel = human.isActive ? 'Punch / Kick' : 'Magic Missile';

  const activePlayer = human.isActive ? human : cat;
  const inactivePlayer = human.isActive ? cat : human;

  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(8, 8, 340, 176);

  ctx.fillStyle = '#facc15';
  ctx.font = 'bold 13px monospace';
  ctx.fillText(`Playing as: ${activeLabel}`, 16, 28);

  ctx.fillStyle = '#e2e8f0';
  ctx.font = '12px monospace';
  ctx.fillText('WASD/Arrows: Move  |  Tab: Switch', 16, 46);
  ctx.fillText(`Space: ${atkLabel}  |  Q: Potion`, 16, 62);

  drawHUDPlayerBlock(ctx, activeLabel, activePlayer, 16, 74);
  drawHUDPlayerBlock(ctx, inactiveLabel, inactivePlayer, 16, 128);

  renderNotification(ctx, human, cat, pulseRef);
}

export function drawHUDPlayerBlock(
  ctx: CanvasRenderingContext2D,
  label: string,
  player: HumanPlayer | CatPlayer,
  x: number,
  y: number,
): void {
  const barX = x + 88;
  const barW = 90;
  const barH = 7;

  // HP bar
  const hpRatio = player.hp / player.maxHp;
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px monospace';
  ctx.fillText(`${label} Lv${player.level}:`, x, y + barH);

  ctx.fillStyle = '#374151';
  ctx.fillRect(barX, y, barW, barH);
  ctx.fillStyle =
    hpRatio > 0.5 ? '#4ade80' : hpRatio > 0.25 ? '#facc15' : '#ef4444';
  ctx.fillRect(barX, y, Math.ceil(barW * hpRatio), barH);

  ctx.fillStyle = '#e2e8f0';
  ctx.font = '10px monospace';
  ctx.fillText(`${player.hp}/${player.maxHp}`, barX + barW + 4, y + barH);

  // XP bar
  const xpNeeded = player.level * 10;
  const xpRatio = Math.min(1, player.xp / xpNeeded);
  const y2 = y + 14;

  ctx.fillStyle = '#64748b';
  ctx.font = '10px monospace';
  ctx.fillText('XP:', x, y2 + barH);

  ctx.fillStyle = '#1e293b';
  ctx.fillRect(barX, y2, barW, barH);
  ctx.fillStyle = '#818cf8';
  ctx.fillRect(barX, y2, Math.ceil(barW * xpRatio), barH);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px monospace';
  ctx.fillText(`${player.xp}/${xpNeeded}`, barX + barW + 4, y2 + barH);

  // Stats + potions
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '10px monospace';
  ctx.fillText(
    `STR:${player.strength}  INT:${player.intelligence}  HP:${player.constitution}  🧪${player.healthPotions}`,
    barX,
    y2 + barH + 12,
  );
}

/**
 * Pulsing skill-point notification banner rendered below the HUD panel.
 * Previously defined in GameStage but never wired to the render path — now fixed.
 */
function renderNotification(
  ctx: CanvasRenderingContext2D,
  human: Player,
  cat: Player,
  pulseRef: { value: number },
): void {
  if (human.unspentPoints <= 0 && cat.unspentPoints <= 0) return;
  pulseRef.value = (pulseRef.value + 0.055) % (Math.PI * 2);
  const alpha = 0.65 + Math.sin(pulseRef.value) * 0.28;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#1e3a5f';
  ctx.fillRect(8, 192, 340, 20);
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 1;
  ctx.strokeRect(8, 192, 340, 20);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#93c5fd';
  ctx.font = '10px monospace';
  ctx.fillText(
    'Skill points available! Open menu (Esc) to spend them.',
    14,
    206,
  );
  ctx.restore();
}
