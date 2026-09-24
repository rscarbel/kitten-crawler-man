#!/usr/bin/env tsx
/**
 * Review harness for the pause menu's Crafts tab. Paints it at the same box
 * geometry `PauseMenu` uses, with one crawler mid-progression on both skills
 * and the other only started on one, so the two columns' independence and the
 * card layout are both visible in one picture.
 *
 * Run: npx tsx scripts/render-crafts-tab.ts
 */

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asNodeCanvas, gameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { setViewportSize } from '../src/core/Viewport.js';
import { drawOverlay, drawModal, BOX_PRESETS } from '../src/ui/Box.js';
import { renderCraftsTab } from '../src/ui/pause/CraftsTab.js';
import type { ButtonRect } from '../src/ui/pause/types.js';
import { HumanPlayer } from '../src/creatures/HumanPlayer.js';
import { CatPlayer } from '../src/creatures/CatPlayer.js';
import { TILE_SIZE } from '../src/core/constants.js';

installCanvasGlobals();

const CANVAS_W = 420;
const CANVAS_H = 620;
const MODAL_W = 380;
const MODAL_H = 440;

setViewportSize(CANVAS_W, CANVAS_H);

const human = new HumanPlayer(0, 0, TILE_SIZE);
human.craftSkills.restore({
  resourcing: { learned: true, level: 3, xp: 0 },
  construction: { learned: false, level: 0, xp: 0 },
});

const cat = new CatPlayer(0, 0, TILE_SIZE);
cat.craftSkills.restore({
  resourcing: { learned: true, level: 7, xp: 0 },
  construction: { learned: true, level: 1, xp: 0 },
});

const ctx = gameContext(CANVAS_W, CANVAS_H);

drawOverlay(ctx, { canvasWidth: CANVAS_W, canvasHeight: CANVAS_H, alpha: 0.68 });
const modal = drawModal(ctx, {
  canvasWidth: CANVAS_W,
  canvasHeight: CANVAS_H,
  width: MODAL_W,
  height: MODAL_H,
  ...BOX_PRESETS.modal,
});

const buttons: ButtonRect[] = [];
renderCraftsTab(
  ctx,
  buttons,
  modal.x,
  modal.y,
  MODAL_W,
  MODAL_H,
  (tab) => console.log(`setTab(${tab}) — not wired in this harness`),
  human,
  cat,
  (id) => console.log(`onHowCraftWorks(${id}) — not wired in this harness`),
);

const outPath = writePreviewPng(
  `${PREVIEW_DIR}/crafts-tab.png`,
  asNodeCanvas(ctx.canvas).toBuffer(),
);
console.log(`Wrote ${outPath} (${buttons.length} buttons registered)`);
