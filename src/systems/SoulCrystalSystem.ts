/**
 * SoulCrystalSystem — the containment beat of "Carl's Doomsday Scenario",
 * owned directly by BuildingInteriorScene and ticked every frame regardless
 * of which floor or building the players are standing in.
 *
 * It must not be tied to QuillConfrontationSystem's lifecycle: a player can
 * kill Miss Quill, then leave the encounter floor — or the tower entirely —
 * before containing the crystal. The containment deadline (and the
 * lethal timeout it guards) has to keep being checked from wherever the
 * players actually are, or the sequence either soft-locks (nothing left
 * watching the crystal to let it be contained) or the timer becomes free to
 * dodge by simply walking away from the room it started in.
 */

import { TILE_SIZE } from '../core/constants';
import type { AudioManager } from '../audio/AudioManager';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import {
  DOOMSDAY_CONTAIN_OBJECTIVE,
  type DoomsdayProgress,
  countdownUrgencyColor,
  formatCountdownClock,
  triggerDoomsdayExplosionIfExpired,
} from '../core/DoomsdayProgress';
import { drawText } from '../ui/TextBox';
import { viewportWidth } from '../core/Viewport';
import { drawArrowAbovePlayer, type ArrowAvoidRect } from '../ui/WorldArrow';

/** How close the player must walk to auto-contain the crystal. */
const CONTAIN_RANGE_TILES = 2.5;
/** The "Contain the crystal!" prompt shows out to twice the auto-contain range. */
const CRYSTAL_PROMPT_RANGE_TILES = CONTAIN_RANGE_TILES * 2;

// Crystal prop rendering
const CRYSTAL_GLOW_RADIUS_RATIO = 0.4;
const CRYSTAL_GLOW_ALPHA_BASE = 0.4;
const CRYSTAL_GLOW_ALPHA_PULSE = 0.25;
const CRYSTAL_GLOW_PULSE_MS = 350;
const CRYSTAL_PROMPT_Y_OFFSET = -18;
const CRYSTAL_PROMPT_SIZE = 12;

const COUNTDOWN_Y = 60;
const COUNTDOWN_SIZE = 16;
const COUNTDOWN_LABEL_Y = 78;
const COUNTDOWN_LABEL_SIZE = 12;
const OBJECTIVE_Y = 94;
const OBJECTIVE_SIZE = 11;
/** The same gold as the Journal's pinned arrow outdoors, so both read as "go here". */
const GUIDE_ARROW_COLOR = '#facc15';
/** Past this the thing is on screen, and an arrow still insisting on a direction is noise. */
const GUIDE_ARROW_SUPPRESS_TILES = 4;

export class SoulCrystalSystem {
  /** Set once when the crystal is contained; BuildingInteriorScene reads and clears it to play a sound and unlock the achievement. */
  crystalContainedPending = false;

  constructor(
    private readonly progress: DoomsdayProgress,
    private readonly audio: AudioManager | null,
  ) {}

  /**
   * `isOnCrystalFloor` gates the containment proximity check to the tower
   * floor the crystal actually sits on — every floor is a distinct GameMap
   * whose pixel coordinates can numerically overlap, so checking distance
   * against a different floor's player position would be a false match.
   * The timeout check itself is not floor-gated: it must fire regardless of
   * where the players currently are.
   */
  update(
    human: HumanPlayer,
    cat: CatPlayer,
    active: HumanPlayer | CatPlayer,
    isOnCrystalFloor: boolean,
  ): void {
    const progress = this.progress;

    if (isOnCrystalFloor && progress.stage === 'containment' && progress.crystalTile) {
      const dist = Math.hypot(active.x - progress.crystalTile.x, active.y - progress.crystalTile.y);
      if (dist <= TILE_SIZE * CONTAIN_RANGE_TILES) {
        active.inventory.addItem('doomsday_scenario', 1);
        progress.stage = 'escape';
        this.crystalContainedPending = true;
        this.audio?.play('quest_complete');
        return;
      }
    }

    triggerDoomsdayExplosionIfExpired(progress, human, cat);
  }

  /** World-space rendering: the crystal's glow and containment prompt. Only meaningful on the crystal's own floor. */
  render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: { x: number; y: number },
    isOnCrystalFloor: boolean,
  ): void {
    if (!isOnCrystalFloor || this.progress.stage !== 'containment' || !this.progress.crystalTile) {
      return;
    }
    const crystalTile = this.progress.crystalTile;

    const sx = crystalTile.x - camX + TILE_SIZE / 2;
    const sy = crystalTile.y - camY + TILE_SIZE / 2;
    const pulse =
      CRYSTAL_GLOW_ALPHA_BASE +
      Math.sin(Date.now() / CRYSTAL_GLOW_PULSE_MS) * CRYSTAL_GLOW_ALPHA_PULSE;
    ctx.save();
    ctx.fillStyle = `rgba(168, 85, 247, ${Math.max(0, pulse)})`;
    ctx.beginPath();
    ctx.arc(sx, sy, TILE_SIZE * CRYSTAL_GLOW_RADIUS_RATIO, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const dist = Math.hypot(active.x - crystalTile.x, active.y - crystalTile.y);
    if (dist <= TILE_SIZE * CRYSTAL_PROMPT_RANGE_TILES) {
      drawText(ctx, 'Contain the crystal!', {
        x: sx,
        y: sy + CRYSTAL_PROMPT_Y_OFFSET,
        size: CRYSTAL_PROMPT_SIZE,
        bold: true,
        color: '#e9d5ff',
        align: 'center',
        outline: true,
      });
    }
  }

  /**
   * The way to the crystal while it is still loose: on its own floor, an arrow
   * to it; on any other storey of the tower, an arrow to the stairs up. Outdoors
   * the Journal's pin does this job; indoors there is no Journal, and a tower
   * storey is a maze of rooms the countdown does not wait for.
   *
   * @param upStairs world-pixel centre of this storey's stairs up, or null where
   *   there are none (the top floor, or a building that is not the tower)
   */
  renderGuidance(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: { x: number; y: number },
    isOnCrystalFloor: boolean,
    upStairs: { x: number; y: number } | null,
    avoidRect?: ArrowAvoidRect,
  ): void {
    if (this.progress.stage !== 'containment') return;
    const crystal = this.progress.crystalTile;
    const target =
      isOnCrystalFloor && crystal !== null
        ? { x: crystal.x + TILE_SIZE / 2, y: crystal.y + TILE_SIZE / 2 }
        : upStairs;
    if (target === null) return;
    const distanceTiles =
      Math.hypot(target.x - (active.x + TILE_SIZE / 2), target.y - (active.y + TILE_SIZE / 2)) /
      TILE_SIZE;
    if (distanceTiles < GUIDE_ARROW_SUPPRESS_TILES) return;
    drawArrowAbovePlayer(
      ctx,
      active.x,
      active.y,
      target.x,
      target.y,
      camX,
      camY,
      GUIDE_ARROW_COLOR,
      avoidRect === undefined ? undefined : { avoidRect },
    );
  }

  /** Countdown HUD — shown from anywhere while a doomsday countdown is running, not just the crystal's floor. */
  renderUI(ctx: CanvasRenderingContext2D): void {
    const { stage, deadlineAt } = this.progress;
    if ((stage !== 'containment' && stage !== 'escape') || deadlineAt === null) return;

    drawText(
      ctx,
      stage === 'containment' ? 'THE SOUL CRYSTAL IS DESTABILIZING' : 'ESCAPE THE CITY',
      {
        x: viewportWidth() / 2,
        y: COUNTDOWN_LABEL_Y,
        size: COUNTDOWN_LABEL_SIZE,
        bold: true,
        color: '#f47c7c',
        align: 'center',
      },
    );
    if (stage === 'containment') {
      drawText(ctx, DOOMSDAY_CONTAIN_OBJECTIVE, {
        x: viewportWidth() / 2,
        y: OBJECTIVE_Y,
        size: OBJECTIVE_SIZE,
        color: '#e9d5ff',
        align: 'center',
        outline: true,
      });
    }
    drawText(ctx, formatCountdownClock(deadlineAt), {
      x: viewportWidth() / 2,
      y: COUNTDOWN_Y,
      size: COUNTDOWN_SIZE,
      bold: true,
      color: countdownUrgencyColor(deadlineAt),
      align: 'center',
      outline: true,
    });
  }
}
