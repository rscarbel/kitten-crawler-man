/**
 * The regular sitting on a bench against the Sleeping Cat Inn's front wall,
 * who misses the inn's cat. While nobody has asked at the inn yet they wear a
 * `!`: a word with them points the Journal at the innkeeper, which is how a
 * party walking past learns there is something to ask about in there. Once
 * the inn's cat is home they say so.
 *
 * Drawn as one of the town's cast looks, seated on the town's street bench,
 * in the scene's Y-sorted pass.
 */

import { TILE_SIZE } from '../../core/constants';
import { citizenSpeechStyle } from '../../creatures/citizenFigure';
import type { CitizenSpeechStyle } from '../../dialog/speakers';
import { doorstepOf, type BuildingEntry } from '../../map/buildingEntry';
import type { BuildingId } from '../../map/buildingIds';
import { tileKey } from '../tileKey';
import type { GameMap } from '../../map/GameMap';
import type { TilePoint } from '../../map/town/townPlan';
import { SEAT_POSE_FPS, SEAT_POSE_FRAMES, seatStateName } from '../../sprites/art/seatPoses';
import { townCastSeatedFigure } from '../../sprites/art/townCastFigure';
import type { FigureDef } from '../../sprites/figure/figureDef';
import { drawnFigureRow } from '../../sprites/figure/figureDef';
import {
  drawFigureCachedApprox,
  figureRowInkTop,
  pinFigureState,
  prewarmFigureState,
  unpinFigureState,
} from '../../sprites/figure/figureFrameCache';
import { scaleHumanoidBox } from '../../sprites/humanoidScale';
import { drawOverheadIcon, overheadIconTopY, type OverheadIcon } from '../../sprites/overheadIcon';
import { townCastLook } from '../../sprites/person/townCastLooks';
import { drawTownSheetFrame } from '../../sprites/townSheetProp';
import { drawInteractionPromptOver } from '../../ui/InteractionPrompt';
import { BENCH_SHEET_KEY, FIXTURE_FRAME, FIXTURE_STATE } from '../TownPropSystem';
import type { TownPropRenderable } from '../townPropRenderable';

/** The cast look the regular wears. */
const SITTER_LOOK_ID = 'adult_commoner';
const INN_ID: BuildingId = 'taloncrest_inn';
/** Bench columns tried beside the inn's doorway, east first, past a one-tile gap so the door stays clear. */
const DOORWAY_GAP_TILES = 1;
/** How close, in tiles, a crawler must stand to talk to the regular. */
export const INN_WALL_SITTER_TALK_RANGE_TILES = 1.6;
const TALK_RANGE_PX = INN_WALL_SITTER_TALK_RANGE_TILES * TILE_SIZE;
const SEATED_STATE = seatStateName('idle', 'down');
const MS_PER_SECOND = 1000;

/**
 * The street tile against the inn's front wall beside its doorway: open
 * ground itself, with the facade's wall at its back. East of the doorway
 * first, then west; null when neither side has one. Blocks laid for the map's
 * lifetime are ignored, so the tile is found again after
 * {@link reserveInnWallSitterTile} has blocked it.
 */
export function innWallSitterTile(map: GameMap, inn: BuildingEntry): TilePoint | null {
  const { doorway, doorTile } = inn;
  const streetRow = doorstepOf(inn).y;
  const eastOfDoorway = doorway.x0 + doorway.width;
  const westOfDoorway = doorway.x0 - 1;
  const columns = [eastOfDoorway + DOORWAY_GAP_TILES, westOfDoorway - DOORWAY_GAP_TILES];
  for (const x of columns) {
    const againstWall = !map.isWalkableIgnoringPermanent(x, doorTile.y, 'walker');
    const openGround = map.isWalkableIgnoringPermanent(x, streetRow, 'walker');
    if (againstWall && openGround) return { x, y: streetRow };
  }
  return null;
}

/**
 * Claims the regular's bench tile on a town map, before its props and its
 * crowd are placed: blocked for every body for the map's lifetime, and
 * returned as a reserved key so prop placement, which ignores such blocks,
 * steers clear of it too. An empty set on a map without the inn.
 */
export function reserveInnWallSitterTile(map: GameMap): ReadonlySet<string> {
  const inn = map.buildingEntries.find((entry) => entry.id === INN_ID);
  const tile = inn === undefined ? null : innWallSitterTile(map, inn);
  if (tile === null) return new Set();
  map.blockTilePermanently(tile.x, tile.y);
  return new Set([tileKey(tile.x, tile.y)]);
}

export class InnWallSitter implements TownPropRenderable {
  readonly x: number;
  readonly y: number;
  /** The voice the regular speaks in, the one their look is painted for. */
  readonly speechStyle: CitizenSpeechStyle;
  private readonly figure: FigureDef | undefined;

  /** `icon` is read every frame: the `!` while the party has not yet asked at the inn. */
  constructor(
    readonly tile: TilePoint,
    private readonly icon: () => OverheadIcon,
  ) {
    this.x = tile.x * TILE_SIZE;
    this.y = tile.y * TILE_SIZE;
    const look = townCastLook(SITTER_LOOK_ID);
    this.speechStyle = citizenSpeechStyle({ species: 'human', look });
    this.figure = townCastSeatedFigure(look, 'street_bench');
    if (this.figure !== undefined) {
      prewarmFigureState(this.figure, SEATED_STATE);
      pinFigureState(this.figure, SEATED_STATE);
    }
  }

  /** Whether a crawler standing at `at` is close enough to talk. */
  inReach(at: { readonly x: number; readonly y: number }): boolean {
    return Math.hypot(at.x - this.x, at.y - this.y) <= TALK_RANGE_PX;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    const sx = this.x - camX;
    const sy = this.y - camY;
    drawTownSheetFrame(ctx, BENCH_SHEET_KEY, FIXTURE_STATE, FIXTURE_FRAME, sx, sy, tileSize);
    const figure = this.figure;
    if (figure === undefined) return;
    const frame = this.idleFrame();
    drawFigureCachedApprox(ctx, figure, SEATED_STATE, frame, sx, sy, tileSize);
    const box = scaleHumanoidBox(sx, sy, tileSize);
    drawOverheadIcon(ctx, box.sx, this.artTop(sy, tileSize), box.s, this.icon());
  }

  /** The screen y a prompt hung over the regular must stay above. */
  overheadTop(ctx: CanvasRenderingContext2D, sy: number): number {
    const box = scaleHumanoidBox(this.x, sy, TILE_SIZE);
    return overheadIconTopY(ctx, this.artTop(sy, TILE_SIZE), box.s, this.icon());
  }

  renderPrompt(ctx: CanvasRenderingContext2D, camX: number, camY: number, label: string): void {
    drawInteractionPromptOver(ctx, this, camX, camY, label);
  }

  dispose(): void {
    if (this.figure !== undefined) unpinFigureState(this.figure, SEATED_STATE);
  }

  private idleFrame(): number {
    const played = Math.floor((performance.now() / MS_PER_SECOND) * SEAT_POSE_FPS);
    return played % SEAT_POSE_FRAMES.idle;
  }

  private artTop(sy: number, tileSize: number): number {
    if (this.figure === undefined) return scaleHumanoidBox(this.x, sy, tileSize).sy;
    return figureRowInkTop(drawnFigureRow(this.figure, SEATED_STATE), sy, tileSize);
  }
}
