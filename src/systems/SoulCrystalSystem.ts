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
  type DoomsdayProgress,
  countdownUrgencyColor,
  formatCountdownClock,
  triggerDoomsdayExplosionIfExpired,
} from '../core/DoomsdayProgress';
import { drawText } from '../ui/TextBox';

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

  /** Countdown HUD — shown from anywhere while a doomsday countdown is running, not just the crystal's floor. */
  renderUI(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const { stage, deadlineAt } = this.progress;
    if ((stage !== 'containment' && stage !== 'escape') || deadlineAt === null) return;

    drawText(
      ctx,
      stage === 'containment' ? 'THE SOUL CRYSTAL IS DESTABILIZING' : 'ESCAPE THE CITY',
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
