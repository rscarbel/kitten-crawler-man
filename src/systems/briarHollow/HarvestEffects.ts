/**
 * The small world-space feedback a harvest makes: chips thrown off a struck
 * trunk or rock, and the "+2 Wood" that rises over a thrall's node.
 *
 * A crawler's own award text goes through `Player.queueFloatingText`, over
 * the crawler; a thrall is not a `Player`, so its text is drawn here instead,
 * in the same colours.
 */

import { TILE_SIZE } from '../../core/constants';
import type { HarvestKind } from '../../core/craftPerks';
import { drawText } from '../../ui/TextBox';

/** Chips a single strike throws, fewest and most. */
const CHIPS_PER_STRIKE_MIN = 3;
const CHIPS_PER_STRIKE_MAX = 5;
/** Frames a chip flies before it is gone. */
const CHIP_LIFETIME_FRAMES = 26;
/** Launch speed, px per frame, and how far off vertical a chip may fly. */
const CHIP_SPEED_MIN = 1.1;
const CHIP_SPEED_MAX = 2.4;
const CHIP_SPREAD_RADIANS = 1.2;
/** Pull back down, px per frame per frame, so chips arc rather than drift. */
const CHIP_GRAVITY = 0.16;
/** Chip size range, px at the 32 px tile. */
const CHIP_SIZE_MIN = 1.5;
const CHIP_SIZE_MAX = 3;
/**
 * Where on the node a strike lands, in tiles above its tile centre: a trunk
 * is struck at the height of a swing, a rock near the ground.
 */
const WOOD_STRIKE_HEIGHT_TILES = 0.35;
const STONE_STRIKE_HEIGHT_TILES = 0.1;
/** Tan wood chips and grey stone chips. */
const WOOD_CHIP_SHADES = ['#c8a06a', '#a47a45', '#e2c28c'] as const;
const STONE_CHIP_SHADES = ['#8d8d88', '#b5b3ac', '#6a6a66'] as const;
/** A worked-out rock throws a bigger burst than a strike does. */
const CRUMBLE_CHIP_MULTIPLIER = 3;
/** Past this many chips the oldest stop spawning, so a crowd of thralls can't flood the effects pass. */
const MAX_CHIPS = 160;

/** Frames a thrall's award text rises and fades. */
const POP_LIFETIME_FRAMES = 50;
const POP_RISE_PX_PER_FRAME = 0.5;
const POP_TEXT_SIZE = 11;
/** Vertical gap between pops that land at the same origin while an earlier one is still up. */
const POP_STACK_OFFSET_PX = 12;
/** Origins round to this many pixels, so two pops over the same node always share a stack. */
const POP_ORIGIN_GRID_PX = 4;
/** The award and lucky-find colours the crawlers' own floating text uses. */
export const HARVEST_BUFF_COLOR = '#4ade80';
export const HARVEST_TRIGGER_COLOR = '#facc15';

const TILE_CENTER_OFFSET = 0.5;
const FULL_TURN = Math.PI * 2;
const QUARTER_TURN = Math.PI / 2;

interface Chip {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
}

interface Pop {
  readonly text: string;
  readonly color: string;
  readonly x: number;
  y: number;
  life: number;
  readonly originKey: string;
}

function between(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class HarvestEffects {
  private readonly chips: Chip[] = [];
  private readonly pops: Pop[] = [];

  /** A strike on a node: a small burst of chips from where the blow lands. */
  strike(kind: HarvestKind, tileX: number, tileY: number): void {
    const count = Math.round(between(CHIPS_PER_STRIKE_MIN, CHIPS_PER_STRIKE_MAX));
    this.burst(kind, tileX, tileY, count);
  }

  /** A rock worked out to nothing: a heavier burst of stone. */
  crumble(tileX: number, tileY: number): void {
    this.burst('stone', tileX, tileY, CHIPS_PER_STRIKE_MAX * CRUMBLE_CHIP_MULTIPLIER);
  }

  /**
   * Rising text over a world point, for award text with no `Player` to hang
   * from. Multiple pops landing on the same point at once stack vertically
   * rather than drawing over each other.
   */
  pop(text: string, color: string, worldX: number, worldY: number): void {
    const originKey = `${Math.round(worldX / POP_ORIGIN_GRID_PX)},${Math.round(worldY / POP_ORIGIN_GRID_PX)}`;
    const stackIndex = this.pops.reduce(
      (count, existing) => (existing.originKey === originKey ? count + 1 : count),
      0,
    );
    this.pops.push({
      text,
      color,
      x: worldX,
      y: worldY - stackIndex * POP_STACK_OFFSET_PX,
      life: POP_LIFETIME_FRAMES,
      originKey,
    });
  }

  private burst(kind: HarvestKind, tileX: number, tileY: number, count: number): void {
    const heightTiles = kind === 'wood' ? WOOD_STRIKE_HEIGHT_TILES : STONE_STRIKE_HEIGHT_TILES;
    const originX = (tileX + TILE_CENTER_OFFSET) * TILE_SIZE;
    const originY = (tileY + TILE_CENTER_OFFSET - heightTiles) * TILE_SIZE;
    const shades = kind === 'wood' ? WOOD_CHIP_SHADES : STONE_CHIP_SHADES;
    for (let i = 0; i < count && this.chips.length < MAX_CHIPS; i++) {
      const angle = -QUARTER_TURN + between(-CHIP_SPREAD_RADIANS, CHIP_SPREAD_RADIANS);
      const speed = between(CHIP_SPEED_MIN, CHIP_SPEED_MAX);
      this.chips.push({
        x: originX,
        y: originY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: between(CHIP_SIZE_MIN, CHIP_SIZE_MAX),
        color: shades[Math.floor(Math.random() * shades.length)],
        life: CHIP_LIFETIME_FRAMES,
      });
    }
  }

  update(): void {
    for (let i = this.chips.length - 1; i >= 0; i--) {
      const chip = this.chips[i];
      chip.x += chip.vx;
      chip.y += chip.vy;
      chip.vy += CHIP_GRAVITY;
      chip.life--;
      if (chip.life <= 0) this.chips.splice(i, 1);
    }
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const pop = this.pops[i];
      pop.y -= POP_RISE_PX_PER_FRAME;
      pop.life--;
      if (pop.life <= 0) this.pops.splice(i, 1);
    }
  }

  /** Drawn over every body, so a chip thrown toward the camera is never hidden behind its thrower. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    ctx.save();
    for (const chip of this.chips) {
      ctx.globalAlpha = chip.life / CHIP_LIFETIME_FRAMES;
      ctx.fillStyle = chip.color;
      ctx.beginPath();
      ctx.arc(chip.x - camX, chip.y - camY, chip.size / 2, 0, FULL_TURN);
      ctx.fill();
    }
    ctx.restore();
    for (const pop of this.pops) {
      drawText(ctx, pop.text, {
        x: pop.x - camX,
        y: pop.y - camY,
        size: POP_TEXT_SIZE,
        bold: true,
        color: pop.color,
        outline: true,
        align: 'center',
        alpha: pop.life / POP_LIFETIME_FRAMES,
      });
    }
  }
}
