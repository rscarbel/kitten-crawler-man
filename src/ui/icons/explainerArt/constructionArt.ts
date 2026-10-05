/**
 * Illustrations for the Construction explainer: the menu's resources, the
 * wall tiers, the siege pieces and a spiked wall, drawn with the world's own art.
 */

import type { IllustrationRect } from './illustration';
import { RESOURCE_IDS } from '../../../core/resourceIds';
import type { PalisadeTier } from '../../../map/tileTypes';
import { PALISADE_DIRS, paintPalisadeForReview } from '../../../map/tiles/hollowPalisadeTiles';
import { TREBUCHET_COCKED_ANGLE, drawTrebuchet } from '../../../sprites/art/trebuchetArt';
import { drawSnare } from '../../../sprites/art/snareArt';
import { worldText } from '../../world/worldText';
import { drawResourceIcon } from '../resourceIcons';
import { drawConstructionIcon } from '../constructionIcon';
import { UPDATES_PER_SECOND, WALL_TIERS } from '../../../systems/briarHollow/structureRules';

/** The world art is drawn at this tile size in the illustrations. */
const STAGE_TILE = 40;
const ICON_SIZE = 40;
const RESOURCE_ICON_SIZE = 28;
const RESOURCE_GAP = 14;
const LABEL_SIZE = 11;
const LABEL_COLOR = '#f1e6c8';
const ARROW_SIZE = 20;
const ARROW_COLOR = '#fde68a';
const WALL_RUN_TILES = 2;
/** Where each illustration sits in its band, as shares of the band. */
const MENU_SCENE_TOP_SHARE = 0.12;
const WALL_GROUND_SHARE = 0.72;
const SIEGE_GROUND_SHARE = 0.8;
const TREBUCHET_X_SHARE = 0.28;
const SNARE_X_SHARE = 0.7;
const TREBUCHET_DEPTH_TILES = 3;
const LABEL_GAP = 6;
const SIEGE_LABEL_GAP = 4;
const SECONDS_PER_FRAME = 1 / UPDATES_PER_SECOND;

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  worldText(ctx, text, {
    x,
    y,
    size: LABEL_SIZE,
    color: LABEL_COLOR,
    align: 'center',
    outline: true,
  });
}

function arrow(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  worldText(ctx, '→', { x, y, size: ARROW_SIZE, bold: true, color: ARROW_COLOR, align: 'center' });
}

/** A short straight run of wall at a tier, standing on `groundY`. */
function wallRun(
  ctx: CanvasRenderingContext2D,
  left: number,
  groundY: number,
  tier: PalisadeTier,
  spiked = false,
): void {
  for (let tile = 0; tile < WALL_RUN_TILES; tile++) {
    const mask = tile === 0 ? PALISADE_DIRS.east : PALISADE_DIRS.west;
    paintPalisadeForReview(ctx, left + tile * STAGE_TILE, groundY - STAGE_TILE, STAGE_TILE, {
      tier,
      stage: 0,
      mask,
      outside: 'south',
      spiked,
      buttress: false,
      variant: tile,
    });
  }
}

export function drawMenuScene(ctx: CanvasRenderingContext2D, rect: IllustrationRect): void {
  const centreX = rect.x + rect.width / 2;
  const top = rect.y + rect.height * MENU_SCENE_TOP_SHARE;
  drawConstructionIcon(ctx, { x: centreX - ICON_SIZE / 2, y: top, w: ICON_SIZE, h: ICON_SIZE });
  const rowWidth = RESOURCE_IDS.length * (RESOURCE_ICON_SIZE + RESOURCE_GAP) - RESOURCE_GAP;
  const rowY = top + ICON_SIZE + RESOURCE_GAP;
  RESOURCE_IDS.forEach((id, index) => {
    const iconLeft = centreX - rowWidth / 2 + index * (RESOURCE_ICON_SIZE + RESOURCE_GAP);
    drawResourceIcon(
      ctx,
      { x: iconLeft, y: rowY, w: RESOURCE_ICON_SIZE, h: RESOURCE_ICON_SIZE },
      id,
    );
  });
  label(ctx, 'Wood · Stone · Boards · Rope', centreX, rowY + RESOURCE_ICON_SIZE + LABEL_GAP);
}

export function drawWallsScene(ctx: CanvasRenderingContext2D, rect: IllustrationRect): void {
  const tiers: readonly PalisadeTier[] = ['fence', 'wood', 'stone', 'fortified'];
  const runWidth = WALL_RUN_TILES * STAGE_TILE;
  const gap = (rect.width - runWidth * tiers.length) / (tiers.length + 1);
  const groundY = rect.y + rect.height * WALL_GROUND_SHARE;
  tiers.forEach((tier, index) => {
    const left = rect.x + gap + index * (runWidth + gap);
    wallRun(ctx, left, groundY, tier);
    label(ctx, WALL_TIERS[tier].label, left + runWidth / 2, groundY + LABEL_GAP);
    if (index > 0) arrow(ctx, left - gap / 2, groundY - STAGE_TILE);
  });
}

export function drawSiegeScene(
  ctx: CanvasRenderingContext2D,
  rect: IllustrationRect,
  frame: number,
): void {
  const groundY = rect.y + rect.height * SIEGE_GROUND_SHARE;
  const trebuchetX = rect.x + rect.width * TREBUCHET_X_SHARE - STAGE_TILE;
  drawTrebuchet(ctx, trebuchetX, groundY - STAGE_TILE * TREBUCHET_DEPTH_TILES, STAGE_TILE, {
    armAngle: TREBUCHET_COCKED_ANGLE,
    slingPhase: 0,
    broken: false,
    damageStage: 0,
    spikes: false,
    ammoFraction: 0.6,
    infernal: false,
  });
  label(ctx, 'Trebuchet', trebuchetX + STAGE_TILE, groundY + SIEGE_LABEL_GAP);
  const snareX = rect.x + rect.width * SNARE_X_SHARE - STAGE_TILE / 2;
  drawSnare(ctx, snareX, groundY - STAGE_TILE, STAGE_TILE, {
    look: 'set',
    spikes: false,
    timeSeconds: frame * SECONDS_PER_FRAME,
  });
  label(ctx, 'Snare', snareX + STAGE_TILE / 2, groundY + SIEGE_LABEL_GAP);
}

export function drawCareScene(ctx: CanvasRenderingContext2D, rect: IllustrationRect): void {
  const groundY = rect.y + rect.height * WALL_GROUND_SHARE;
  const runWidth = WALL_RUN_TILES * STAGE_TILE;
  const left = rect.x + rect.width / 2 - runWidth - STAGE_TILE / 2;
  wallRun(ctx, left, groundY, 'wood');
  label(ctx, 'Wooden wall', left + runWidth / 2, groundY + LABEL_GAP);
  const spikedLeft = rect.x + rect.width / 2 + STAGE_TILE / 2;
  wallRun(ctx, spikedLeft, groundY, 'wood', true);
  label(ctx, 'With spikes', spikedLeft + runWidth / 2, groundY + LABEL_GAP);
  arrow(ctx, rect.x + rect.width / 2, groundY - STAGE_TILE);
}
