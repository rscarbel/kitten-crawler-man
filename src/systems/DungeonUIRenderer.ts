/**
 * DungeonUIRenderer — stateless rendering functions extracted from DungeonScene.
 * Each function is a pure draw call with no side effects on game state.
 */

import { TILE_SIZE } from '../core/constants';
import { platform } from '../core/Platform';
import type { Player } from '../Player';
import type { Mob } from '../creatures/Mob';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { MiniMapSystem } from './MiniMapSystem';
import type { MobileTouchState } from '../core/MobileTouchState';
import type { CompanionSystem } from './CompanionSystem';
import type { MongoSystem } from './MongoSystem';
import type { InventoryPanel } from '../ui/InventoryPanel';
import type { GearPanel } from '../ui/GearPanel';
import type { PlayerManager } from '../core/PlayerManager';

export type Rect = { x: number; y: number; w: number; h: number };

/** Compute the pause button rectangle based on minimap size. */
export function pauseButtonRect(canvas: HTMLCanvasElement, miniMap: MiniMapSystem): Rect {
  const mmSize = miniMap.isExpanded ? miniMap.EXPANDED_SIZE : miniMap.NORMAL_SIZE;
  return {
    x: canvas.width - 88,
    y: 8 + mmSize + 20,
    w: 80,
    h: 28,
  };
}

export function drawPauseButton(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  miniMap: MiniMapSystem,
  gameOver: boolean,
  pauseOpen: boolean,
): void {
  if (gameOver || pauseOpen) return;
  const pb = pauseButtonRect(canvas, miniMap);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(pb.x, pb.y, pb.w, pb.h);
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1;
  ctx.strokeRect(pb.x, pb.y, pb.w, pb.h);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(platform.pauseButtonLabel, pb.x + pb.w / 2, pb.y + pb.h / 2 + 4);
  ctx.textAlign = 'left';
}

export function renderHealthVignette(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  activePlayer: Player,
  gameOver: boolean,
): void {
  if (gameOver) return;
  const ratio = activePlayer.hp / activePlayer.maxHp;
  if (ratio >= 0.25) return;

  const cw = canvas.width;
  const ch = canvas.height;

  let alpha: number;
  if (ratio < 0.1) {
    alpha = 0.3 + 0.45 * (0.5 + 0.5 * Math.sin(Date.now() / 120));
  } else {
    alpha = 0.1 + 0.25 * (1 - (ratio - 0.1) / 0.15);
  }

  const grad = ctx.createRadialGradient(
    cw / 2,
    ch / 2,
    Math.min(cw, ch) * 0.25,
    cw / 2,
    ch / 2,
    Math.max(cw, ch) * 0.85,
  );
  grad.addColorStop(0, 'rgba(220,0,0,0)');
  grad.addColorStop(1, `rgba(220,0,0,${alpha.toFixed(3)})`);

  ctx.save();
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cw, ch);
  ctx.restore();
}

export function renderLevelTimer(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  miniMap: MiniMapSystem,
  timerFrames: number,
): void {
  const totalSec = Math.max(0, Math.ceil(timerFrames / 60));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const display = `${min}:${sec.toString().padStart(2, '0')}`;

  const urgent = totalSec <= 60;
  const warning = totalSec <= 300;

  const mmSize = miniMap.isExpanded ? miniMap.EXPANDED_SIZE : miniMap.NORMAL_SIZE;
  const w = 80;
  const h = 28;
  const x = canvas.width - w - 88;
  const y = 8 + mmSize + 20;

  const urgentAlpha = urgent ? 0.85 + Math.sin(Date.now() / 160) * 0.12 : 0.75;
  ctx.fillStyle = urgent
    ? `rgba(100,0,0,${urgentAlpha})`
    : warning
      ? 'rgba(80,40,0,0.85)'
      : 'rgba(0,0,0,0.65)';
  ctx.fillRect(x, y, w, h);

  ctx.strokeStyle = urgent ? '#ef4444' : warning ? '#f59e0b' : '#475569';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '9px monospace';
  ctx.fillText('TIME REMAINING', x + w / 2, y + 12);

  ctx.fillStyle = urgent ? '#f87171' : warning ? '#fbbf24' : '#e2e8f0';
  ctx.font = 'bold 17px monospace';
  ctx.fillText(display, x + w / 2, y + 29);
  ctx.textAlign = 'left';
}

export function renderLevelUpFlash(
  ctx: CanvasRenderingContext2D,
  camX: number,
  camY: number,
  pm: PlayerManager,
): void {
  for (const p of pm.players()) {
    if (p.levelUpFlash <= 0 || !p.levelUpStat) continue;
    const alpha = p.levelUpFlash / 120;
    const rise = (1 - alpha) * 28;
    const sx = p.x - camX + TILE_SIZE / 2;
    const sy = p.y - camY - 12 - rise;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#facc15';
    ctx.fillText(`LEVEL UP! +${p.levelUpStat}`, sx, sy);
    ctx.restore();
    ctx.textAlign = 'left';
  }
}

export function renderEntityTooltip(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  camX: number,
  camY: number,
  mouseX: number,
  mouseY: number,
  mobs: Mob[],
): void {
  const wx = mouseX + camX;
  const wy = mouseY + camY;

  let hovered: Mob | null = null;
  for (const mob of mobs) {
    if (!mob.isAlive) continue;
    if (wx >= mob.x && wx <= mob.x + TILE_SIZE && wy >= mob.y && wy <= mob.y + TILE_SIZE) {
      hovered = mob;
      break;
    }
  }

  if (!hovered) return;

  const name = hovered.displayName;
  const desc = hovered.description;

  const PAD = 8;
  const LINE_GAP = 4;
  ctx.font = 'bold 13px sans-serif';
  const nameW = ctx.measureText(name).width;
  ctx.font = '11px sans-serif';
  const descW = ctx.measureText(desc).width;
  const boxW = Math.max(nameW, descW) + PAD * 2;
  const boxH = 13 + LINE_GAP + 11 + PAD * 2;

  let tx = mouseX + 12;
  let ty = mouseY - boxH - 8;
  if (tx + boxW > canvas.width - 4) tx = canvas.width - boxW - 4;
  if (ty < 4) ty = mouseY + 20;

  ctx.save();
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = '#1a1a2e';
  ctx.strokeStyle = hovered.isHostile ? '#ef4444' : '#4ade80';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(tx, ty, boxW, boxH, 4);
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.font = 'bold 13px sans-serif';
  ctx.fillStyle = hovered.isHostile ? '#fca5a5' : '#86efac';
  ctx.fillText(name, tx + PAD, ty + PAD + 12);

  if (desc) {
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#d1d5db';
    ctx.fillText(desc, tx + PAD, ty + PAD + 12 + LINE_GAP + 11);
  }

  ctx.restore();
}

export interface MobileButtonState {
  human: HumanPlayer;
  cat: CatPlayer;
  miniMap: MiniMapSystem;
  companion: CompanionSystem;
  mongoSystem: MongoSystem;
  inventoryPanel: InventoryPanel;
  gearPanel: GearPanel;
}

export function renderMobileButtons(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  touch: MobileTouchState,
  state: MobileButtonState,
): void {
  const SLOT_H = 52;
  const BOTTOM_MARGIN = 12;
  const BTN_W = 80;
  const BTN_H = 52;
  const MARGIN = 10;
  const btnY = canvas.height - SLOT_H - BOTTOM_MARGIN - BTN_H - 8;

  touch.switchBtnRect = { x: MARGIN, y: btnY, w: BTN_W, h: BTN_H };
  touch.followBtnRect = {
    x: canvas.width - MARGIN - BTN_W,
    y: btnY,
    w: BTN_W,
    h: BTN_H,
  };

  const mmSize = state.miniMap.isExpanded ? state.miniMap.EXPANDED_SIZE : state.miniMap.NORMAL_SIZE;
  const rightX = canvas.width - 88;
  const pauseY = 8 + mmSize + 20;
  const achieveY = pauseY + 28 + 6;
  const gearY = achieveY + 26 + 6;
  touch.gearBtnRect = { x: rightX, y: gearY, w: 80, h: 28 };
  touch.bagBtnRect = { x: rightX, y: gearY + 34, w: 80, h: 28 };

  const drawBtn = (r: Rect, icon: string, label: string, active: boolean) => {
    ctx.fillStyle = active ? 'rgba(250,204,21,0.25)' : 'rgba(0,0,0,0.65)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = active ? '#facc15' : '#475569';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.textAlign = 'center';
    ctx.font = 'bold 20px monospace';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(icon, r.x + r.w / 2, r.y + r.h / 2 + 2);
    ctx.font = '9px monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h - 6);
    ctx.textAlign = 'left';
  };

  const drawSmallBtn = (r: Rect, label: string, active: boolean) => {
    ctx.fillStyle = active ? 'rgba(59,130,246,0.35)' : 'rgba(0,0,0,0.65)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = active ? '#3b82f6' : '#475569';
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 4);
    ctx.textAlign = 'left';
  };

  const humanActive = state.human.isActive;
  drawBtn(touch.switchBtnRect, humanActive ? '🐱' : '🧍', humanActive ? 'Cat' : 'Human', false);
  drawBtn(touch.followBtnRect, '↩', 'Follow', state.companion.isFollowOverride);
  drawSmallBtn(touch.gearBtnRect, 'Gear', state.gearPanel.isOpen);
  drawSmallBtn(touch.bagBtnRect, 'Bag', state.inventoryPanel.isOpen);

  // Mongo summon button — above the switch button when cat is active
  if (state.mongoSystem.canShow && state.cat.isActive) {
    const summonY = btnY - BTN_H - 6;
    touch.summonBtnRect = state.mongoSystem.renderSummonButton(
      ctx,
      MARGIN,
      summonY,
      BTN_W,
      BTN_H,
      state.cat.isActive,
    );
  } else {
    touch.summonBtnRect = { x: -9999, y: 0, w: 0, h: 0 };
  }
}
