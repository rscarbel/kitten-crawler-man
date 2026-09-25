/**
 * The four-page explainer for the Construction craft skill: the menu, the
 * walls, trebuchets and snares, and looking after what you build.
 *
 * Shown after Tikka teaches Construction and again from the Crafts tab's
 * "How it works". Pages are built fresh on every open, so the keys named are
 * the ones the player has bound and a phone reads "tap" and "long-press".
 */

import type { AudioManager } from '../audio/AudioManager';
import { keybindings } from '../core/Keybindings';
import { platform } from '../core/Platform';
import { RESOURCE_IDS } from '../core/resourceIds';
import type { PalisadeTier } from '../map/tileTypes';
import { PALISADE_DIRS, paintPalisadeForReview } from '../map/tiles/hollowPalisadeTiles';
import { TREBUCHET_COCKED_ANGLE, drawTrebuchet } from '../sprites/art/trebuchetArt';
import { drawSnare } from '../sprites/art/snareArt';
import {
  HowToPlayOverlay,
  type HowToPlayConfig,
  type HowToPlayPage,
  type IllustrationRect,
} from './HowToPlayOverlay';
import { drawText } from './TextBox';
import type { CraftExplainer } from './CraftExplainers';
import { drawResourceIcon } from './icons/resourceIcons';
import { drawConstructionIcon } from './icons/constructionIcon';
import { UPDATES_PER_SECOND, WALL_TIERS } from '../systems/briarHollow/structureRules';

export const CONSTRUCTION_EXPLAINER_FOCUS_ID = 'construction-explainer';

export const CONSTRUCTION_EXPLAINER_CONFIG: HowToPlayConfig = {
  title: 'HOW CONSTRUCTION WORKS',
  focusId: CONSTRUCTION_EXPLAINER_FOCUS_ID,
  finalLabel: 'Got it!',
};

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
  drawText(ctx, text, {
    x,
    y,
    size: LABEL_SIZE,
    color: LABEL_COLOR,
    align: 'center',
    outline: true,
  });
}

function arrow(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  drawText(ctx, '→', { x, y, size: ARROW_SIZE, bold: true, color: ARROW_COLOR, align: 'center' });
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

function drawMenuScene(ctx: CanvasRenderingContext2D, rect: IllustrationRect): void {
  const centreX = rect.x + rect.width / 2;
  const top = rect.y + rect.height * MENU_SCENE_TOP_SHARE;
  drawConstructionIcon(ctx, centreX - ICON_SIZE / 2, top, ICON_SIZE);
  const rowWidth = RESOURCE_IDS.length * (RESOURCE_ICON_SIZE + RESOURCE_GAP) - RESOURCE_GAP;
  const rowY = top + ICON_SIZE + RESOURCE_GAP;
  RESOURCE_IDS.forEach((id, index) => {
    drawResourceIcon(
      ctx,
      id,
      centreX - rowWidth / 2 + index * (RESOURCE_ICON_SIZE + RESOURCE_GAP),
      rowY,
      RESOURCE_ICON_SIZE,
    );
  });
  label(ctx, 'Wood · Stone · Boards · Rope', centreX, rowY + RESOURCE_ICON_SIZE + LABEL_GAP);
}

function drawWallsScene(ctx: CanvasRenderingContext2D, rect: IllustrationRect): void {
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

function drawSiegeScene(
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

function drawCareScene(ctx: CanvasRenderingContext2D, rect: IllustrationRect): void {
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

/** The explainer's pages, worded for the player's own bindings and device. */
export function buildConstructionExplainerPages(isMobile: boolean): HowToPlayPage[] {
  const openMenu = isMobile
    ? 'tap the Build button'
    : `press ${keybindings.labelFor('construction')}`;
  const structureMenu = isMobile
    ? 'long-press'
    : `press ${keybindings.labelFor('structureMenu')} on`;

  return [
    {
      subtitle: 'The Construction menu',
      drawIllustration: drawMenuScene,
      lines: [
        `${isMobile ? 'Tap the Build button' : `Press ${keybindings.labelFor('construction')}`} to open it. Your wood, stone, boards and rope are at the top, and what you can build is below.`,
        `Pick an option to build right in front of you. ${isMobile ? 'Tapping' : 'Hovering'} an option shows where it will go.`,
      ],
    },
    {
      subtitle: 'Walls',
      drawIllustration: drawWallsScene,
      lines: [
        `Face a section of the fence and ${openMenu}. Fence → Wooden Wall → Stone Wall  → Fortified.`,
        'A wall knocked down becomes a breach you can repair. Repairs cost less than rebuilding.',
      ],
    },
    {
      subtitle: 'Trebuchets and snares',
      drawIllustration: drawSiegeScene,
      lines: [
        `A trebuchet hurls stone at enemies. It needs to be loaded with stone after its built to work.`,
        `A snare holds an enemy for a short duration. Friends step over it safely.`,
      ],
    },
    {
      subtitle: 'Looking after it',
      drawIllustration: drawCareScene,
      lines: [
        `${structureMenu.charAt(0).toUpperCase()}${structureMenu.slice(1)} any construction to repair it, add spikes (from Construction level 5), or destroy it.`,
        'You build faster with every level.',
      ],
    },
  ];
}

export class ConstructionExplainer implements CraftExplainer {
  private readonly overlay: HowToPlayOverlay;
  readonly focusId = CONSTRUCTION_EXPLAINER_FOCUS_ID;

  constructor(audio: AudioManager | null, clockMs?: () => number) {
    this.overlay = new HowToPlayOverlay(audio, CONSTRUCTION_EXPLAINER_CONFIG, clockMs);
  }

  get isOpen(): boolean {
    return this.overlay.isOpen;
  }

  open(): void {
    this.overlay.open(buildConstructionExplainerPages(platform.isMobile));
  }

  close(): void {
    this.overlay.close();
  }

  advance(): void {
    this.overlay.advance();
  }

  handleClick(mx: number, my: number): boolean {
    return this.overlay.handleClick(mx, my);
  }

  render(ctx: CanvasRenderingContext2D): void {
    this.overlay.render(ctx);
  }

  /** The overlay at a chosen illustration frame, for a review harness. */
  renderFrame(ctx: CanvasRenderingContext2D, frame: number): void {
    this.overlay.renderFrame(ctx, frame);
  }
}
