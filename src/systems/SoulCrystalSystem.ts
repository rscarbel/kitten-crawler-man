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
  triggerDoomsdayExplosionIfExpired,
} from '../core/DoomsdayProgress';
import { worldText } from '../ui/world/worldText';
import { worldPalette } from '../ui/theme/worldInk';
import { drawObjectiveBeacon } from '../ui/ObjectiveBeacon';
import { drawSoulCrystalProp, SOUL_CRYSTAL_TOP_TILES } from '../sprites/soulCrystalArt';
import { frameTime } from '../utils';
import type { TopBandEntry } from '../ui/hud/topBand';
import { CONTAINMENT_LABEL, doomsdayCountdownEntry } from './DoomsdayEscapeSystem';
import { ARROW_PRIORITY, drawArrowAbovePlayer, type ArrowCandidate } from '../ui/WorldArrow';
import type { Rect } from '../ui/core/geom';

/** How close the player must walk to auto-contain the crystal. */
const CONTAIN_RANGE_TILES = 2.5;
/** The "Contain the crystal!" prompt shows out to twice the auto-contain range. */
const CRYSTAL_PROMPT_RANGE_TILES = CONTAIN_RANGE_TILES * 2;

/** Where the crystal's floor point sits within its tile, so it hovers over the beacon's pool of light. */
const CRYSTAL_GROUND_IN_TILE = 0.8;
/** Gap between the top of the crystal and its prompt, in pixels. */
const CRYSTAL_PROMPT_GAP_PX = 6;
const CRYSTAL_PROMPT_SIZE = 12;

/** The same gold as the Journal's pinned arrow outdoors, so both read as "go here". */
const GUIDE_ARROW_COLOR = worldPalette.objective.ready;
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

  /** The crystal tile on this floor, while there is still a loose crystal to draw. */
  private looseCrystal(isOnCrystalFloor: boolean): { x: number; y: number } | null {
    if (!isOnCrystalFloor || this.progress.stage !== 'containment') return null;
    return this.progress.crystalTile;
  }

  /**
   * Ground-layer rendering: the quest beacon standing over the crystal and the
   * crystal itself. Drawn before the Y-sorted pass, with the room's other
   * ground paint, so the crawlers stand in front of its light.
   *
   * The beacon is the same column every other quest target wears, so the one
   * object the countdown is about reads as "go here" the moment it is on screen.
   * It goes with the crystal: once contained, nothing is left to light.
   */
  renderGround(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    isOnCrystalFloor: boolean,
  ): void {
    const crystalTile = this.looseCrystal(isOnCrystalFloor);
    if (crystalTile === null) return;
    const screenX = crystalTile.x - camX;
    const screenY = crystalTile.y - camY;
    drawObjectiveBeacon(ctx, screenX, screenY, TILE_SIZE, GUIDE_ARROW_COLOR, performance.now());
    drawSoulCrystalProp(
      ctx,
      screenX + TILE_SIZE / 2,
      screenY + TILE_SIZE * CRYSTAL_GROUND_IN_TILE,
      TILE_SIZE,
      frameTime,
    );
  }

  /** Overlay rendering: the containment prompt, over the figures. Only meaningful on the crystal's own floor. */
  render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: { x: number; y: number },
    isOnCrystalFloor: boolean,
  ): void {
    const crystalTile = this.looseCrystal(isOnCrystalFloor);
    if (crystalTile === null) return;

    const sx = crystalTile.x - camX + TILE_SIZE / 2;
    const crystalTopY =
      crystalTile.y - camY + TILE_SIZE * (CRYSTAL_GROUND_IN_TILE - SOUL_CRYSTAL_TOP_TILES);
    const dist = Math.hypot(active.x - crystalTile.x, active.y - crystalTile.y);
    if (dist <= TILE_SIZE * CRYSTAL_PROMPT_RANGE_TILES) {
      worldText(ctx, 'Contain the crystal!', {
        x: sx,
        y: crystalTopY - CRYSTAL_PROMPT_GAP_PX,
        size: CRYSTAL_PROMPT_SIZE,
        bold: true,
        color: worldPalette.soulCrystalInk,
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
  guidanceArrowCandidate(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: { x: number; y: number },
    isOnCrystalFloor: boolean,
    upStairs: { x: number; y: number } | null,
    avoidRect?: Rect,
  ): ArrowCandidate | null {
    if (this.progress.stage !== 'containment') return null;
    const crystal = this.progress.crystalTile;
    const target =
      isOnCrystalFloor && crystal !== null
        ? { x: crystal.x + TILE_SIZE / 2, y: crystal.y + TILE_SIZE / 2 }
        : upStairs;
    if (target === null) return null;
    const distanceTiles =
      Math.hypot(target.x - (active.x + TILE_SIZE / 2), target.y - (active.y + TILE_SIZE / 2)) /
      TILE_SIZE;
    if (distanceTiles < GUIDE_ARROW_SUPPRESS_TILES) return null;
    return {
      priority: ARROW_PRIORITY.SOUL_CRYSTAL,
      draw: () =>
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
        ),
    };
  }

  /** Countdown HUD — shown from anywhere while a doomsday countdown is running, not just the crystal's floor. */
  topBandEntry(): TopBandEntry | null {
    const { stage, deadlineAt } = this.progress;
    if ((stage !== 'containment' && stage !== 'escape') || deadlineAt === null) return null;
    const containing = stage === 'containment';
    return doomsdayCountdownEntry({
      id: 'soul-crystal-countdown',
      label: containing ? CONTAINMENT_LABEL : 'ESCAPE THE CITY',
      deadlineAt,
      objective: containing ? DOOMSDAY_CONTAIN_OBJECTIVE : undefined,
    });
  }
}
