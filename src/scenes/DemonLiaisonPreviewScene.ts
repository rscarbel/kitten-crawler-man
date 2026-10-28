/**
 * Localhost-only harness for watching the Demon Liaison in motion. He is a
 * finished character with no placement yet, so this and
 * `npm run render:demon-liaison` are the only places he is drawn.
 *
 * Plays the chosen action in every view at the in-game tile and twice it,
 * through the real draw call, and walks him across a lane underneath, paced by
 * the ground he covers, so the feet can be judged against the floor.
 *
 * Reached via `?demonliaison`; never on a production path.
 */

import { TILE_SIZE } from '../core/constants';
import { viewportHeight, viewportWidth } from '../core/rendering/Viewport';
import {
  DEMON_LIAISON_TILES_PER_WALK_CYCLE,
  drawDemonLiaisonSprite,
} from '../sprites/demonLiaisonSprite';
import { previewInk } from '../ui/theme/previewInk';
import { worldText } from '../ui/world/worldText';
import { PreviewScene, type PreviewControl } from './PreviewScene';

const BG_COLOR = previewInk.slate.backdrop;
const GROUND_COLOR = previewInk.slate.ground;
const LABEL_COLOR = previewInk.slate.label;
const GROUND_THICKNESS = 2;
const MARGIN = 32;
const LABEL_SIZE = 14;
const LANE_TOP_GAP = 16;
/** Horns and wings stand well over a tile above his own, so a lane is three. */
const LANE_TILES_TALL = 3;
const IN_GAME_ZOOM = 1;
const REVIEW_ZOOM = 2;
const ZOOMS: readonly number[] = [IN_GAME_ZOOM, REVIEW_ZOOM];

const ACTIONS = ['idle', 'walk', 'talk'] as const;
type PreviewAction = (typeof ACTIONS)[number];

const FACINGS: readonly { readonly label: string; readonly x: number; readonly y: number }[] = [
  { label: 'front', x: 0, y: 1 },
  { label: 'side', x: 1, y: 0 },
  { label: 'side (west)', x: -1, y: 0 },
  { label: 'away', x: 0, y: -1 },
];

/** World pixels a frame he strolls at, in the views and in the crossing lane. */
const WALK_SPEED_PX = 0.6;
const FULL_TURN = Math.PI * 2;
const PIXELS_PER_WALK_CYCLE = DEMON_LIAISON_TILES_PER_WALK_CYCLE * TILE_SIZE;
/** One shared offset: every lane breathes on the same clock, so the views compare. */
const IDLE_OFFSET_SECONDS = 0;

export class DemonLiaisonPreviewScene extends PreviewScene {
  private action: PreviewAction = 'idle';
  private walkedPx = 0;
  private crossingX = 0;
  private paused = false;

  protected previewTitle(): string {
    return 'Demon Liaison preview — ?demonliaison';
  }

  protected previewCaptions(): readonly string[] {
    return [`${this.action}${this.paused ? ' (paused)' : ''}`];
  }

  protected previewControls(): readonly PreviewControl[] {
    const actions = ACTIONS.map((action): PreviewControl => ({
      label: action,
      selected: action === this.action,
      onTap: () => {
        this.action = action;
      },
    }));
    return [
      ...actions,
      {
        id: 'play',
        label: this.paused ? 'play' : 'pause',
        onTap: () => {
          this.paused = !this.paused;
        },
      },
    ];
  }

  update(): void {
    if (this.paused) return;
    this.walkedPx += WALK_SPEED_PX;
    this.crossingX += WALK_SPEED_PX;
    if (this.crossingX > viewportWidth()) this.crossingX = -TILE_SIZE;
  }

  private walkPhase(): number {
    return (this.walkedPx / PIXELS_PER_WALK_CYCLE) * FULL_TURN;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, viewportHeight());

    let laneY = this.headerBottom + LANE_TOP_GAP;
    const slot = (width - MARGIN * 2) / FACINGS.length;
    for (const zoom of ZOOMS) {
      const tile = TILE_SIZE * zoom;
      const groundY = laneY + tile * LANE_TILES_TALL;
      ctx.fillStyle = GROUND_COLOR;
      ctx.fillRect(MARGIN, groundY, width - MARGIN * 2, GROUND_THICKNESS);
      FACINGS.forEach((facing, index) => {
        const x = MARGIN + index * slot + slot / 2 - tile / 2;
        drawDemonLiaisonSprite(ctx, x, groundY - tile, tile, {
          walkPhase: this.walkPhase(),
          isWalking: this.action === 'walk',
          isTalking: this.action === 'talk',
          facingX: facing.x,
          facingY: facing.y,
          idleOffsetSeconds: IDLE_OFFSET_SECONDS,
        });
        if (zoom === IN_GAME_ZOOM) {
          worldText(ctx, facing.label, {
            x: MARGIN + index * slot,
            y: laneY,
            size: LABEL_SIZE,
            color: LABEL_COLOR,
          });
        }
      });
      laneY = groundY + LANE_TOP_GAP;
    }

    const crossingGround = laneY + TILE_SIZE * LANE_TILES_TALL;
    ctx.fillStyle = GROUND_COLOR;
    ctx.fillRect(0, crossingGround, width, GROUND_THICKNESS);
    drawDemonLiaisonSprite(ctx, this.crossingX, crossingGround - TILE_SIZE, TILE_SIZE, {
      walkPhase: this.walkPhase(),
      isWalking: true,
      isTalking: false,
      facingX: 1,
      facingY: 0,
      idleOffsetSeconds: IDLE_OFFSET_SECONDS,
    });

    this.renderChrome(ctx);
  }
}
