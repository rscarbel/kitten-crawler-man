/**
 * DoomsdayEscapeSystem — the overworld half of "Carl's Doomsday Scenario":
 * once the soul crystal is contained (DoomsdayProgress.stage === 'escape'),
 * marks the town's escape route as the way out and races a wall-clock
 * deadline. Reaching it in time completes the floor's finale; letting the
 * deadline pass — in this stage or, if the player left the tower without
 * containing the crystal, the containment stage too — kills both players
 * via a dedicated death cause.
 *
 * The escape tile is read from `gameMap.doomsdayEscapeTile`, a dedicated
 * field set at overworld generation time — deliberately not part of
 * `gameMap.stairwellTiles`, which feeds StairwellSystem's floor-descent menu
 * and MiniMapSystem's minimap reveal. Adding it there would expose a
 * permanent, non-functional "stairwell" marker on the minimap from the start
 * of the floor, long before the finale exists.
 */

import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import type { GameSystem, SystemContext } from './GameSystem';
import {
  type DoomsdayProgress,
  countdownUrgencyColor,
  formatCountdownClock,
  triggerDoomsdayExplosionIfExpired,
} from '../core/DoomsdayProgress';
import { drawText } from '../ui/TextBox';
import { drawSpriteKey } from '../core/SpriteRenderer';

/** How close the player must be to the escape tile to complete the escape. */
const REACH_RANGE_TILES = 1.2;

const STAIRWELL_SCALE = 2;
const STAIRWELL_PULSE_CENTER = 0.7;
const STAIRWELL_PULSE_AMPLITUDE = 0.2;
const STAIRWELL_PULSE_SPEED = 500; // ms
const STAIRWELL_BORDER_WIDTH = 2;

const COUNTDOWN_Y = 60;
const COUNTDOWN_SIZE = 16;
const COUNTDOWN_LABEL_Y = 78;
const COUNTDOWN_LABEL_SIZE = 12;

export class DoomsdayEscapeSystem implements GameSystem {
  /** Set once the player reaches the escape tile in time; DungeonScene reads and clears it to play a sound and unlock the achievement. */
  floorEscapedPending = false;

  constructor(
    private readonly gameMap: GameMap,
    private readonly progress: DoomsdayProgress,
  ) {}

  update(ctx: SystemContext): void {
    const escapeTile = this.gameMap.doomsdayEscapeTile;
    if (this.progress.stage === 'escape' && escapeTile) {
      const dist = Math.hypot(
        ctx.active.x - escapeTile.x * TILE_SIZE,
        ctx.active.y - escapeTile.y * TILE_SIZE,
      );
      if (dist <= TILE_SIZE * REACH_RANGE_TILES) {
        this.progress.stage = 'complete';
        this.progress.deadlineAt = null;
        this.floorEscapedPending = true;
        return;
      }
    }

    triggerDoomsdayExplosionIfExpired(this.progress, ctx.human, ctx.cat);
  }

  /** World-space rendering: the escape marker, highlighted red while the countdown runs. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.progress.stage !== 'escape') return;
    const escapeTile = this.gameMap.doomsdayEscapeTile;
    if (!escapeTile) return;

    const sx = escapeTile.x * TILE_SIZE - camX;
    const sy = escapeTile.y * TILE_SIZE - camY;
    const bw = TILE_SIZE * STAIRWELL_SCALE;
    const pulse =
      STAIRWELL_PULSE_CENTER +
      Math.sin(Date.now() / STAIRWELL_PULSE_SPEED) * STAIRWELL_PULSE_AMPLITUDE;

    drawSpriteKey(ctx, 'stairwell', 'idle', 0, sx, sy, bw);
    ctx.save();
    ctx.strokeStyle = `rgba(239, 68, 68, ${pulse})`;
    ctx.lineWidth = STAIRWELL_BORDER_WIDTH;
    ctx.strokeRect(sx + 1, sy + 1, bw - 2, bw - 2);
    ctx.restore();
  }

  /** Countdown HUD — shown while a doomsday countdown is running, whether it's containment (crystal not yet reached) or escape. */
  renderUI(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const { stage, deadlineAt } = this.progress;
    if ((stage !== 'containment' && stage !== 'escape') || deadlineAt === null) return;

    drawText(
      ctx,
      stage === 'containment' ? 'THE SOUL CRYSTAL IS DESTABILIZING' : 'GET TO THE ESCAPE ROUTE',
      {
        x: canvas.width / 2,
        y: COUNTDOWN_LABEL_Y,
        size: COUNTDOWN_LABEL_SIZE,
        bold: true,
        color: '#f47c7c',
        align: 'center',
      },
    );
    drawText(ctx, formatCountdownClock(deadlineAt), {
      x: canvas.width / 2,
      y: COUNTDOWN_Y,
      size: COUNTDOWN_SIZE,
      bold: true,
      color: countdownUrgencyColor(deadlineAt),
      align: 'center',
      outline: true,
    });
  }
}
